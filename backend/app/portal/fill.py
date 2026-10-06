"""Заполнение на живых карточках портала: что модуль извлёк из наименования и описания против того,
что поставщик ввёл в характеристики.

Значение портала — не эталон (поставщики ошибаются), поэтому метрика называется «совпадение с
порталом». Полнота считается по значениям, которые видны в тексте карточки: характеристику, о
которой текст молчит, модуль честно оставляет пустой.
"""

from typing import Literal

import regex as re
from pydantic import BaseModel

from app.evaluation.metrics import MetricRow
from app.extract import extract_rules
from app.ingest.characteristics import to_number
from app.portal.cards import PortalCard, PortalChar
from app.portal.values import ValueIndex, card_specs, strip_gloss
from app.search.text import tokens
from app.values import fit_value, fold

# Основа слова и форма: «белая» — «Белый», не длиннее основы на столько букв.
MAX_ENDING = 3
MIN_STEM = 4


class CharOutcome(BaseModel):
    card_id: int
    name: str
    truth: str
    unit: str | None = None
    numeric: bool = False
    extracted: str | None = None
    source_field: Literal["name", "description"] | None = None
    source_text: str | None = None
    source_start: int | None = None
    evidenced: bool = False
    correct: bool = False


def _same_number(a: str, b: str) -> bool:
    x, y = to_number(a), to_number(b)
    return x is not None and y is not None and abs(x - y) <= 1e-9 * max(1.0, abs(y))


def _stem_match(word: str, stem: str) -> bool:
    return word == stem or (
        len(stem) >= MIN_STEM and word.startswith(stem) and len(word) - len(stem) <= MAX_ENDING
    )


def same_value(value: str, truth: PortalChar) -> bool:
    """Совпадение с портальным значением; пояснение в скобках («желтый (yellow)») не в счёт."""
    if truth.numeric:
        return _same_number(value, truth.value)
    value, expected = strip_gloss(value), strip_gloss(truth.value)
    if fold(value) == fold(expected):
        return True
    a, b = tokens(value), tokens(expected)
    return (
        bool(a) and len(a) == len(b) and all(_stem_match(x, y) for x, y in zip(a, b, strict=True))
    )


def evidenced(truth: PortalChar, text: str) -> bool:
    """Значение видно в тексте карточки: то же число или те же слова (в любой форме)."""
    if truth.numeric:
        variants = {truth.value, truth.value.replace(",", ".")}
        return any(re.search(rf"(?<![\d.,]){re.escape(v)}(?![\d]|[.,]\d)", text) for v in variants)
    need = tokens(truth.value)
    words = tokens(text)
    return bool(need) and all(any(_stem_match(w, s) for w in words) for s in need)


def compare_card(card: PortalCard, index: ValueIndex) -> list[CharOutcome]:
    specs = {fold(s.name): s for s in card_specs(card, index)}
    found = {
        fold(e.name): e for e in extract_rules(card.name, card.description, list(specs.values()))
    }
    out = []
    for ch in card.characteristics:
        spec = specs.get(fold(ch.name))
        if spec is None:
            continue
        e = found.get(fold(ch.name))
        extracted = None
        if e is not None:
            fit = fit_value(e.raw_value, e.raw_unit, spec)
            extracted = fit.value or e.raw_value
        out.append(
            CharOutcome(
                card_id=card.id,
                name=ch.name,
                truth=ch.value,
                unit=ch.unit,
                numeric=ch.numeric,
                extracted=extracted,
                source_field=e.source.field if e else None,
                source_text=e.source.text if e else None,
                source_start=e.source.start if e else None,
                evidenced=evidenced(ch, card.text),
                correct=extracted is not None and same_value(extracted, ch),
            )
        )
    return out


def fill_rows(outcomes: list[CharOutcome]) -> list[MetricRow]:
    extracted = [o for o in outcomes if o.extracted is not None]
    seen = [o for o in outcomes if o.evidenced]
    return [
        MetricRow(
            key="portal_evidence",
            title="Портал: значение характеристики видно в тексте карточки",
            value=len(seen) / len(outcomes) if outcomes else 0.0,
            n=len(outcomes),
            how="доля значений, введённых поставщиком, которые есть в наименовании или описании "
            "(то же число или те же слова); остальное текст карточки не содержит",
        ),
        MetricRow(
            key="portal_fill_precision",
            title="Портал: точность заполнения",
            value=sum(o.correct for o in extracted) / len(extracted) if extracted else 0.0,
            n=len(extracted),
            how="доля значений, извлечённых модулем правилами, которые совпали с введёнными "
            "поставщиком; перечень характеристики взят из других карточек категории",
        ),
        MetricRow(
            key="portal_fill_recall",
            title="Портал: полнота по видимым в тексте значениям",
            value=sum(o.correct for o in seen) / len(seen) if seen else 0.0,
            n=len(seen),
            how="доля значений, видимых в тексте карточки, которые модуль заполнил так же, "
            "как поставщик",
        ),
    ]
