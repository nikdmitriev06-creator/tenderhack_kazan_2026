from pathlib import Path

from fastapi.testclient import TestClient

from app.api.demo import get_submissions
from app.api.v1 import get_deps
from app.catalog import Catalog
from app.demo import MemorySubmissionRepo
from app.glossary import Glossary
from app.main import create_app
from app.pipeline import Deps
from app.search import build_bm25
from app.session import SessionStore
from tests.fakes import FakeLLM, FakeRedis

FAKE = Path(__file__).parent / "fixtures" / "fake"
CATALOG = Catalog.load([FAKE / "ktru.json"])
COLOR = "17.12.14.129-00000102"

CARD = {
    "name": "Бумага офисная цветная А4",
    "ktru_code": COLOR,
    "characteristics": [
        {"name": "Формат", "value": "A4"},
        {"name": "Цветность", "value": "Цветная"},
        {"name": "Интенсивность цвета", "value": "Медиум"},
        {"name": "Количество листов в пачке", "value": "500", "unit": "шт"},
    ],
}

CONFLICT = {
    "name": "Бумага офисная цветная А4",
    "ktru_code": COLOR,
    "characteristics": [
        {"name": "Формат", "value": "A4"},
        {"name": "Цветность", "value": "Цветная"},
        {"name": "Интенсивность цвета", "value": "Белый"},
        {"name": "Количество листов в пачке", "value": "500", "unit": "шт"},
    ],
}


def _client() -> TestClient:
    deps = Deps(
        catalog=CATALOG,
        bm25=build_bm25(CATALOG),
        vectors=None,
        llm=FakeLLM([]),  # type: ignore[arg-type]
        glossary=Glossary([]),
        sessions=SessionStore(FakeRedis(), ttl_s=900),  # type: ignore[arg-type]
        min_score=0.2,
    )
    repo = MemorySubmissionRepo()
    app = create_app()
    app.dependency_overrides[get_deps] = lambda: deps
    app.dependency_overrides[get_submissions] = lambda: repo
    return TestClient(app)


def test_submitted_card_appears_in_queue_as_pending() -> None:
    client = _client()
    r = client.post("/api/demo/submissions", json={"card": CARD})
    assert r.status_code == 201
    queue = client.get("/api/demo/submissions").json()
    assert [(s["id"], s["status"]) for s in queue] == [(r.json()["id"], "pending")]


def test_queue_is_newest_first() -> None:
    client = _client()
    first = client.post("/api/demo/submissions", json={"card": CARD}).json()["id"]
    second = client.post("/api/demo/submissions", json={"card": CARD}).json()["id"]
    assert [s["id"] for s in client.get("/api/demo/submissions").json()] == [second, first]


def test_submission_view_carries_check() -> None:
    client = _client()
    sid = client.post("/api/demo/submissions", json={"card": CARD}).json()["id"]
    view = client.get(f"/api/demo/submissions/{sid}").json()
    assert view["check"]["verdict"] == "ready"
    assert view["check"]["issues"] == []


def test_ktru_conflict_is_rejected_and_not_queued() -> None:
    client = _client()
    r = client.post("/api/demo/submissions", json={"card": CONFLICT})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "Интенсивность цвета" in detail
    assert "Белый" in detail
    assert client.get("/api/demo/submissions").json() == []


def test_missing_ktru_is_rejected() -> None:
    client = _client()
    card = {**CARD, "ktru_code": None}
    r = client.post("/api/demo/submissions", json={"card": card})
    assert r.status_code == 422
    assert "не определена" in r.json()["detail"]


def test_unknown_ktru_is_rejected() -> None:
    client = _client()
    card = {**CARD, "ktru_code": "00.00.00.000-99999999"}
    r = client.post("/api/demo/submissions", json={"card": card})
    assert r.status_code == 422
    assert "нет в справочнике" in r.json()["detail"]


def test_removed_required_characteristic_is_rejected() -> None:
    client = _client()
    chars = [c for c in CARD["characteristics"] if c["name"] != "Формат"]
    r = client.post("/api/demo/submissions", json={"card": {**CARD, "characteristics": chars}})
    assert r.status_code == 422
    assert "Формат" in r.json()["detail"]


def test_value_outside_range_is_rejected() -> None:
    client = _client()
    bags = "22.22.11.000-00000201"
    card = {
        "name": "Мешки для мусора",
        "ktru_code": bags,
        "characteristics": [
            {"name": "Объем", "value": "60", "unit": "л"},
            {"name": "Толщина", "value": "200", "unit": "мкм"},
            {"name": "Материал", "value": "ПВД"},
        ],
    }
    r = client.post("/api/demo/submissions", json={"card": card})
    assert r.status_code == 422
    assert "Толщина" in r.json()["detail"]
    assert "200" in r.json()["detail"]


def test_fixed_value_can_be_submitted() -> None:
    client = _client()
    rejected = client.post("/api/demo/submissions", json={"card": CONFLICT})
    assert rejected.status_code == 422
    accepted = client.post("/api/demo/submissions", json={"card": CARD})
    assert accepted.status_code == 201


def test_return_with_note() -> None:
    client = _client()
    sid = client.post("/api/demo/submissions", json={"card": CARD}).json()["id"]
    r = client.post(
        f"/api/demo/submissions/{sid}/decision",
        json={"decision": "return", "note": "Интенсивность цвета: значения нет в перечне"},
    )
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["decision_note"]) == (
        "returned",
        "Интенсивность цвета: значения нет в перечне",
    )


def test_second_decision_is_409() -> None:
    client = _client()
    sid = client.post("/api/demo/submissions", json={"card": CARD}).json()["id"]
    client.post(f"/api/demo/submissions/{sid}/decision", json={"decision": "accept"})
    r = client.post(f"/api/demo/submissions/{sid}/decision", json={"decision": "return"})
    assert r.status_code == 409


def test_unknown_submission_is_404() -> None:
    client = _client()
    assert client.get("/api/demo/submissions/999").status_code == 404
    r = client.post("/api/demo/submissions/999/decision", json={"decision": "accept"})
    assert r.status_code == 404
