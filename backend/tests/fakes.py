"""Подмены внешних сервисов для тестов: модель отвечает заранее заданными ответами."""

import asyncio

from pydantic import BaseModel

from app.llm import ChatResult, Message


class FakeLLM:
    """LLM, которая отдаёт ответы по очереди; исключение в очереди — бросается."""

    embed_model = "fake-embed"
    chat_model = "fake-chat"

    def __init__(self, replies: list[BaseModel | Exception] | None = None) -> None:
        self.replies = list(replies or [])
        self.calls: list[list[Message]] = []

    async def chat(
        self,
        messages: list[Message],
        *,
        schema: type[BaseModel] | None = None,
        temperature: float = 0.0,
    ) -> ChatResult:
        self.calls.append(messages)
        if not self.replies:
            raise AssertionError("FakeLLM: ответы кончились, вызов не ожидался")
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return ChatResult(
            text=reply.model_dump_json(), model=self.chat_model, latency_ms=1.0, parsed=reply
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise AssertionError("FakeLLM.embed не ожидался")


class FakeRedis:
    """Минимум Redis для хранилищ: строки и хэши с TTL (TTL только запоминается).

    yield_between=True отдаёт управление внутри каждой операции — так видны гонки read-modify-write.
    """

    def __init__(self, yield_between: bool = False) -> None:
        self.data: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.ttl: dict[str, int | None] = {}
        self.yield_between = yield_between

    async def _tick(self) -> None:
        if self.yield_between:
            await asyncio.sleep(0)

    async def get(self, key: str) -> str | None:
        await self._tick()
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        await self._tick()
        self.data[key] = value
        self.ttl[key] = ex

    async def hset(self, key: str, field: str, value: str) -> int:
        self.hashes.setdefault(key, {})[field] = value
        return 1

    async def hgetall(self, key: str) -> dict[str, str]:
        await self._tick()
        return dict(self.hashes.get(key, {}))

    async def expire(self, key: str, seconds: int) -> bool:
        self.ttl[key] = seconds
        return True
