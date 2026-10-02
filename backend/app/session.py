"""Сессия заполнения: что извлекли из текста и что ответил человек — между вызовами /autofill.

Хранится в Redis с TTL, поэтому API без состояния и масштабируется репликами. Основа сессии
пишется один раз (`save`), ответы — отдельными полями хэша (`add_answer`, HSET атомарен): два
одновременных ответа не затирают друг друга, как было бы при «прочитать — изменить — записать».
"""

from uuid import uuid4

from pydantic import BaseModel
from redis.asyncio import Redis

from app.extract import Extracted
from app.narrowing import CONFIRM, NOTHING_FITS, Known
from app.search import Candidate


class Session(BaseModel):
    id: str
    name: str
    description: str
    candidates: list[Candidate] = []
    known: dict[str, Known] = {}
    extracted: list[Extracted] = []
    degraded: list[str] = []
    # Значимые слова наименования, которых нет ни в одной позиции-кандидате: код — только после
    # подтверждения человеком.
    unexplained: list[str] = []
    # Из ответов: подтверждённый код и «Ничего не подходит».
    confirmed: str | None = None
    rejected: bool = False

    @classmethod
    def new(cls, name: str, description: str) -> "Session":
        return cls(id=uuid4().hex, name=name, description=description)


def session_key(session_id: str) -> str:
    return f"autofill:{session_id}"


def answers_key(session_id: str) -> str:
    return f"autofill:{session_id}:answers"


class SessionStore:
    def __init__(self, redis: Redis, ttl_s: int) -> None:
        self.redis = redis
        self.ttl_s = ttl_s

    async def save(self, s: Session) -> None:
        await self.redis.set(session_key(s.id), s.model_dump_json(), ex=self.ttl_s)

    async def add_answer(self, session_id: str, characteristic: str, value: str) -> None:
        await self.redis.hset(answers_key(session_id), characteristic, value)
        await self.redis.expire(answers_key(session_id), self.ttl_s)

    async def load(self, session_id: str) -> Session | None:
        raw = await self.redis.get(session_key(session_id))
        if not raw:
            return None
        session = Session.model_validate_json(raw)
        for characteristic, value in (await self.redis.hgetall(answers_key(session_id))).items():
            if value == NOTHING_FITS:
                session.rejected = True
            elif characteristic == CONFIRM:
                session.confirmed = value
            else:
                session.known[characteristic] = Known(value=value, source="answer")
        return session


class MemoryKV:
    """Хранилище сессий в памяти процесса — для оценки без Redis (app.tools.evaluate)."""

    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.data[key] = value

    async def hset(self, key: str, field: str, value: str) -> int:
        self.hashes.setdefault(key, {})[field] = value
        return 1

    async def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

    async def expire(self, key: str, seconds: int) -> bool:
        return True
