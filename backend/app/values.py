"""Значение характеристики против спецификации позиции: перечень, корзины, диапазон, единицы.

Правило проекта: значение принимается, только если оно есть в перечне или диапазоне позиции,
а единица — в каноне `app/ingest/units.py`. Остальное возвращается статусом с объяснением.
"""

import re
from typing import Literal

from pydantic import BaseModel

from app.catalog import CharacteristicSpec
from app.ingest.characteristics import parse_value, to_number
from app.ingest.units import normalize_unit

FitStatus = Literal[
    "exact", "normalized", "bucket", "typo", "not_in_list", "unit_mismatch", "unparsed"
]

# Латинские двойники кириллицы (после casefold): в перечнях «A4» латиницей, поставщики пишут «А4».
_LATIN_TO_CYRILLIC = str.maketrans("abcehkmoptxy", "авсенкмортху")

# Множители к базовой единице внутри одной размерности; между размерностями не переводим.
_SCALE: dict[str, tuple[str, float]] = {
    "мг": ("масса", 1e-3),
    "г": ("масса", 1.0),
    "кг": ("масса", 1e3),
    "т": ("масса", 1e6),
    "мл": ("объём", 1.0),
    "л": ("объём", 1e3),
    "мкм": ("длина", 1e-3),
    "мм": ("длина", 1.0),
    "см": ("длина", 10.0),
    "м": ("длина", 1e3),
    "км": ("длина", 1e6),
    # Счётные: «500 листов» для «Количество листов в пачке, шт» — та же величина.
    "шт": ("штуки", 1.0),
    "лист": ("штуки", 1.0),
}
_COUNT = {"шт", "лист"}
# Счётные единицы: листы и штуки — одна величина.
COUNT_UNITS = frozenset(_COUNT)

_MAX_LISTED = 8
MIN_TYPO_LEN = 5
_NUM_THEN_UNIT = re.compile(r"^\s*([+-]?\d+(?:[.,]\d+)?)\s*(\S.*?)\s*$")


class Bucket(BaseModel):
    lo: float | None
    lo_incl: bool
    hi: float | None
    hi_incl: bool
    text: str

    def contains(self, x: float) -> bool:
        if self.lo is not None and (x < self.lo or (x == self.lo and not self.lo_incl)):
            return False
        return not (self.hi is not None and (x > self.hi or (x == self.hi and not self.hi_incl)))

    @property
    def is_point(self) -> bool:
        return self.lo is not None and self.lo == self.hi


class Fit(BaseModel):
    status: FitStatus
    value: str | None = None
    unit: str | None = None
    note: str | None = None


def fold(text: str) -> str:
    """Ключ сравнения: регистр, ё→е, латинские двойники, пробелы и точка в конце."""
    folded = re.sub(r"\s+", " ", text.strip().rstrip(".")).casefold().replace("ё", "е")
    return folded.translate(_LATIN_TO_CYRILLIC)


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def damerau_levenshtein(a: str, b: str) -> int:
    """Расстояние с перестановкой соседних букв: «бумга» и «бумаг» — одна опечатка."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0 or lb == 0:
        return la + lb
    prev2: list[int] | None = None
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
            if prev2 is not None and i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        prev2, prev = prev, cur
    return prev[-1]


def nearest_allowed(value: str, allowed: list[str]) -> tuple[str, int] | None:
    """Ближайшее значение перечня: совпадение или правка не больше 2 символов и трети длины."""
    v = fold(value)
    best: tuple[str, int] | None = None
    for option in allowed:
        d = levenshtein(v, fold(option))
        if best is None or d < best[1]:
            best = (option, d)
    if best is None:
        return None
    if best[1] == 0:
        return best
    # Короткие коды («ПНД» и «ПВД», «XS» и «XL») — разные значения, а не опечатка.
    if len(v) < MIN_TYPO_LEN:
        return None
    return best if best[1] <= 2 and best[1] <= len(v) // 3 else None


def parse_bucket(text: str) -> Bucket | None:
    value, _ = parse_value(text)
    if value.kind == "number" and value.number is not None:
        return Bucket(lo=value.number, lo_incl=True, hi=value.number, hi_incl=True, text=text)
    if value.kind == "range":
        return Bucket(
            lo=value.low,
            lo_incl=value.low_inclusive,
            hi=value.high,
            hi_incl=value.high_inclusive,
            text=text,
        )
    return None


def convert(value: float, from_unit: str, to_unit: str) -> float | None:
    if from_unit == to_unit:
        return value
    src, dst = _SCALE.get(from_unit), _SCALE.get(to_unit)
    if src is None or dst is None or src[0] != dst[0]:
        return None
    return round(value * src[1] / dst[1], 9)


def _fmt(x: float) -> str:
    return str(int(x)) if x == int(x) else f"{x:g}".replace(".", ",")


def _listed(values: list[str]) -> str:
    head = ", ".join(f"«{v}»" for v in values[:_MAX_LISTED])
    return head + (f" и ещё {len(values) - _MAX_LISTED}" if len(values) > _MAX_LISTED else "")


def _fit_qualitative(raw: str, spec: CharacteristicSpec) -> Fit:
    value = raw.strip()
    if not spec.values:
        return Fit(status="exact", value=value, unit=spec.unit)
    if value in spec.values:
        return Fit(status="exact", value=value, unit=spec.unit)
    for option in spec.values:
        if fold(option) == fold(value):
            return Fit(
                status="normalized", value=option, unit=spec.unit, note=f"«{value}» → «{option}»"
            )
    near = nearest_allowed(value, spec.values)
    if near is not None:
        return Fit(
            status="typo", value=near[0], unit=spec.unit, note=f"опечатка: «{value}» → «{near[0]}»"
        )
    return Fit(status="not_in_list", note=f"допустимые значения: {_listed(spec.values)}")


def _fit_quantitative(raw: str, raw_unit: str | None, spec: CharacteristicSpec) -> Fit:
    target_unit = normalize_unit(spec.unit) or spec.unit
    for option in spec.values:  # значение уже записано как корзина перечня («>=80 ... <90»)
        same_unit = raw_unit is None or normalize_unit(raw_unit) == target_unit
        if fold(option) == fold(raw) and same_unit:
            return Fit(status="exact", value=option, unit=target_unit)
    parsed, unit_in_value = parse_value(raw)
    number = parsed.number if parsed.kind == "number" else to_number(raw)
    if number is None and (m := _NUM_THEN_UNIT.match(raw)) and normalize_unit(m[2]):
        # parse_value не берёт единицы с цифрами («г/м2», «м3»): разбираем сами.
        number, unit_in_value = to_number(m[1]), m[2]
    if number is None:
        return Fit(status="unparsed", note=f"«{raw.strip()}» не число")
    target = normalize_unit(spec.unit) or spec.unit
    given_raw = raw_unit or unit_in_value
    unit = normalize_unit(given_raw) if given_raw else target
    if given_raw and unit is None:
        return Fit(
            status="unit_mismatch", note=f"единица «{given_raw}» не распознана, нужна «{target}»"
        )
    converted = number if target is None or unit is None else convert(number, unit, target)
    if converted is None:
        return Fit(status="unit_mismatch", note=f"единица «{unit}» не подходит к «{target}»")
    was_converted = (
        unit is not None
        and target is not None
        and unit != target
        and not (unit in _COUNT and target in _COUNT)
    )
    shown_unit = target or unit
    if spec.range is not None:
        lo, hi = spec.range.min, spec.range.max
        if (lo is not None and converted < lo) or (hi is not None and converted > hi):
            bounds = f"{_fmt(lo) if lo is not None else '…'}–{_fmt(hi) if hi is not None else '…'}"
            return Fit(
                status="not_in_list",
                note=f"{_fmt(converted)} вне диапазона {bounds} {target or ''}".strip(),
            )
    for option in spec.values:
        bucket = parse_bucket(option)
        if bucket is None or not bucket.contains(converted):
            continue
        if not bucket.is_point:
            return Fit(
                status="bucket",
                value=option,
                unit=shown_unit,
                note=f"{_fmt(converted)} → «{option}»",
            )
        status = "normalized" if was_converted else "exact"
        return Fit(status=status, value=option, unit=shown_unit)
    if spec.values:
        return Fit(status="not_in_list", note=f"допустимые значения: {_listed(spec.values)}")
    status = "normalized" if was_converted else "exact"
    note = f"{_fmt(number)} {unit} → {_fmt(converted)} {target}" if was_converted else None
    return Fit(status=status, value=_fmt(converted), unit=shown_unit, note=note)


def fit_value(raw_value: str, raw_unit: str | None, spec: CharacteristicSpec) -> Fit:
    """Подгоняет сырое значение к спецификации; статус — что сделано или почему отказ."""
    if spec.kind == "qualitative":
        return _fit_qualitative(raw_value, spec)
    return _fit_quantitative(raw_value, raw_unit, spec)
