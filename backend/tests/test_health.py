import asyncio

from fastapi.testclient import TestClient

from app.api.health import get_checks, get_timeout
from app.health import Check, run_check
from app.main import create_app


async def _ok() -> str:
    return "ok"


async def _boom() -> str:
    raise ConnectionError("connection refused")


async def _slow() -> str:
    await asyncio.sleep(1)
    return "late"


def client_with(checks: list[Check]) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_checks] = lambda: checks
    app.dependency_overrides[get_timeout] = lambda: 0.1
    return TestClient(app)  # без with: lifespan не запускается, инфраструктура не нужна


def test_liveness_needs_no_dependencies() -> None:
    resp = TestClient(create_app()).get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_ready_when_all_dependencies_ok() -> None:
    checks = [Check("postgres", True, _ok), Check("ollama", False, _ok)]
    resp = client_with(checks).get("/api/health/ready")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_optional_dependency_down_is_degraded_not_fail() -> None:
    checks = [Check("postgres", True, _ok), Check("ollama", False, _boom)]
    resp = client_with(checks).get("/api/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    ollama = next(d for d in body["dependencies"] if d["name"] == "ollama")
    assert ollama["ok"] is False
    assert "connection refused" in ollama["detail"]


def test_required_dependency_down_returns_503() -> None:
    checks = [Check("postgres", True, _boom), Check("redis", True, _ok)]
    resp = client_with(checks).get("/api/health/ready")
    assert resp.status_code == 503
    assert resp.json()["status"] == "fail"


def test_hanging_probe_is_cut_by_timeout() -> None:
    status = asyncio.run(run_check(Check("rabbitmq", True, _slow), timeout=0.05))
    assert status.ok is False
    assert "нет ответа" in status.detail
    assert status.latency_ms < 500


class _FakeLLM:
    def __init__(self, missing: list[str]) -> None:
        self._missing = missing

    async def missing_models(self) -> list[str]:
        return self._missing


def _llm_checks(missing: list[str]) -> dict[str, Check]:
    from types import SimpleNamespace

    from app.config import Settings
    from app.health import build_checks

    settings = Settings(_env_file=None, llm_chat_model="gemma4:31b", embed_model="bge-m3")
    res = SimpleNamespace(settings=settings, llm=_FakeLLM(missing))
    return {c.name: c for c in build_checks(res)}  # type: ignore[arg-type]


def test_chat_ok_when_only_embedding_model_is_missing() -> None:
    # Облако отдаёт чат-модели, но не эмбеддинги: чат должен считаться рабочим.
    checks = _llm_checks(["bge-m3"])
    assert "gemma4:31b" in asyncio.run(checks["llm"].probe())
    status = asyncio.run(run_check(checks["embeddings"], timeout=1))
    assert status.ok is False
    assert "bge-m3" in status.detail
    assert checks["embeddings"].required is False


def test_chat_fails_when_chat_model_is_missing() -> None:
    checks = _llm_checks(["gemma4:31b"])
    status = asyncio.run(run_check(checks["llm"], timeout=1))
    assert status.ok is False
    assert "gemma4:31b" in status.detail
    assert asyncio.run(run_check(checks["embeddings"], timeout=1)).ok is True
