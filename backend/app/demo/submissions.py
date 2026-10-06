"""Очередь заявок на модерацию — стенд портала для демонстрации, не часть модуля.

На настоящем портале очередь ведёт сам портал; модуль только проверяет карточку (`/api/v1/check`).
"""

import json
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from pydantic import BaseModel, TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.pipeline import CharacteristicOut
from app.schemas import CardIn, CheckOut

Status = Literal["pending", "accepted", "returned"]


class SubmissionIn(BaseModel):
    card: CardIn
    accepted: list[CharacteristicOut] = []


class Submission(BaseModel):
    id: int
    created_at: datetime
    card: CardIn
    accepted: list[CharacteristicOut]
    status: Status
    decision_note: str | None = None


class SubmissionView(Submission):
    check: CheckOut


class DecisionIn(BaseModel):
    decision: Literal["accept", "return"]
    note: str | None = None


class AlreadyDecided(RuntimeError):
    pass


class SubmissionRepo(Protocol):
    async def add(self, s: SubmissionIn) -> Submission: ...
    async def list(self) -> list[Submission]: ...
    async def get(self, id: int) -> Submission | None: ...
    async def decide(self, id: int, d: DecisionIn) -> Submission | None: ...


def _status(d: DecisionIn) -> Status:
    return "accepted" if d.decision == "accept" else "returned"


class MemorySubmissionRepo:
    """Хранилище в памяти: тесты и запуск без базы."""

    def __init__(self) -> None:
        self._items: dict[int, Submission] = {}

    async def add(self, s: SubmissionIn) -> Submission:
        sub = Submission(
            id=len(self._items) + 1,
            created_at=datetime.now(UTC),
            card=s.card,
            accepted=s.accepted,
            status="pending",
        )
        self._items[sub.id] = sub
        return sub

    async def list(self) -> list[Submission]:
        return sorted(self._items.values(), key=lambda s: s.id, reverse=True)

    async def get(self, id: int) -> Submission | None:
        return self._items.get(id)

    async def decide(self, id: int, d: DecisionIn) -> Submission | None:
        sub = self._items.get(id)
        if sub is None:
            return None
        if sub.status != "pending":
            raise AlreadyDecided(id)
        sub = sub.model_copy(update={"status": _status(d), "decision_note": d.note})
        self._items[id] = sub
        return sub


_ACCEPTED = TypeAdapter(list[CharacteristicOut])
_COLUMNS = "id, created_at, card, accepted, status, decision_note"


def _json(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _row(r: Any) -> Submission:
    return Submission(
        id=r.id,
        created_at=r.created_at,
        card=CardIn.model_validate(_json(r.card)),
        accepted=_ACCEPTED.validate_python(_json(r.accepted)),
        status=r.status,
        decision_note=r.decision_note,
    )


class PgSubmissionRepo:
    """Таблица submission (миграция c3d4e5f6a7b8)."""

    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine

    async def add(self, s: SubmissionIn) -> Submission:
        async with self.engine.begin() as conn:
            r = await conn.execute(
                text(
                    "INSERT INTO submission (card, accepted, status) "
                    "VALUES (CAST(:card AS jsonb), CAST(:accepted AS jsonb), 'pending') "
                    f"RETURNING {_COLUMNS}"
                ),
                {
                    "card": s.card.model_dump_json(),
                    "accepted": _ACCEPTED.dump_json(s.accepted).decode(),
                },
            )
            return _row(r.one())

    async def list(self) -> list[Submission]:
        async with self.engine.connect() as conn:
            r = await conn.execute(text(f"SELECT {_COLUMNS} FROM submission ORDER BY id DESC"))
            return [_row(x) for x in r]

    async def get(self, id: int) -> Submission | None:
        async with self.engine.connect() as conn:
            r = await conn.execute(
                text(f"SELECT {_COLUMNS} FROM submission WHERE id = :id"), {"id": id}
            )
            row = r.one_or_none()
            return _row(row) if row else None

    async def decide(self, id: int, d: DecisionIn) -> Submission | None:
        async with self.engine.begin() as conn:
            r = await conn.execute(
                text(
                    "UPDATE submission SET status = :status, decision_note = :note "
                    f"WHERE id = :id AND status = 'pending' RETURNING {_COLUMNS}"
                ),
                {"status": _status(d), "note": d.note, "id": id},
            )
            row = r.one_or_none()
            if row is not None:
                return _row(row)
            exists = await conn.execute(text("SELECT 1 FROM submission WHERE id = :id"), {"id": id})
            if exists.one_or_none() is not None:
                raise AlreadyDecided(id)
            return None
