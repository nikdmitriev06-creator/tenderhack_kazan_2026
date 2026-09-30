import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import health, jobs
from app.config import get_settings
from app.resources import Resources


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    app.state.resources = Resources.create(settings)
    try:
        yield
    finally:
        await app.state.resources.close()


def create_app() -> FastAPI:
    app = FastAPI(title="TenderHack Kazan 2026", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")
    return app


app = create_app()
