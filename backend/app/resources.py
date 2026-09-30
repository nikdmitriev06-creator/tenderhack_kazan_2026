"""Подключения к внешним сервисам: создаются один раз на процесс и живут в app.state."""

import logging
from dataclasses import dataclass, field

from faststream.rabbit import RabbitBroker
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import Settings
from app.jobs import QUEUES
from app.llm import LLMClient

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
    broker_started: bool = field(default=False)

    @classmethod
    def create(cls, settings: Settings) -> "Resources":
        return cls(
            settings=settings,
            engine=create_async_engine(settings.database_url, pool_pre_ping=True),
            redis=Redis.from_url(settings.redis_url, decode_responses=True),
            broker=create_broker(settings),
            llm=LLMClient.from_settings(settings),
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
