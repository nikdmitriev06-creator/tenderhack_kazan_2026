"""Два способа достучаться до модели: нативный API Ollama и OpenAI-совместимый сервер."""

from typing import Any

from pydantic import BaseModel

from app.llm.base import HttpProvider, LLMError, Message


class OllamaProvider(HttpProvider):
    """Нативный API Ollama: /api/chat, /api/embed, /api/tags."""

    async def chat(
        self,
        messages: list[Message],
        *,
        model: str,
        schema: type[BaseModel] | None,
        temperature: float,
    ) -> tuple[str, str]:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }
        if schema is not None:
            body["format"] = schema.model_json_schema()
        if self.think is not None:
            body["think"] = self.think
        try:
            data = await self.request("POST", "/api/chat", body)
        except LLMError as exc:
            if "think" not in body or "thinking" not in str(exc):
                raise
            body.pop("think")  # модель без режима рассуждений: повторяем без параметра
            data = await self.request("POST", "/api/chat", body)
        return data["message"]["content"], data.get("model", model)

    async def embed(self, texts: list[str], *, model: str) -> list[list[float]]:
        data = await self.request("POST", "/api/embed", {"model": model, "input": texts})
        return data["embeddings"]

    async def list_models(self) -> list[str]:
        data = await self.request("GET", "/api/tags")
        return [m["name"] for m in data.get("models", [])]


class OpenAICompatProvider(HttpProvider):
    """OpenAI-совместимый API (vLLM, llama.cpp server, Ollama /v1) на нашем сервере."""

    def __init__(self, base_url: str, **kwargs: Any) -> None:
        base = base_url.rstrip("/")
        super().__init__(base if base.endswith("/v1") else f"{base}/v1", **kwargs)

    async def chat(
        self,
        messages: list[Message],
        *,
        model: str,
        schema: type[BaseModel] | None,
        temperature: float,
    ) -> tuple[str, str]:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": False,
        }
        if self.think is False:
            # vLLM и llama.cpp: выключить рассуждения шаблона Qwen3.
            body["chat_template_kwargs"] = {"enable_thinking": False}
        if schema is not None:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema()},
            }
        data = await self.request("POST", "/chat/completions", body)
        return data["choices"][0]["message"]["content"], data.get("model", model)

    async def embed(self, texts: list[str], *, model: str) -> list[list[float]]:
        data = await self.request("POST", "/embeddings", {"model": model, "input": texts})
        return [item["embedding"] for item in sorted(data["data"], key=lambda d: d["index"])]

    async def list_models(self) -> list[str]:
        data = await self.request("GET", "/models")
        return [m["id"] for m in data.get("data", [])]


Provider = OllamaProvider | OpenAICompatProvider
