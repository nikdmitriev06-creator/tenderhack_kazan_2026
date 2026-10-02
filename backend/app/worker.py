"""Воркер фоновых задач: `faststream run app.worker:app`."""

import logging
import socket

from faststream import Context, ContextRepo, FastStream
from redis.asyncio import Redis

from app.batch import run_batch
from app.config import get_settings
from app.jobs import BATCH_QUEUE, PING_QUEUE, BatchJob, JobState, PingJob, job_key
from app.pipeline import Deps
from app.resources import Resources, build_deps, create_broker

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
    # Те же справочник, индекс и модель, что у API: строки пакета идут тем же конвейером.
    resources = Resources.create(settings)
    context.set_global("resources", resources)
    context.set_global("deps", build_deps(resources))


@app.after_shutdown
async def close_redis(redis: Redis = Context(), resources: Resources = Context()) -> None:
    await redis.aclose()
    await resources.close()


@broker.subscriber(PING_QUEUE)
async def handle_ping(job: PingJob, redis: Redis = Context()) -> None:
    state = JobState(job_id=job.job_id, status="done", detail=f"воркер {socket.gethostname()}")
    await redis.set(job_key(job.job_id), state.model_dump_json(), ex=settings.job_ttl_s)
    log.info("ping %s обработан", job.job_id)


@broker.subscriber(BATCH_QUEUE)
async def handle_batch(job: BatchJob, deps: Deps = Context()) -> None:
    log.info("пакет %s: старт", job.job_id)
    await run_batch(job.job_id, deps)
    log.info("пакет %s: готово", job.job_id)
