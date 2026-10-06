"""Извлечение характеристик моделью — только для того, что не взяли правила.

Ответ модели — не истина: элемент принимается, если имя есть среди характеристик позиции, цитата
дословно есть в тексте поставщика и содержит значение, а значение подгоняется к перечню
(`fit_value`). Позицию КТРУ такие значения не выбирают (`pipeline._known_from_text`).
Остальное отбрасывается.
"""

import logging
from typing import Protocol

import regex as re

from app.catalog import CharacteristicSpec
from app.extract.model import Extracted, LLMItems
from app.glossary import Glossary
from app.llm import ChatResult, LLMOutputError, Message
from app.schemas import Span
from app.search.text import tokens
from app.values import fit_value, fold, parse_bucket

log = logging.getLogger(__name__)

_REJECTED = {"not_in_list", "unit_mismatch", "unparsed"}
_MAX_VALUES = 30
_NUM = re.compile(r"[0-9]+(?:[.,][0-9]+)?")
# Общее начало слова цитаты и значения: «неопудренных» — «Неопудренные», «нитриловые» — «Нитрил».
MIN_COMMON_PREFIX = 4

SYSTEM = (
    "Ты извлекаешь характеристики товара из текста поставщика для каталога госзакупок. "
    'Отвечай только JSON по схеме {"items": [{"name", "value", "unit", "quote"}]}. '
    "name — строго из списка характеристик. "
    "Если у характеристики есть перечень, value — из перечня. "
    "quote — точный фрагмент текста, откуда взято значение. Чего нет в тексте — не придумывай и не "
    "включай."
)


class ChatLLM(Protocol):
    async def chat(
        self, messages: list[Message], *, schema: type[LLMItems], temperature: float = 0.0
    ) -> ChatResult: ...


def _spec_line(s: CharacteristicSpec) -> str:
    parts = [f"- {s.name}"]
    if s.unit:
        parts.append(f"единица {s.unit}")
    if s.values:
        shown = s.values[:_MAX_VALUES]
        parts.append(
            "перечень: " + "; ".join(shown) + (" …" if len(s.values) > _MAX_VALUES else "")
        )
    elif s.range is not None:
        parts.append(f"диапазон {s.range.min}–{s.range.max}")
    return ", ".join(parts)


def build_messages(
    name: str, description: str, specs: list[CharacteristicSpec], glossary: Glossary
) -> list[Message]:
    text = f"Наименование: {name}\nОписание: {description or '(нет)'}"
    abbrs = glossary.prompt_block(f"{name}\n{description}")
    user = "Характеристики позиции:\n" + "\n".join(_spec_line(s) for s in specs)
    if abbrs:
        user += f"\n\nСокращения в тексте:\n{abbrs}"
    user += f"\n\nТекст поставщика:\n{text}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def _quote_has_value(quote: str, value: str, glossary: Glossary) -> bool:
    """Значение видно в цитате: числа — те же, слова — та же основа (с расшифровкой сокращений)."""
    nums = {n.replace(",", ".") for n in _NUM.findall(value)}
    if nums:
        found = {n.replace(",", ".") for n in _NUM.findall(quote)}
        bucket = parse_bucket(value)
        if bucket is not None and not bucket.is_point:  # «>=80 ... <90» и «80 г/м2» в цитате
            return any(bucket.contains(float(n)) for n in found)
        return nums <= found
    words = set(tokens(glossary.expand(quote))) | set(tokens(quote))
    if len(value.strip()) <= 2:  # «A», «M», «XL»: только целым словом
        return fold(value.strip()) in {fold(w) for w in re.findall(r"[\p{L}\p{N}]+", quote)}
    need = tokens(value)
    return bool(need) and any(any(_same_stem(v, w) for w in words) for v in need)


def _same_stem(a: str, b: str) -> bool:
    if a == b:
        return True
    n = min(len(a), len(b))
    return n >= MIN_COMMON_PREFIX and a[:n] == b[:n]


def _locate(quote: str, name: str, description: str) -> Span | None:
    q = quote.strip()
    if not q:
        return None
    for field, text in (("name", name), ("description", description)):
        at = text.find(q)
        if at >= 0:
            return Span(field=field, start=at, end=at + len(q), text=q)
    return None


async def extract_llm(
    name: str,
    description: str,
    specs: list[CharacteristicSpec],
    llm: ChatLLM,
    glossary: Glossary,
) -> list[Extracted]:
    """Элементы ответа модели, прошедшие проверку кодом; LLMError (нет связи) — наружу."""
    if not specs:
        return []
    messages = build_messages(name, description, specs, glossary)
    reply: LLMItems | None = None
    for attempt in (1, 2):
        try:
            result = await llm.chat(messages, schema=LLMItems)
        except LLMOutputError as exc:
            log.warning("ответ модели не прошёл схему (попытка %d): %s", attempt, exc)
            continue
        reply = result.parsed if isinstance(result.parsed, LLMItems) else None
        break
    if reply is None:
        return []
    by_name = {s.name: s for s in specs}
    out: list[Extracted] = []
    for item in reply.items:
        spec = by_name.get(item.name)
        span = _locate(item.quote, name, description)
        if spec is None or span is None or item.name in {e.name for e in out}:
            continue
        if not _quote_has_value(item.quote, item.value, glossary):
            continue  # цитата есть в тексте, но значения в ней нет — значение придумано
        if fit_value(item.value, item.unit, spec).status in _REJECTED:
            continue
        out.append(
            Extracted(
                name=spec.name, raw_value=item.value, raw_unit=item.unit, source=span, method="llm"
            )
        )
    return out
