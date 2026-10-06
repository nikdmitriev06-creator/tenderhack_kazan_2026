"""Строит векторный индекс справочника: `python -m app.tools.index_catalog`.

Без доступной модели эмбеддингов завершается с кодом 1 и текстом причины: пустой индекс молча не
создаётся (поиск тогда честно работает по BM25 и помечает ответ `degraded: ["embeddings"]`).
"""

import asyncio
import logging
import sys

from sqlalchemy.ext.asyncio import create_async_engine

from app.catalog import Catalog
from app.config import get_settings
from app.llm import LLMClient
from app.search.vectors import EmbeddingIndex, position_text

BATCH = 32
log = logging.getLogger(__name__)


async def run() -> int:
    settings = get_settings()
    catalog = Catalog.load(settings.catalog_files())
    llm = LLMClient.from_settings(settings)
    engine = create_async_engine(settings.database_url)
    try:
        positions = catalog.all()
        rows: list[tuple[str, list[float]]] = []
        for i in range(0, len(positions), BATCH):
            chunk = positions[i : i + BATCH]
            try:
                vectors = await llm.embed([position_text(p) for p in chunk])
            except Exception as exc:  # noqa: BLE001 — любой отказ модели: индекс не строим
                print(f"эмбеддинги недоступны ({settings.embed_model}): {exc}", file=sys.stderr)
                return 1
            rows.extend(zip((p.code for p in chunk), vectors, strict=True))
        index = EmbeddingIndex(engine, llm.embed_model, catalog.version)
        await index.replace(rows)
        print(
            f"проиндексировано позиций: {len(rows)} (модель {llm.embed_model}, {catalog.version})"
        )
        return 0
    finally:
        await llm.aclose()
        await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sys.exit(asyncio.run(run()))
