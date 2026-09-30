import asyncio
import json

import httpx
import pytest
from pydantic import BaseModel

from app.config import Settings
from app.llm import LLMClient, LLMError, LLMOutputError, clean_output, model_present


class Extracted(BaseModel):
    name: str
    value: float
    unit: str


def run(coro):
    return asyncio.run(coro)


def client_for(handler, **overrides) -> LLMClient:
    settings = Settings(llm_max_retries=2, **overrides)
    return LLMClient.from_settings(settings, transport=httpx.MockTransport(handler))


def test_ollama_chat_sends_schema_in_format_and_parses_answer() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        content = (
            '<think>думаю</think>```json\n{"name": "Толщина", "value": 50, "unit": "мкм"}\n```'
        )
        return httpx.Response(200, json={"model": "qwen3:4b", "message": {"content": content}})

    llm = client_for(handler, llm_provider="ollama", llm_base_url="http://ollama:11434")
    result = run(llm.chat([{"role": "user", "content": "..."}], schema=Extracted))

    assert seen["path"] == "/api/chat"
    assert seen["body"]["stream"] is False
    assert seen["body"]["format"]["properties"]["unit"]["type"] == "string"
    assert result.parsed == Extracted(name="Толщина", value=50, unit="мкм")


def test_openai_compat_uses_v1_response_format_and_bearer() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        answer = 'Вот: {"name": "Объём", "value": 35, "unit": "л"}'
        return httpx.Response(200, json={"choices": [{"message": {"content": answer}}]})

    llm = client_for(
        handler, llm_provider="openai", llm_base_url="http://gpu:8000", llm_api_key="secret"
    )
    result = run(llm.chat([{"role": "user", "content": "..."}], schema=Extracted))

    assert seen["path"] == "/v1/chat/completions"
    assert seen["auth"] == "Bearer secret"
    assert seen["body"]["response_format"]["json_schema"]["name"] == "Extracted"
    assert result.parsed == Extracted(name="Объём", value=35, unit="л")


def test_invalid_structured_answer_raises_with_raw_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": {"content": "не знаю"}})

    llm = client_for(handler)
    with pytest.raises(LLMOutputError) as err:
        run(llm.chat([{"role": "user", "content": "..."}], schema=Extracted))
    assert err.value.raw == "не знаю"


def test_retries_on_503_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) < 3:
            return httpx.Response(503, text="loading model")
        return httpx.Response(200, json={"message": {"content": "привет"}})

    result = run(client_for(handler).chat([{"role": "user", "content": "hi"}]))
    assert result.text == "привет"
    assert len(calls) == 3


def test_client_error_is_not_retried() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(404, text='model "x" not found')

    with pytest.raises(LLMError, match="404"):
        run(client_for(handler).chat([{"role": "user", "content": "hi"}]))
    assert len(calls) == 1


def test_embeddings_from_separate_openai_server_keep_order() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "emb"
        assert request.url.path == "/v1/embeddings"
        data = [{"index": 1, "embedding": [0.0, 1.0]}, {"index": 0, "embedding": [1.0, 0.0]}]
        return httpx.Response(200, json={"data": data})

    llm = client_for(
        handler, llm_provider="ollama", embed_provider="openai", embed_base_url="http://emb/v1"
    )
    assert llm.embed_provider is not llm.chat_provider
    assert run(llm.embed(["a", "b"])) == [[1.0, 0.0], [0.0, 1.0]]


def test_missing_models_accepts_latest_tag() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"models": [{"name": "bge-m3:latest"}]})

    llm = client_for(handler, llm_chat_model="qwen3:4b", embed_model="bge-m3")
    assert run(llm.missing_models()) == ["qwen3:4b"]
    assert model_present("bge-m3", ["bge-m3:latest"])


def test_clean_output_drops_unclosed_think() -> None:
    assert clean_output("ответ") == "ответ"
    assert clean_output("<think>рассуждаю без конца") == ""


async def _no_sleep(_: float) -> None:
    return None


def test_think_off_is_sent_to_both_providers() -> None:
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        if request.url.path == "/api/chat":
            return httpx.Response(200, json={"message": {"content": "ok"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    run(client_for(handler, llm_provider="ollama").chat([{"role": "user", "content": "x"}]))
    run(client_for(handler, llm_provider="openai").chat([{"role": "user", "content": "x"}]))
    assert bodies[0]["think"] is False
    assert bodies[1]["chat_template_kwargs"] == {"enable_thinking": False}


def test_model_without_thinking_is_retried_without_think() -> None:
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "think" in body:
            return httpx.Response(400, json={"error": '"gemma" does not support thinking'})
        return httpx.Response(200, json={"message": {"content": "ok"}})

    result = run(client_for(handler).chat([{"role": "user", "content": "x"}]))
    assert result.text == "ok"
    assert ["think" in b for b in bodies] == [True, False]


def test_read_timeout_is_not_retried() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        raise httpx.ReadTimeout("slow generation", request=request)

    with pytest.raises(LLMError, match="ReadTimeout"):
        run(client_for(handler).chat([{"role": "user", "content": "x"}]))
    assert len(calls) == 1
