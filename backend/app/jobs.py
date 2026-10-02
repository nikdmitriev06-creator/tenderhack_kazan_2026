"""Сообщения очереди и состояние фоновых задач (хранится в Redis с TTL)."""

from datetime import UTC, datetime
from typing import Literal

from faststream.rabbit import RabbitQueue
from pydantic import BaseModel, Field

# Очередь durable, её объявляют и API, и воркер: сообщение не теряется, пока воркер лежит.
PING_QUEUE = RabbitQueue("jobs.ping", durable=True)
BATCH_QUEUE = RabbitQueue("jobs.batch", durable=True)
QUEUES = (PING_QUEUE, BATCH_QUEUE)


def job_key(job_id: str) -> str:
    return f"job:{job_id}"


def utcnow() -> datetime:
    return datetime.now(UTC)


class PingJob(BaseModel):
    """Проверочная задача: проходит API → RabbitMQ → воркер → Redis."""

    job_id: str
    created_at: datetime = Field(default_factory=utcnow)


class JobState(BaseModel):
    job_id: str
    status: Literal["queued", "done", "failed"]
    detail: str = ""
    updated_at: datetime = Field(default_factory=utcnow)


class JobAccepted(BaseModel):
    job_id: str
    status_url: str


class BatchJob(BaseModel):
    """Пакет СТЕ: строки и состояние лежат в Redis (`app.batch.BatchStore`).

    В сообщении — только id: файл не гоняется через брокер.
    """

    job_id: str
    created_at: datetime = Field(default_factory=utcnow)
