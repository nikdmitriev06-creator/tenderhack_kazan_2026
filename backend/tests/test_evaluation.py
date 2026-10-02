import json
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.v1 import get_deps
from app.catalog import Catalog
from app.evaluation import (
    MetricRow,
    MetricsOut,
    accuracy_at_k,
    build_golden,
    precision_recall,
    run_evaluation,
)
from app.glossary import Glossary
from app.main import create_app
from app.pipeline import Deps
from app.search import build_bm25
from app.session import SessionStore
from tests.fakes import FakeRedis

FAKE = Path(__file__).parent / "fixtures" / "fake"
CATALOG = Catalog.load([FAKE / "ktru.json"])


def test_golden_is_deterministic_for_a_seed() -> None:
    assert build_golden(CATALOG, seed=7) == build_golden(CATALOG, seed=7)


def test_golden_has_every_group() -> None:
    groups = {c.group for c in build_golden(CATALOG)}
    assert groups == {"clean", "typo", "out_of_catalog", "near_domain", "corrupted"}


def test_clean_cases_point_to_existing_positions() -> None:
    for case in build_golden(CATALOG):
        if case.group in ("clean", "typo", "corrupted"):
            assert CATALOG.get(case.expected_code or "") is not None


def test_accuracy_at_k() -> None:
    ranked = [["a", "b"], ["c", "d"]]
    assert accuracy_at_k(ranked, ["b", "x"], 1) == 0.0
    assert accuracy_at_k(ranked, ["b", "x"], 2) == 0.5


def test_precision_recall() -> None:
    assert precision_recall({("a", "1"), ("b", "2")}, {("a", "1")}) == (0.5, 1.0)
    assert precision_recall(set(), set()) == (1.0, 1.0)


class NoLLM:
    async def chat(self, *_: object, **__: object) -> object:
        from app.llm import LLMError

        raise LLMError("оценка без LLM")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise AssertionError("не ожидался")


def _deps() -> Deps:
    return Deps(
        catalog=CATALOG,
        bm25=build_bm25(CATALOG),
        vectors=None,
        llm=NoLLM(),  # type: ignore[arg-type]
        glossary=Glossary([]),
        sessions=SessionStore(FakeRedis(), ttl_s=900),  # type: ignore[arg-type]
        min_score=0.2,
    )


def test_run_evaluation_reports_every_metric_with_sample_size() -> None:
    import asyncio

    out = asyncio.run(run_evaluation(build_golden(CATALOG), _deps(), model="без LLM"))
    keys = {r.key for r in out.rows}
    assert {
        "ktru_acc1",
        "ktru_acc5",
        "ktru_final",
        "questions",
        "fill_precision",
        "fill_recall",
    } <= keys
    assert {"refusal", "near_no_false_code", "latency_p50", "latency_p95"} <= keys
    assert any(k.startswith("detector_") for k in keys)
    assert all(r.n > 0 for r in out.rows)
    assert all(r.how for r in out.rows)


def test_metrics_endpoint_reads_last_run(tmp_path: Path) -> None:
    out = MetricsOut(
        created_at=datetime(2026, 10, 1, tzinfo=UTC),
        catalog_version="ktru.json",
        catalog_source="synthetic",
        model="без LLM",
        rows=[MetricRow(key="ktru_acc1", title="Точность кода", value=0.9, n=10, how="тест")],
    )
    path = tmp_path / "latest.json"
    path.write_text(out.model_dump_json(), encoding="utf-8")
    deps = _deps()
    deps.metrics_path = path
    app = create_app()
    app.dependency_overrides[get_deps] = lambda: deps
    body = TestClient(app).get("/api/v1/metrics").json()
    assert body["rows"][0]["value"] == 0.9
    assert json.loads(path.read_text(encoding="utf-8"))["catalog_source"] == "synthetic"


def test_metrics_endpoint_404_before_first_run(tmp_path: Path) -> None:
    deps = _deps()
    deps.metrics_path = tmp_path / "none.json"
    app = create_app()
    app.dependency_overrides[get_deps] = lambda: deps
    r = TestClient(app).get("/api/v1/metrics")
    assert r.status_code == 404
    assert r.json()["detail"] == "оценка ещё не запускалась"


def test_portal_report_endpoint_reads_last_run(tmp_path: Path) -> None:
    from app.portal import build_report, parse_card

    card = parse_card(
        {"id": 5, "name": "Мешки для мусора 60л", "category_path": ".1.2.",
         "characteristics": [{"name": "Объем", "value": 60, "unit": "л", "type_id": 1}]}
    )  # fmt: skip
    assert card is not None
    path = tmp_path / "portal.json"
    path.write_text(build_report([card], source="тест").model_dump_json(), encoding="utf-8")
    deps = _deps()
    deps.portal_report_path = path
    app = create_app()
    app.dependency_overrides[get_deps] = lambda: deps
    body = TestClient(app).get("/api/v1/metrics/portal").json()
    assert (body["cards"], body["source"]) == (1, "тест")
    assert body["audit"]["rules"][0]["examples"][0]["url"] == "https://zakupki.mos.ru/sku/view/5"


def test_portal_report_endpoint_404_before_first_run(tmp_path: Path) -> None:
    deps = _deps()
    deps.portal_report_path = tmp_path / "none.json"
    app = create_app()
    app.dependency_overrides[get_deps] = lambda: deps
    r = TestClient(app).get("/api/v1/metrics/portal")
    assert r.status_code == 404
    assert r.json()["detail"] == "отчёт по карточкам портала ещё не собран"
