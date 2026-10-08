"""Извлечение характеристик правилами: без модели, с точным местом в тексте.

Порядок (первое найденное для характеристики побеждает):
1. строки описания вида «метка[, ед.] значение» — метка сопоставляется с именем характеристики
   позиции;
2. числа с единицей в наименовании («500л», «60 л», «20 шт») — через правила модерации
   (`moderation`);
3. значение из перечня позиции, встреченное в тексте словом целиком («А4», «ПНД», «нестерильные»).
"""

from collections.abc import Iterator
from functools import lru_cache
from typing import Literal

import regex as re

from app.catalog import CharacteristicSpec
from app.checks.moderation import (
    SINGLE_NUM,
    UNIT_ALIAS,
    TitleValue,
    find_title_values,
    target_char,
)
from app.extract.model import Extracted
from app.extract.quantities import bare_values, number_in_range, phrase_values
from app.glossary import Glossary
from app.ingest.units import normalize_unit
from app.schemas import Span
from app.search.text import tokens
from app.values import convert, damerau_levenshtein, fit_value, fold

Field = Literal["name", "description"]
_OK = {"exact", "normalized", "bucket", "typo"}

# Метка совпала, если в ней есть не меньше половины слов имени характеристики.
MIN_LABEL_OVERLAP = 0.5
_SEGMENT = re.compile(r"[^\n;]+")
# Конец предложения: точка после буквы или скобки и пробел («1.5» и «0,5» не режем).
_SENTENCE = re.compile(r"(?<=[\p{L})])\.\s+")
_COMMA = re.compile(r",\s*")
_LEAD_WORD = re.compile(r"\p{L}+")
# Единица в метке стоит перед числом или «/» («, г/м2 80», «, мкм 30»); «, в рулоне» — предлог.
_AFTER_UNIT = re.compile(r"\s*(?:[/0-9]|$)")
# Значение после двоеточия — до конца фразы.
_PHRASE_END = re.compile(r"[,.;]")
_NUMBER = re.compile(r"(?<![\p{L}\p{N}.,])[0-9]+(?:[.,][0-9]+)?(?![\p{N}])")
_LABEL_UNIT = re.compile(r",\s*([^\s,0-9][^,0-9]{0,11}?)\s+[0-9]")
_WORD = re.compile(r"[\p{L}\p{N}]+(?:[-/][\p{L}\p{N}]+)*")
_BARE_NUMBER = re.compile(r"[0-9]+(?:[.,][0-9]+)?")
# Латинские двойники с сохранением регистра: короткие значения («M», «XL») сравниваются по регистру.
_CASE_FOLD = str.maketrans("ABCEHKMOPTXYaceopxy", "АВСЕНКМОРТХУасеорху")


def _comma_parts(segment: str, offset: int) -> Iterator[tuple[int, str]]:
    """Делит по запятой, если после неё новая фраза, а не единица («, г 80» — единица)."""
    start = 0
    for cm in _COMMA.finditer(segment):
        nxt = _LEAD_WORD.match(segment, cm.end())
        unit = nxt and normalize_unit(nxt[0]) and _AFTER_UNIT.match(segment, nxt.end())
        if nxt and not unit:
            if segment[start : cm.start()].strip():
                yield offset + start, segment[start : cm.start()]
            start = cm.end()
    if segment[start:].strip():
        yield offset + start, segment[start:]


def _segments(text: str) -> Iterator[tuple[int, str]]:
    """Фразы описания: строки, «;», конец предложения и запятая перед новой меткой."""
    for m in _SEGMENT.finditer(text):
        line, base, start = m[0], m.start(), 0
        for sm in _SENTENCE.finditer(line):
            yield from _comma_parts(line[start : sm.start()], base + start)
            start = sm.end()
        yield from _comma_parts(line[start:], base + start)


def _overlap(spec_name: str, label: str) -> float:
    need = set(tokens(spec_name))
    return len(need & set(tokens(label))) / len(need) if need else 0.0


def _label_score(spec_name: str, label: str) -> float:
    """Совпадение метки с именем характеристики: половина слов имени и не одно случайное слово.

    Одного общего слова мало («Масса бумаги…» — не «Класс бумаги»), если только метка с него не
    начинается («Толщина, мкм 104» — «Толщина»).
    """
    need = set(tokens(spec_name))
    words = tokens(label)
    got = need & set(words)
    if not need or len(got) / len(need) < MIN_LABEL_OVERLAP:
        return 0.0
    if len(got) >= 2 or (words and words[0] in got):
        return len(got) / len(need)
    return 0.0


def _unit_hint(segment: str, spec: CharacteristicSpec) -> str | None:
    """Единица из метки («Толщина, мкм 104») — только если она той же величины, что у позиции."""
    m = _LABEL_UNIT.search(segment)
    unit = normalize_unit(m[1]) if m else None
    target = normalize_unit(spec.unit) or spec.unit
    if unit is None or target is None:
        return None
    return unit if convert(1.0, unit, target) is not None else None


def _labelled_list(field: Field, text: str, specs: list[CharacteristicSpec]) -> Iterator[Extracted]:
    """«Интенсивность цвета: Медимум» — значение после двоеточия как написано; подгонка позже."""
    for offset, segment in _segments(text):
        label, colon, rest = segment.partition(":")
        value = _PHRASE_END.split(rest, maxsplit=1)[0].strip()
        if not colon or not value:
            continue
        scored = [(s, _label_score(s.name, label)) for s in specs if s.kind == "qualitative"]
        scored = [(s, o) for s, o in scored if o > 0]
        if not scored:
            continue
        spec = max(scored, key=lambda so: (so[1], len(so[0].name)))[0]
        start = offset + len(label) + 1 + (len(rest) - len(rest.lstrip()))
        yield Extracted(
            name=spec.name,
            raw_value=value,
            raw_unit=None,
            source=Span(field=field, start=start, end=start + len(value), text=value),
            method="rule",
        )


def _labelled(field: Field, text: str, specs: list[CharacteristicSpec]) -> Iterator[Extracted]:
    for offset, segment in _segments(text):
        scored = [(s, _label_score(s.name, segment)) for s in specs if s.kind == "quantitative"]
        scored = [(s, o) for s, o in scored if o > 0]
        if not scored:
            continue
        spec = max(scored, key=lambda so: (so[1], len(so[0].name)))[0]
        numbers = list(_NUMBER.finditer(segment))
        if not numbers:
            continue
        last = numbers[-1]  # значение — в конце строки, числа в метке («1 м2») раньше
        yield Extracted(
            name=spec.name,
            raw_value=last[0],
            raw_unit=_unit_hint(segment, spec),
            source=Span(
                field=field, start=offset + last.start(), end=offset + last.end(), text=last[0]
            ),
            method="rule",
        )


# Граница или множитель перед числом: «до 80 г/м2», «2x80 г/м2», «А480 г/м2» — не значение.
_NOT_PLAIN_BEFORE = re.compile(r"(?:(?<!\p{L})(?:до|от|по|на)\s+|\p{L}|[*×xх]\s*)\Z", re.IGNORECASE)


def _per_unit(name: str, v: TitleValue) -> str | None:
    """Единица через «/» у одиночного числа («80 г/м2») — в каноне ОКЕИ, иначе None."""
    tail = name[v.at + len(v.num) : v.end].strip().rstrip(".")
    if "/" not in tail or not SINGLE_NUM.match(v.num) or _NOT_PLAIN_BEFORE.search(name[: v.at]):
        return None
    return normalize_unit(tail)


def _from_compound(name: str, v: TitleValue, specs: list[CharacteristicSpec]) -> Extracted | None:
    """«80 г/м2» — в единственную количественную характеристику с той же единицей."""
    unit = _per_unit(name, v)
    if unit is None:
        return None
    fits = [
        s
        for s in specs
        if s.kind == "quantitative" and (normalize_unit(s.unit or "") or s.unit) == unit
    ]
    if len(fits) != 1:
        return None
    text = name[v.at : v.end].rstrip()
    return Extracted(
        name=fits[0].name,
        raw_value=re.sub(r"\s", "", v.num),
        raw_unit=unit,
        source=Span(field="name", start=v.at, end=v.at + len(text), text=text),
        method="rule",
    )


def _from_name(name: str, specs: list[CharacteristicSpec]) -> Iterator[Extracted]:
    for v in find_title_values(name):
        if number_in_range(name, v.at):
            continue
        if v.compound:
            if (e := _from_compound(name, v, specs)) is not None:
                yield e
            continue
        target = target_char(v.unit, name, v.at)
        if target is None:
            continue
        t_name, t_unit = target
        unit = normalize_unit(t_unit) or t_unit
        scored: list[tuple[float, CharacteristicSpec]] = []
        for s in specs:
            spec_unit = normalize_unit(s.unit) or s.unit
            if (
                s.kind != "quantitative"
                or spec_unit is None
                or convert(1.0, unit, spec_unit) is None
            ):
                continue
            score = 1.0 if fold(s.name) == fold(t_name) else _overlap(t_name, s.name)
            if score >= MIN_LABEL_OVERLAP:
                scored.append((score, s))
        best = max((sc for sc, _ in scored), default=0.0)
        fits = [s for sc, s in scored if sc == best]
        if len(fits) != 1:
            continue  # ни одной или несколько равных по совпадению — решит LLM или человек
        num_end = v.at + len(v.num)
        yield Extracted(
            name=fits[0].name,
            raw_value=re.sub(r"\s", "", v.num),
            raw_unit=unit,
            source=Span(field="name", start=v.at, end=num_end, text=name[v.at : num_end]),
            method="rule",
        )


def _same_word(word: str, value: str) -> bool:
    if len(value) <= 2:  # «M», «XL», «A4»-подобные коды: только точное слово с учётом регистра
        return word.translate(_CASE_FOLD) == value.translate(_CASE_FOLD)
    if fold(word) == fold(value):
        return True
    stem = tokens(value)
    return len(stem) == 1 and len(stem[0]) >= 4 and fold(word).startswith(stem[0])


def _phrase_spans(words: list[re.Match[str]], value: str) -> Iterator[tuple[int, int]]:
    """Места, где значение из нескольких слов стоит в тексте подряд («Хризантема кустовая»)."""
    parts = _WORD.findall(value)
    n = len(parts)
    for i in range(len(words) - n + 1):
        if all(_same_word(words[i + j][0], parts[j]) for j in range(n)):
            yield words[i].start(), words[i + n - 1].end()


def _list_values(field: Field, text: str, specs: list[CharacteristicSpec]) -> Iterator[Extracted]:
    words = list(_WORD.finditer(text))
    for spec in specs:
        if spec.kind != "qualitative" or not spec.values:
            continue
        hits: dict[str, tuple[int, int]] = {}
        for value in spec.values:
            if _BARE_NUMBER.fullmatch(value.strip()):
                continue  # «20» в перечне: в тексте это может быть что угодно (размер колеса, год)
            if len(_WORD.findall(value)) > 1:
                for span in _phrase_spans(words, value):
                    hits.setdefault(value, span)
                continue
            for i, w in enumerate(words):
                prev = words[i - 1][0] if i > 0 else ""
                if len(value) <= 2 and prev[:1].isdigit():
                    continue  # «5 м» — метры, а не размер M
                if _same_word(w[0], value):
                    hits.setdefault(value, (w.start(), w.end()))
        # Короткое значение внутри найденной фразы («Хризантема» в «Хризантема кустовая») — та же
        # находка, а не второе значение.
        hits = {
            v: (a, b)
            for v, (a, b) in hits.items()
            if not any(a2 <= a and b <= b2 and (a2, b2) != (a, b) for a2, b2 in hits.values())
        }
        if len(hits) != 1:
            continue  # в тексте два разных значения перечня — неоднозначно
        value, (start, end) = next(iter(hits.items()))
        yield Extracted(
            name=spec.name,
            raw_value=value,  # значение перечня; словоформа из текста — в source
            raw_unit=None,
            source=Span(field=field, start=start, end=end, text=text[start:end]),
            method="rule",
        )


# Слова, которые есть почти у каждой количественной характеристики: одно такое совпадение
# ещё не значит, что фраза про эту характеристику.
_GENERIC_STEMS = ("объем", "количеств", "размер", "тип", "вид")
# Разговорные имена и аббревиатуры, чья словарная расшифровка не делит стем с именем КТРУ
# («ОЗУ» — «запоминающее устройство», а в позиции — «оперативная память»).
_LABEL_EQUIV: dict[str, tuple[str, ...]] = {
    "озу": ("оперативн", "памят"),
    "ram": ("оперативн", "памят"),
    "оперативк": ("оперативн", "памят"),
    "ssd": ("накопител", "твердотельн"),
    "hdd": ("накопител", "жестк"),
}
_NUM_UNIT = re.compile(
    r"(?<![\p{L}\p{N}])(?P<num>[0-9]+(?:[.,][0-9]+)?)(?![\p{N}])"
    r"\s*(?P<unit>[A-Za-zА-Яа-яЁё%][A-Za-zА-Яа-яЁё0-9%./]{0,12})?"
)
_CLAUSE_SPLIT = re.compile(r"[;()]")
_BOUND_LABEL = re.compile(r"(?:^|\s)(?:до|от|по)\s*$", re.IGNORECASE)


@lru_cache(maxsize=1)
def _label_glossary() -> Glossary:
    return Glossary.load()


def _canon_unit(raw: str | None) -> str | None:
    if not raw:
        return None
    unit = normalize_unit(raw)
    if unit:
        return unit
    alias = UNIT_ALIAS.get(raw) or UNIT_ALIAS.get(raw.upper())
    if not alias:
        return None
    return normalize_unit(alias) or alias


def _token_close(left: str, right: str) -> bool:
    if left == right:
        return True
    if len(left) < 5 or len(right) < 5:
        return False
    distance = damerau_levenshtein(left, right)
    return distance <= 1 or (distance <= 2 and distance <= min(len(left), len(right)) // 4)


def _distinctive(stem: str) -> bool:
    return len(stem) >= 5 and not any(stem.startswith(prefix) for prefix in _GENERIC_STEMS)


def _enriched_tokens(label: str) -> list[str]:
    """Стемы метки плюс расшифровки аббревиатур и разговорные эквиваленты."""
    glossary = _label_glossary()
    found = list(tokens(glossary.expand(label)))
    for word in re.findall(r"[\p{L}\p{N}]+", fold(label)):
        for hit in glossary.lookup(word):
            found.extend(tokens(hit.full))
        found.extend(_LABEL_EQUIV.get(word, ()))
    return found


def _fuzzy_overlap(spec_name: str, got: list[str]) -> float:
    need = tokens(spec_name)
    if not need or not got:
        return 0.0
    matched = [stem for stem in need if any(_token_close(stem, word) for word in got)]
    if not matched:
        return 0.0
    ratio = len(matched) / len(need)
    if ratio >= MIN_LABEL_OVERLAP and (
        len(matched) >= 2 or any(_token_close(got[0], stem) for stem in matched)
    ):
        return ratio
    if any(_distinctive(stem) for stem in matched):
        return MIN_LABEL_OVERLAP
    return 0.0


def _label_match(spec: CharacteristicSpec, label: str) -> float:
    if not label.strip():
        return 0.0
    return max(_label_score(spec.name, label), _fuzzy_overlap(spec.name, _enriched_tokens(label)))


def _name_clauses(text: str) -> Iterator[tuple[int, str]]:
    """Фразы наименования: скобки и «;», затем запятая перед новой меткой."""
    pieces: list[tuple[int, str]] = []
    start = 0
    for match in _CLAUSE_SPLIT.finditer(text):
        chunk = text[start : match.start()]
        if chunk.strip():
            pieces.append((start, chunk))
        start = match.end()
    tail = text[start:]
    if tail.strip():
        pieces.append((start, tail))
    for offset, chunk in pieces:
        yield from _comma_parts(chunk, offset)


def _quantity_in_clause(clause: str) -> tuple[re.Match[str], str | None] | None:
    """Число с единицей в фразе. Без единицы — только если другого числа нет."""
    matches = list(_NUM_UNIT.finditer(clause))
    if not matches:
        return None
    with_unit = [m for m in matches if _canon_unit(m.group("unit"))]
    if with_unit:
        match = with_unit[-1]
        return match, _canon_unit(match.group("unit"))
    return matches[-1], None


def _unit_compatible(unit: str | None, spec: CharacteristicSpec) -> bool:
    if unit is None:
        return True
    target = normalize_unit(spec.unit) or spec.unit
    if target is None:
        return False
    return convert(1.0, unit, target) is not None


def _span_taken(found: dict[str, Extracted], field: Field, start: int, end: int) -> bool:
    return any(
        item.source.field == field and not (end <= item.source.start or start >= item.source.end)
        for item in found.values()
    )


def _embedded_quantities(
    field: Field, text: str, specs: list[CharacteristicSpec], found: dict[str, Extracted]
) -> Iterator[Extracted]:
    """Характеристика, вписанная в наименование: метка из позиции КТРУ и значение с единицей.

    Совпадение — по стемам, опечаткам и аббревиатурам. Несколько равных кандидатов или слабая
    метка ничего не забирают: спорный кусок остаётся в тексте.
    """
    for offset, clause in _name_clauses(text):
        found_value = _quantity_in_clause(clause)
        if found_value is None:
            continue
        match, unit = found_value
        if unit is None or number_in_range(text, offset + match.start()):
            continue
        label = (clause[: match.start()] + " " + clause[match.end() :]).strip(" \t,;:—–-()/")
        if _BOUND_LABEL.search(label):
            continue
        start, end = offset + match.start(), offset + match.end()
        if _span_taken(found, field, start, end):
            continue
        number = match.group("num")
        scored: list[tuple[float, CharacteristicSpec]] = []
        for spec in specs:
            if spec.kind != "quantitative" or spec.name in found:
                continue
            if not _unit_compatible(unit, spec):
                continue
            if fit_value(number, unit, spec).status not in _OK:
                continue
            score = _label_match(spec, label)
            if score <= 0:
                continue
            scored.append((score, spec))
        if not scored:
            continue
        best = max(score for score, _ in scored)
        fits = [spec for score, spec in scored if score == best]
        if len(fits) != 1:
            continue
        fragment = text[start:end]
        yield Extracted(
            name=fits[0].name,
            raw_value=number.replace(" ", ""),
            raw_unit=unit,
            source=Span(field=field, start=start, end=end, text=fragment),
            method="rule",
        )


def extract_rules(name: str, description: str, specs: list[CharacteristicSpec]) -> list[Extracted]:
    found: dict[str, Extracted] = {}
    list_found: dict[str, Extracted] = {}
    for e in [*_list_values("name", name, specs), *_list_values("description", description, specs)]:
        list_found.setdefault(e.name, e)
    by_name = {s.name: s for s in specs}
    passes = [
        _labelled("description", description, specs),
        _labelled_list("description", description, specs),
        _from_name(name, specs),
    ]
    for items in passes:
        for e in items:
            found.setdefault(e.name, e)
    for spec_name, e in list(found.items()):
        # Значение после метки не из перечня, а в тексте есть значение перечня — верим перечню.
        alt = list_found.get(spec_name)
        if (
            alt is not None
            and not set(tokens(alt.source.text)) & set(tokens(spec_name))  # слово самой метки
            and fit_value(e.raw_value, e.raw_unit, by_name[spec_name]).status not in _OK
        ):
            found[spec_name] = alt
    for spec_name, e in list_found.items():
        found.setdefault(spec_name, e)
    for field, text in (("name", name), ("description", description)):
        for e in phrase_values(field, text, specs, found):
            found.setdefault(e.name, e)
        for e in bare_values(field, text, specs, found):
            found.setdefault(e.name, e)
        for e in _embedded_quantities(field, text, specs, found):
            found.setdefault(e.name, e)
    return list(found.values())
