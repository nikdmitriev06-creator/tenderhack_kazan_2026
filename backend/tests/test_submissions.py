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
    "name": "Бумага офисная А4",
    "ktru_code": COLOR,
    "characteristics": [
        {"name": "Формат", "value": "A4"},
        {"name": "Интенсивность цвета", "value": "Белый"},
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
    assert view["check"]["verdict"] == "needs_fix"
    assert any(i["kind"] == "not_in_list" for i in view["check"]["issues"])


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
