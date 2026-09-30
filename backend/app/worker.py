"""Воркер фоновых задач: `faststream run app.worker:app`."""

import logging
import socket

from faststream import Context, ContextRepo, FastStream
from redis.asyncio import Redis

from app.config import get_settings
from app.jobs import PING_QUEUE, JobState, PingJob, job_key
from app.resources import create_broker

settings = get_settings()
broker = create_broker(settings)
app = FastStream(broker)
log = logging.getLogger(__name__)


@app.on_startup
async def open_redis(context: ContextRepo) -> None:
    logging.basicConfig(
        level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    context.set_global("redis", Redis.from_url(settings.redis_url, decode_responses=True))


@app.after_shutdown
async def close_redis(redis: Redis = Context()) -> None:
    await redis.aclose()


@broker.subscriber(PING_QUEUE)
async def handle_ping(job: PingJob, redis: Redis = Context()) -> None:
    state = JobState(job_id=job.job_id, status="done", detail=f"воркер {socket.gethostname()}")
    await redis.set(job_key(job.job_id), state.model_dump_json(), ex=settings.job_ttl_s)
    log.info("ping %s обработан", job.job_id)
