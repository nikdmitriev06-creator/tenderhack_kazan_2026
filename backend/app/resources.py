"""Подключения к внешним сервисам: создаются один раз на процесс и живут в app.state."""

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from faststream.rabbit import RabbitBroker
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.catalog import Catalog
from app.config import Settings
from app.jobs import QUEUES
from app.llm import LLMClient

if TYPE_CHECKING:
    from app.pipeline import Deps

log = logging.getLogger(__name__)


def create_broker(settings: Settings) -> RabbitBroker:
    return RabbitBroker(settings.rabbitmq_url)


@dataclass
class Resources:
    settings: Settings
    engine: AsyncEngine
    redis: Redis
    broker: RabbitBroker
    llm: LLMClient
    catalog: Catalog
    broker_started: bool = field(default=False)

    @classmethod
    def create(cls, settings: Settings) -> "Resources":
        return cls(
            settings=settings,
            engine=create_async_engine(settings.database_url, pool_pre_ping=True),
            redis=Redis.from_url(settings.redis_url, decode_responses=True),
            broker=create_broker(settings),
            llm=LLMClient.from_settings(settings),
            catalog=Catalog.load(settings.catalog_files()),
        )

    async def ensure_broker(self) -> RabbitBroker:
        """Подключает брокер при первом обращении: API стартует и без поднятого RabbitMQ."""
        if not self.broker_started:
            await self.broker.start()
            for queue in QUEUES:
                await self.broker.declare_queue(queue)
            self.broker_started = True
        return self.broker

    async def close(self) -> None:
        if self.broker_started:
            await self.broker.stop()
        await self.llm.aclose()
        await self.redis.aclose()
        await self.engine.dispose()


def build_deps(res: Resources) -> "Deps":
    """Зависимости конвейера из подключений процесса: индекс BM25 строится один раз при старте."""
    from app.batch import BatchStore
    from app.glossary import Glossary
    from app.jobs import BATCH_QUEUE, BatchJob
    from app.llm.cache import CachedChat
    from app.pipeline import Deps
    from app.search import build_bm25
    from app.search.vectors import EmbeddingIndex
    from app.session import SessionStore

    async def enqueue_batch(job_id: str) -> None:
        broker = await res.ensure_broker()
        await broker.publish(BatchJob(job_id=job_id), queue=BATCH_QUEUE)

    return Deps(
        catalog=res.catalog,
        bm25=build_bm25(res.catalog),
        vectors=EmbeddingIndex(res.engine, res.llm.embed_model, res.catalog.version),
        llm=CachedChat(res.llm, res.redis, ttl_s=res.settings.llm_cache_ttl_s),
        glossary=Glossary.load(),
        sessions=SessionStore(res.redis, ttl_s=res.settings.job_ttl_s),
        min_score=res.settings.search_min_score,
        batches=BatchStore(res.redis, ttl_s=res.settings.job_ttl_s),
        enqueue_batch=enqueue_batch,
        metrics_path=Path(res.settings.metrics_path),
        portal_report_path=Path(res.settings.portal_report_path),
    )
