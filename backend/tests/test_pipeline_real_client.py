"""Конвейер с настоящим LLMClient: HTTP подменён транспортом, который отвечает как Ollama.

Фейк зависимости с чужой сигнатурой прячет мёртвый прод-путь: так было с эмбеддингами (клиент ждёт
список текстов, а поиск передавал строку). Здесь проверяется путь через настоящий клиент.
"""

import asyncio
import json
from pathlib import Path

import httpx

from app.catalog import Catalog
from app.config import Settings
from app.glossary import Glossary
from app.llm import LLMClient
from app.pipeline import AutofillIn, Deps, autofill
from app.search import build_bm25
from app.session import SessionStore
from tests.fakes import FakeRedis

CATALOG = Catalog.load([Path(__file__).parent.parent / "app" / "catalog" / "demo" / "demo.json"])
BATTERY = "27.20.11.000-00000501"


def _ollama(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content or b"{}")
    if request.url.path == "/api/embed":
        inputs = body["input"] if isinstance(body["input"], list) else [body["input"]]
        return httpx.Response(200, json={"embeddings": [[0.1, 0.2, 0.3] for _ in inputs]})
    if request.url.path == "/api/chat":
        return httpx.Response(200, json={"message": {"content": '{"items": []}'}, "model": "m"})
    return httpx.Response(404, json={"error": "нет такого пути"})


class RecordingVectors:
    """Векторный индекс: запоминает, какой вектор пришёл, и узнаёт батарейку."""

    def __init__(self) -> None:
        self.seen: list[list[float]] = []

    async def search(self, vector: list[float], k: int = 20) -> list[tuple[str, float]]:
        self.seen.append(vector)
        return [(BATTERY, 0.83)]


def test_embeddings_go_through_the_real_client() -> None:
    settings = Settings(_env_file=None, llm_provider="ollama", llm_base_url="http://ollama.test")  # type: ignore[call-arg]
    llm = LLMClient.from_settings(settings, transport=httpx.MockTransport(_ollama))
    vectors = RecordingVectors()
    deps = Deps(
        catalog=CATALOG,
        bm25=build_bm25(CATALOG),
        vectors=vectors,
        llm=llm,
        glossary=Glossary([]),
        sessions=SessionStore(FakeRedis(), ttl_s=900),  # type: ignore[arg-type]
        min_score=0.2,
    )
    out = asyncio.run(autofill(AutofillIn(name="Элемент питания щелочной AA"), deps))
    assert out.degraded == []
    assert vectors.seen == [[0.1, 0.2, 0.3]]
    assert BATTERY in [c.code for c in out.ktru.candidates]
