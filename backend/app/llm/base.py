"""Общая часть клиентов LLM: HTTP с повторами и разбор структурированного ответа кодом."""

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

log = logging.getLogger(__name__)

Message = dict[str, str]

RETRY_STATUSES = {429, 500, 502, 503, 504}
_THINK = re.compile(r"<think>.*?</think>", re.S)
_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


class LLMError(RuntimeError):
    """Сервер модели недоступен или ответил ошибкой."""


class LLMOutputError(LLMError):
    """Модель ответила, но ответ не прошёл проверку схемы."""

    def __init__(self, message: str, raw: str) -> None:
        super().__init__(message)
        self.raw = raw


@dataclass(frozen=True)
class ChatResult:
    text: str
    model: str
    latency_ms: float
    parsed: BaseModel | None = None


def clean_output(text: str) -> str:
    """Убирает рассуждения <think>…</think> (в том числе незакрытые) и ограду ```json."""
    text = _THINK.sub("", text)
    if "<think>" in text:  # незакрытый блок рассуждений — ответа после него нет
        text = text.split("<think>", 1)[0]
    return _FENCE.sub("", text.strip()).strip()


def parse_structured[T: BaseModel](text: str, schema: type[T]) -> T:
    cleaned = clean_output(text)
    try:
        return schema.model_validate_json(cleaned)
    except ValidationError:
        pass
    # Модель иногда оборачивает JSON текстом: берём первый объект целиком.
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            return schema.model_validate(json.loads(cleaned[start : end + 1]))
        except (ValueError, ValidationError):
            pass
    raise LLMOutputError(f"ответ не соответствует схеме {schema.__name__}", raw=text)


class HttpProvider:
    """HTTP-клиент провайдера с повторами на сетевых ошибках, 429 и 5xx."""

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str = "",
        timeout: float = 120.0,
        max_retries: int = 2,
        think: bool | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.think = think
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self._http = httpx.AsyncClient(
            base_url=self.base_url, headers=headers, timeout=timeout, transport=transport
        )

    async def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        last: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                resp = await self._http.request(method, path, json=payload)
            except httpx.TimeoutException as exc:
                if not isinstance(exc, httpx.ConnectTimeout):
                    # Долгая генерация: повтор съест ещё столько же времени, отдаём ошибку сразу.
                    raise LLMError(f"{method} {self.base_url}{path}: {type(exc).__name__}") from exc
                last = exc
            except httpx.TransportError as exc:
                last = exc
            else:
                if resp.status_code < 400:
                    return resp.json()
                last = LLMError(f"{method} {path} → {resp.status_code}: {resp.text[:300]}")
                if resp.status_code not in RETRY_STATUSES:
                    raise last
            if attempt < self.max_retries:
                delay = 0.5 * 2**attempt
                log.warning("LLM %s %s: %s, повтор через %.1f с", method, path, last, delay)
                await asyncio.sleep(delay)
        if isinstance(last, LLMError):
            raise last
        raise LLMError(f"{method} {self.base_url}{path}: {type(last).__name__}: {last}") from last

    async def aclose(self) -> None:
        await self._http.aclose()
