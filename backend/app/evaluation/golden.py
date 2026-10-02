"""Золотой набор для оценки (Т5): описания с известным ответом, собранные из справочника.

Четыре группы: обычные описания, описания с опечатками, товары вне справочника и карточки с
внесённой ошибкой для детектора. Порченые значения «Интенсивности цвета» взяты из фильтров каталога
портала (data/catalog/portal_filters_paper.md): так ошибаются настоящие поставщики.
"""

import random
from typing import Literal

from pydantic import BaseModel

from app.catalog import Catalog, CharacteristicSpec, Position
from app.ingest.characteristics import to_number
from app.values import fold, parse_bucket

Group = Literal["clean", "typo", "out_of_catalog", "near_domain", "corrupted"]
Corruption = Literal["not_in_list", "foreign_unit", "contradiction", "typo"]

# Товары, которых в справочнике нет: честный ответ — «категория не найдена».
OUT_OF_CATALOG = [
    "Услуги по уборке помещений",
    "Ноутбук игровой 16 ГБ, SSD 512 ГБ",
    "Автомобиль легковой седан",
    "Кофе в зёрнах арабика 1 кг",
    "Стол письменный с тумбой",
    "Огнетушитель порошковый ОП-4",
    "Шины зимние 205/55 R16",
    "Саженцы туи западной",
    "Подписка на журнал на год",
    "Ремонт кровли",
    "Микроскоп лабораторный бинокулярный",
    "Стул офисный на колёсах",
]

# Товары рядом со справочником, но не из него: общее слово с позицией есть, позиции нет. Из ревью на
# реальных строках портала (data/portal/skus.jsonl) и близких к демо-справочнику. Честный ответ —
# без
# итогового кода: отказ или вопрос с подтверждением.
NEAR_DOMAIN = [
    "Белая глина 1 кг",
    "Куприн. Белый пудель",
    "Кожа натуральная Наппа, белый",
    "Бумага туалетная 4 рулона",
    "Бумага наждачная Р120",
    "Шланг высокого давления 1SN",
    "Стержень гелевый синий",
    "Маркер перманентный черный",
    "Перчатки латексные хозяйственные",
    "Папка уголок А4",
    "Папка на резинке А4",
    "Ручка дверная",
    "Средство для мытья посуды 500 мл",
    "Картридж для смесителя 40 мм",
    "Пакет для заморозки продуктов",
]

# Введённые поставщиками значения «Интенсивности цвета» (фильтры каталога портала, 01.10.2026).
PORTAL_INTENSITY_ERRORS = ["Белый", "Пастель+интенсив", "Голубой медиум", "Лимонный"]


class GoldenCase(BaseModel):
    id: str
    group: Group
    name: str
    description: str = ""
    expected_code: str | None = None
    # Характеристика → ожидаемое значение после подгонки к перечню (корзина, значение перечня).
    expected: dict[str, str] = {}
    # Для группы corrupted: какая характеристика испорчена и как; карточка — в characteristics.
    corruption: Corruption | None = None
    corrupted_field: str | None = None
    characteristics: list[tuple[str, str, str | None]] = []


def _fmt(x: float) -> str:
    return str(int(x)) if x == int(x) else f"{x:g}".replace(".", ",")


def _sample_value(spec: CharacteristicSpec, rnd: random.Random) -> tuple[str, str] | None:
    """Значение для текста и ожидаемое значение после подгонки."""
    if spec.kind == "qualitative":
        if not spec.values:
            return None
        v = rnd.choice(spec.values)
        return v, v
    if spec.values:
        option = rnd.choice(spec.values)
        b = parse_bucket(option)
        if b is None:
            return None
        if b.is_point and b.lo is not None:
            return option, option
        lo = b.lo if b.lo is not None else (b.hi or 1) / 2
        hi = b.hi if b.hi is not None else lo * 1.2 + 1
        x = round(lo + (hi - lo) / 3)
        if not b.contains(x):
            x = lo if b.lo_incl else lo + 1
        return _fmt(x), option
    if spec.range is not None and spec.range.min is not None and spec.range.max is not None:
        x = rnd.randint(int(spec.range.min), int(spec.range.max))
        return _fmt(x), _fmt(x)
    return None


def _line(spec: CharacteristicSpec, text_value: str) -> str:
    unit = f", {spec.unit}" if spec.unit else ""
    return f"{spec.name}{unit} {text_value}"


def _typo(word: str, rnd: random.Random) -> str:
    """Перестановка двух соседних букв в середине слова."""
    i = rnd.randrange(1, len(word) - 2)
    return word[:i] + word[i + 1] + word[i] + word[i + 2 :]


def _short_name(p: Position, values: dict[str, str]) -> str:
    head = " ".join(p.name.split()[:2])
    defining = [values[c.name] for c in p.characteristics if c.level_define and c.name in values]
    return " ".join([head, *defining])


def _clean_case(p: Position, rnd: random.Random, idx: int) -> GoldenCase:
    text_values: dict[str, str] = {}
    expected: dict[str, str] = {}
    lines = []
    for spec in p.characteristics:
        sample = _sample_value(spec, rnd)
        if sample is None:
            continue
        text_values[spec.name], expected[spec.name] = sample
        lines.append(_line(spec, sample[0]))
    rnd.shuffle(lines)
    return GoldenCase(
        id=f"clean-{p.code}-{idx}",
        group="clean",
        name=_short_name(p, text_values),
        description="\n".join(lines),
        expected_code=p.code,
        expected=expected,
    )


def _typo_case(clean: GoldenCase, p: Position, rnd: random.Random) -> GoldenCase | None:
    long_values = [
        v
        for c in p.characteristics
        if c.kind == "qualitative" and (v := clean.expected.get(c.name)) and len(v) >= 6
    ]
    if not long_values:
        return None
    target = rnd.choice(long_values)
    spoiled = _typo(target, rnd)
    return clean.model_copy(
        update={
            "id": clean.id.replace("clean", "typo"),
            "group": "typo",
            "description": clean.description.replace(target, spoiled),
        }
    )


def _corrupted(p: Position, clean: GoldenCase, catalog: Catalog) -> list[GoldenCase]:
    """Карточка с одной ошибкой на вид порчи; остальные характеристики верные."""
    base = [(name, value, next((c.unit for c in p.characteristics if c.name == name), None))
            for name, value in clean.expected.items()]  # fmt: skip
    out: list[GoldenCase] = []

    def card(kind: Corruption, field: str, value: str, unit: str | None, name: str) -> None:
        chars = [(n, value if n == field else v, unit if n == field else u) for n, v, u in base]
        out.append(
            GoldenCase(
                id=f"corrupted-{kind}-{p.code}-{len(out)}",
                group="corrupted",
                name=name,
                expected_code=p.code,
                corruption=kind,
                corrupted_field=field,
                characteristics=chars,
            )
        )

    qualitative = [c for c in p.characteristics if c.kind == "qualitative" and c.values]
    numeric = [c for c in p.characteristics if c.kind == "quantitative" and c.unit]
    if qualitative:
        spec = qualitative[0]
        foreign = [v for q in catalog.all() for c in q.characteristics if c.kind == "qualitative"
                   for v in c.values if v not in spec.values and len(v) > 3]  # fmt: skip
        if spec.name == "Интенсивность цвета":
            foreign = PORTAL_INTENSITY_ERRORS + foreign
        if foreign:
            card("not_in_list", spec.name, foreign[len(out) % len(foreign)], None, clean.name)
        long_values = [v for v in spec.values if len(v) >= 6]
        if long_values:
            v = long_values[0]
            card("typo", spec.name, v[:2] + v[3] + v[2] + v[4:], None, clean.name)
        if len(spec.values) >= 2:
            right, other = spec.values[0], spec.values[1]
            # Верного значения в наименовании быть не должно: иначе случай честно неоднозначен.
            base_name = " ".join(w for w in clean.name.split() if fold(w) != fold(right))
            card("contradiction", spec.name, right, None, f"{base_name} {other.lower()}")
    if numeric:
        spec = numeric[0]
        value = clean.expected.get(spec.name, "1")
        number = to_number(value)
        shown = value if number is not None else "10"
        foreign_unit = "кг" if spec.unit not in ("кг", "г", "т", "мг") else "л"
        card("foreign_unit", spec.name, shown, foreign_unit, clean.name)
    return out


def build_golden(catalog: Catalog, seed: int = 42, per_position: int = 3) -> list[GoldenCase]:
    rnd = random.Random(seed)
    cases: list[GoldenCase] = []
    for p in catalog.all():
        for i in range(per_position):
            clean = _clean_case(p, rnd, i)
            cases.append(clean)
            if (typo := _typo_case(clean, p, rnd)) is not None:
                cases.append(typo)
        cases.extend(_corrupted(p, _clean_case(p, rnd, per_position), catalog))
    for i, text in enumerate(OUT_OF_CATALOG):
        cases.append(GoldenCase(id=f"outside-{i}", group="out_of_catalog", name=text))
    for i, text in enumerate(NEAR_DOMAIN):
        cases.append(GoldenCase(id=f"near-{i}", group="near_domain", name=text))
    return cases
