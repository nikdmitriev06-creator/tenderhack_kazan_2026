"""Конвейер модуля: описание поставщика → кандидаты → извлечение → сужение → характеристики
→ замечания.

Модуль ничего не пишет в данные портала: ответ — предложения, решение по каждому полю за человеком.
"""

import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal, Protocol

from pydantic import BaseModel, Field

from app.catalog import Catalog, CharacteristicSpec, Position
from app.checks.detector import detect, unknown_code, verdict
from app.extract import Extracted, LLMItems, extract_llm, extract_rules
from app.glossary import Glossary
from app.llm import ChatResult, LLMError, Message
from app.narrowing import (
    CONFIRM,
    NONE_VALUE,
    NOTHING_FITS,
    Known,
    KtruState,
    build_state,
    compatible,
)
from app.schemas import CardIn, CharIn, CheckOut, Issue, Span
from app.search import BM25Index, Candidate, VectorSearch, find_candidates
from app.search.text import significant_words
from app.session import Session, SessionStore
from app.values import fit_value, fold

if TYPE_CHECKING:
    from app.batch import BatchStore

log = logging.getLogger(__name__)

Degraded = Literal["llm", "embeddings"]


class ModuleLLM(Protocol):
    async def chat(
        self, messages: list[Message], *, schema: type[LLMItems], temperature: float = 0.0
    ) -> ChatResult: ...

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


@dataclass
class Deps:
    catalog: Catalog
    bm25: BM25Index
    vectors: VectorSearch | None
    llm: ModuleLLM
    glossary: Glossary
    sessions: SessionStore
    min_score: float
    batches: "BatchStore | None" = None
    # Результат последнего прогона app.tools.evaluate.
    metrics_path: Path = Path("data/metrics/latest.json")
    # Отчёт app.tools.portal_report по живым карточкам портала.
    portal_report_path: Path = Path("data/metrics/portal.json")
    # До какого момента не вызывать эмбеддинги после сбоя (time.monotonic()).
    embed_paused_until: float = 0.0
    # Постановка пакета в очередь (RabbitMQ); в тестах — подмена.
    enqueue_batch: Callable[[str], Awaitable[None]] | None = None


class SessionNotFound(KeyError):
    pass


class BadAnswer(ValueError):
    """Ответ не подходит к вопросу: характеристики нет у кандидатов или значения нет в вариантах."""


class AutofillIn(BaseModel):
    name: str = Field(min_length=1, description="наименование СТЕ, как его ввёл поставщик")
    description: str = Field(default="", description="описание в свободной форме")


class AnswerIn(BaseModel):
    characteristic: str
    value: str = Field(description="вариант вопроса; пустая строка — «нет такой характеристики»")


class CharacteristicOut(BaseModel):
    name: str
    value: str | None
    unit: str | None
    source: Span | None
    normalized_from: str | None = None
    status: Literal["filled", "normalized", "not_found", "conflict"]
    required: bool
    method: Literal["rule", "llm", "answer"] | None = None
    note: str | None = None


class AutofillOut(BaseModel):
    session_id: str
    ktru: KtruState
    characteristics: list[CharacteristicOut]
    issues: list[Issue]
    degraded: list[Degraded]


def _union_specs(positions: list[Position]) -> list[CharacteristicSpec]:
    seen: dict[str, CharacteristicSpec] = {}
    for p in positions:
        for c in p.characteristics:
            seen.setdefault(fold(c.name), c)
    return list(seen.values())


def _known_from_text(extracted: list[Extracted], positions: list[Position]) -> dict[str, Known]:
    """Значения из текста, которые сужают: подходят хотя бы одной позиции и не обнуляют выбор.

    Значение, которое не подходит ни одной позиции («Белизна 98 %» при диапазоне 146–175), —
    конфликт в карточке, а не повод выбрать позицию без этой характеристики. Значения от модели
    только предлагаются в карточку: код КТРУ по ним не выбирается.
    """
    known: dict[str, Known] = {}
    left = positions
    for e in extracted:
        if e.method != "rule":
            continue
        k = Known(value=e.raw_value, unit=e.raw_unit, source="text")
        fits_some = any(
            (spec := next((c for c in p.characteristics if fold(c.name) == fold(e.name)), None))
            and fit_value(k.value, k.unit, spec).status in ("exact", "normalized", "bucket", "typo")
            for p in left
        )
        narrowed = [p for p in left if compatible(p, {e.name: k})]
        if fits_some and narrowed:
            known[e.name] = k
            left = narrowed
    return known


def _target(state: KtruState, catalog: Catalog) -> Position | None:
    code = state.final_code or (state.candidates[0].code if state.candidates else None)
    return catalog.get(code) if code else None


def _characteristics(
    position: Position, extracted: list[Extracted], known: dict[str, Known]
) -> list[CharacteristicOut]:
    by_name = {fold(e.name): e for e in extracted}
    out = []
    for spec in position.characteristics:
        answered = known.get(spec.name)
        if answered is not None and answered.source == "answer" and answered.value:
            out.append(
                CharacteristicOut(
                    name=spec.name,
                    value=answered.value,
                    unit=spec.unit,
                    source=None,
                    status="filled",
                    required=spec.required,
                    method="answer",
                    note="ответ на уточняющий вопрос",
                )
            )
            continue
        e = by_name.get(fold(spec.name))
        if e is None:
            out.append(
                CharacteristicOut(
                    name=spec.name,
                    value=None,
                    unit=spec.unit,
                    source=None,
                    status="not_found",
                    required=spec.required,
                    note="не найдено в описании",
                )
            )
            continue
        fit = fit_value(e.raw_value, e.raw_unit, spec)
        if fit.status in ("not_in_list", "unit_mismatch", "unparsed"):
            out.append(
                CharacteristicOut(
                    name=spec.name,
                    value=e.raw_value,
                    unit=e.raw_unit or spec.unit,
                    source=e.source,
                    status="conflict",
                    required=spec.required,
                    method=e.method,
                    note=fit.note,
                )
            )
            continue
        # Показываем, во что превратился фрагмент текста: «нитриловые» → «Нитрил», «80» → корзина.
        changed = fit.value is not None and fold(fit.value) != fold(e.source.text)
        out.append(
            CharacteristicOut(
                name=spec.name,
                value=fit.value,
                unit=fit.unit,
                source=e.source,
                normalized_from=e.source.text if changed else None,
                status="normalized" if changed else "filled",
                required=spec.required,
                method=e.method,
                note=fit.note,
            )
        )
    return out


def _issues(
    session: Session, position: Position | None, chars: list[CharacteristicOut]
) -> list[Issue]:
    card = CardIn(
        name=session.name,
        description=session.description,
        characteristics=[
            CharIn(name=c.name, value=c.value, unit=c.unit) for c in chars if c.value is not None
        ],
    )
    return detect(card, position)


def render(session: Session, deps: Deps) -> AutofillOut:
    """Ответ по сессии: состояние сужения, характеристики целевой позиции, замечания."""
    positions = [p for c in session.candidates if (p := deps.catalog.get(c.code)) is not None]
    state = build_state(
        session.candidates,
        positions,
        session.known,
        unexplained=session.unexplained,
        confirmed=session.confirmed,
        rejected=session.rejected,
    )
    target = _target(state, deps.catalog)
    chars = _characteristics(target, session.extracted, session.known) if target else []
    return AutofillOut(
        session_id=session.id,
        ktru=state,
        characteristics=chars,
        issues=_issues(session, target, chars) if target else [],
        degraded=[d for d in session.degraded if d in ("llm", "embeddings")],  # type: ignore[misc]
    )


# После отказа эмбеддингов не дёргаем модель на каждом запросе: пауза, затем новая попытка.
EMBED_COOLDOWN_S = 60.0


def _embedder(deps: Deps) -> Callable[[str], Awaitable[list[float]]]:
    """Один текст → один вектор поверх LLMClient.embed (список текстов → список векторов)."""

    async def embed_one(text: str) -> list[float]:
        if time.monotonic() < deps.embed_paused_until:
            raise LLMError("эмбеддинги на паузе после сбоя")
        try:
            return (await deps.llm.embed([text]))[0]
        except LLMError:
            deps.embed_paused_until = time.monotonic() + EMBED_COOLDOWN_S
            raise

    return embed_one


async def prepare_session(inp: AutofillIn, deps: Deps) -> Session:
    """Кандидаты, извлечение и известные значения — без сохранения (пакет сессии не хранит)."""
    session = Session.new(name=inp.name, description=inp.description)
    query = deps.glossary.expand(f"{inp.name}\n{inp.description}")
    embed = _embedder(deps) if deps.vectors is not None else None
    candidates, degraded = await find_candidates(
        query,
        deps.catalog,
        deps.bm25,
        deps.vectors,
        embed,
        min_score=deps.min_score,
        gate=deps.glossary.expand(inp.name),
    )
    positions = [p for c in candidates if (p := deps.catalog.get(c.code)) is not None]
    specs = _union_specs(positions)
    extracted = extract_rules(inp.name, inp.description, specs)
    rest = [s for s in specs if fold(s.name) not in {fold(e.name) for e in extracted}]
    llm_degraded: list[Degraded] = []
    if rest:
        try:
            extracted += await extract_llm(inp.name, inp.description, rest, deps.llm, deps.glossary)
        except LLMError as exc:
            log.warning("LLM недоступна, характеристики только по правилам: %s", exc)
            llm_degraded.append("llm")
    session.candidates = candidates
    session.extracted = extracted
    session.known = _known_from_text(extracted, positions)
    session.degraded = [*llm_degraded, *degraded]
    session.unexplained = _unexplained(inp.name, candidates, deps)
    return session


def _unexplained(name: str, candidates: list[Candidate], deps: Deps) -> list[str]:
    """Значимые слова наименования, которых нет ни в одной позиции-кандидате."""
    if not candidates:
        return []
    known_tokens: set[str] = set()
    for c in candidates:
        known_tokens |= deps.bm25.doc_tokens(c.code)
    words = [
        w for w, stem in significant_words(name) if deps.bm25.correct(stem) not in known_tokens
    ]
    return list(dict.fromkeys(w.lower() for w in words))


async def autofill(inp: AutofillIn, deps: Deps) -> AutofillOut:
    session = await prepare_session(inp, deps)
    await deps.sessions.save(session)
    return render(session, deps)


def _check_answer(session: Session, inp: AnswerIn, deps: Deps) -> None:
    """Ответ подходит к вопросу: код из кандидатов, характеристика и значение из вариантов."""
    if inp.value == NOTHING_FITS:
        return
    codes = [c.code for c in session.candidates]
    if inp.characteristic == CONFIRM:
        if inp.value not in codes:
            raise BadAnswer(f"позиции {inp.value} нет среди кандидатов")
        return
    specs = [
        spec
        for code in codes
        if (p := deps.catalog.get(code)) is not None
        for spec in p.characteristics
        if fold(spec.name) == fold(inp.characteristic)
    ]
    if not specs:
        raise BadAnswer(f"у подобранных позиций нет характеристики «{inp.characteristic}»")
    if inp.value != NONE_VALUE and not any(
        fit_value(inp.value, None, spec).status in ("exact", "normalized", "bucket")
        for spec in specs
    ):
        raise BadAnswer(f"«{inp.value}» нет среди вариантов «{inp.characteristic}»")


async def answer(session_id: str, inp: AnswerIn, deps: Deps) -> AutofillOut:
    session = await deps.sessions.load(session_id)
    if session is None:
        raise SessionNotFound(session_id)
    _check_answer(session, inp, deps)
    await deps.sessions.add_answer(session_id, inp.characteristic, inp.value)
    fresh = await deps.sessions.load(session_id)
    if fresh is None:
        raise SessionNotFound(session_id)
    return render(fresh, deps)


def check(card: CardIn, deps: Deps) -> CheckOut:
    position = deps.catalog.get(card.ktru_code) if card.ktru_code else None
    issues = detect(card, position)
    if card.ktru_code and position is None:
        issues.insert(0, unknown_code(card.ktru_code))
    return CheckOut(issues=issues, verdict=verdict(issues))
