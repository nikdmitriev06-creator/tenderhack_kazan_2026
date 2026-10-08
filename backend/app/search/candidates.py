"""Кандидаты позиций справочника по тексту поставщика: BM25 + эмбеддинги, слияние RRF."""

import logging
from collections.abc import Awaitable, Callable
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel

from app.catalog import Catalog
from app.llm import LLMError
from app.search.bm25 import BM25Index
from app.search.text import negated_stems, tokens, without_negations, words_with_stems
from app.search.vectors import EmbeddingIndexEmpty

log = logging.getLogger(__name__)

# Отсечка слабого хвоста: кандидат с оценкой меньше этой доли от лучшего не сужается.
TAIL_SHARE = 0.5
# Векторный кандидат без общих слов принимается только при уверенной близости.
MIN_COSINE = 0.6
# Совпадение с наименованием позиции считается по словам не короче (коды «A4» не в счёт).
MIN_NAME_TOKEN = 3


class Candidate(BaseModel):
    code: str
    name: str
    score: float
    why: list[str]


class VectorSearch(Protocol):
    async def search(self, vector: list[float], k: int = 20) -> list[tuple[str, float]]: ...


def build_bm25(catalog: Catalog) -> BM25Index:
    """Документ позиции: наименование дважды (оно важнее), ОКПД2, имена характеристик и значения."""
    docs = {}
    for p in catalog.all():
        parts = [p.name, p.name, p.okpd2]
        for c in p.characteristics:
            parts.append(c.name)
            parts.extend(c.values)
        docs[p.code] = " ".join(parts)
    return BM25Index(docs)


def rrf(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, code in enumerate(ranking):
            scores[code] = scores.get(code, 0.0) + 1 / (k + rank + 1)
    return sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))


async def _vector_hits(
    text: str,
    vectors: VectorSearch | None,
    embed: Callable[[str], Awaitable[list[float]]] | None,
    k: int,
) -> tuple[list[tuple[str, float]], bool]:
    """Векторные кандидаты и признак отказа (нет индекса, нет модели, сбой)."""
    if vectors is None or embed is None:
        return [], True
    try:
        ready = getattr(vectors, "ready", None)
        if ready is not None and not await ready():
            return [], True  # индекс не построен: модель эмбеддингов не дёргаем зря
        return await vectors.search(await embed(text), k), False
    except (LLMError, EmbeddingIndexEmpty, httpx.HTTPError) as exc:
        # Отказ сервиса эмбеддингов — работаем по BM25 и говорим об этом. Ошибки кода не глотаем.
        log.warning("эмбеддинги недоступны, поиск только по BM25: %s", exc)
        return [], True


async def find_candidates(
    text: str,
    catalog: Catalog,
    bm25: BM25Index,
    vectors: VectorSearch | None,
    embed: Callable[[str], Awaitable[list[float]]] | None,
    k: int = 20,
    min_score: float = 0.2,
    gate: str | None = None,
) -> tuple[list[Candidate], list[Literal["embeddings"]]]:
    """Кандидаты по убыванию RRF; пусто — товар вне справочника.

    Отказ честный: «ближайшая» позиция с уверенностью не подставляется.
    """
    # Порог «вне справочника» — по наименованию (gate): длинное описание с номерами и брендами
    # размывает нормированную оценку. Ранжирование — по всему тексту. Отрицаемые слова («не
    # нитриловые», «без хлора») в поиск не идут и исключают позиции, где они есть.
    gate_text = without_negations(gate or text)
    query = without_negations(text)
    negated = negated_stems(f"{gate or ''} {text}")
    gate_hits = bm25.search(gate_text, 1)
    overlap = bm25.known_overlap(gate_text, gate_hits[0][0]) if gate_hits else 0
    gate_score = (
        gate_hits[0][1] / (bm25.max_score(gate_text, matched_known=overlap) or 1.0)
        if gate_hits
        else 0.0
    )
    raw_hits = bm25.search(query, k) if gate_score >= min_score else []
    hits = raw_hits
    # Второе условие другой природы: хотя бы одно слово запроса есть в наименовании позиции,
    # а не только в значениях её характеристик («белый» есть в перечнях у многих позиций).
    asked = {t for t in bm25.query_tokens(gate_text) if len(t) >= MIN_NAME_TOKEN}
    hits = [
        (c, s)
        for c, s in hits
        if (p := catalog.get(c)) is not None
        and asked & set(tokens(p.name))
        and not negated & bm25.doc_tokens(c)
    ]
    best = hits[0][1] if hits else 0.0
    lexical = [(c, s) for c, s in hits if s >= TAIL_SHARE * best]
    vector_hits, failed = await _vector_hits(text, vectors, embed, k)
    vector_hits = [(c, s) for c, s in vector_hits if s >= MIN_COSINE and catalog.get(c)]
    degraded: list[Literal["embeddings"]] = ["embeddings"] if failed else []
    log.info(
        "поиск: gate=%.3f bm25=%d после_имени=%d лексических=%d векторных=%d эмбеддинги=%s",
        gate_score,
        len(raw_hits),
        len(hits),
        len(lexical),
        len(vector_hits),
        "сбой" if failed else "ok",
    )
    if not lexical and not vector_hits:
        return [], degraded
    words = words_with_stems(text)
    out = []
    for code, score in rrf([[c for c, _ in lexical], [c for c, _ in vector_hits]]):
        position = catalog.get(code)
        if position is None:
            continue
        matched = bm25.matched(text, code)
        why = list(
            dict.fromkeys(
                w.lower() for w, stem in words if bm25.correct(stem) in matched and not w.isdigit()
            )
        )
        out.append(Candidate(code=code, name=position.name, score=round(score, 6), why=why))
    return out, degraded
