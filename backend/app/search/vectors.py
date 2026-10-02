"""Векторный индекс позиций справочника в pgvector (таблица catalog_embedding)."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.catalog import Position


class EmbeddingIndexEmpty(RuntimeError):
    """Индекс не построен для модели и версии справочника.

    Построить: `python -m app.tools.index_catalog`.
    """


def position_text(p: Position, limit: int = 1000) -> str:
    """Текст позиции для эмбеддинга: наименование, имена характеристик и значения."""
    parts = [p.name]
    for c in p.characteristics:
        parts.append(f"{c.name}: {', '.join(c.values)}" if c.values else c.name)
    return ". ".join(parts)[:limit]


def _literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{x:.7g}" for x in vector) + "]"


class EmbeddingIndex:
    def __init__(self, engine: AsyncEngine, model: str, catalog_version: str) -> None:
        self.engine, self.model, self.catalog_version = engine, model, catalog_version
        self._ready = False

    async def count(self) -> int:
        async with self.engine.connect() as conn:
            result = await conn.execute(
                text(
                    "SELECT count(*) FROM catalog_embedding "
                    "WHERE model = :m AND catalog_version = :v"
                ),
                {"m": self.model, "v": self.catalog_version},
            )
            return int(result.scalar_one())

    async def ready(self) -> bool:
        """Есть ли векторы этой модели и версии справочника (кэшируется после первого «да»)."""
        if not self._ready:
            self._ready = await self.count() > 0
        return self._ready

    async def search(self, vector: list[float], k: int = 20) -> list[tuple[str, float]]:
        if not await self.ready():
            raise EmbeddingIndexEmpty(
                f"нет векторов для модели {self.model} и справочника {self.catalog_version}"
            )
        async with self.engine.connect() as conn:
            rows = await conn.execute(
                text(
                    "SELECT code, 1 - (vec <=> CAST(:q AS vector)) AS sim FROM catalog_embedding "
                    "WHERE model = :m AND catalog_version = :v "
                    "ORDER BY vec <=> CAST(:q AS vector) LIMIT :k"
                ),
                {"q": _literal(vector), "m": self.model, "v": self.catalog_version, "k": k},
            )
            return [(r.code, float(r.sim)) for r in rows]

    async def replace(self, rows: list[tuple[str, list[float]]]) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM catalog_embedding WHERE model = :m AND catalog_version = :v"),
                {"m": self.model, "v": self.catalog_version},
            )
            for code, vec in rows:
                await conn.execute(
                    text(
                        "INSERT INTO catalog_embedding (code, model, catalog_version, vec) "
                        "VALUES (:c, :m, :v, CAST(:vec AS vector))"
                    ),
                    {"c": code, "m": self.model, "v": self.catalog_version, "vec": _literal(vec)},
                )
