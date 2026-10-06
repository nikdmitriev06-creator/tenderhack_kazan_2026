"""Извлечение характеристик правилами: без модели, с точным местом в тексте.

Порядок (первое найденное для характеристики побеждает):
1. строки описания вида «метка[, ед.] значение» — метка сопоставляется с именем характеристики
   позиции;
2. числа с единицей в наименовании («500л», «60 л», «20 шт») — через правила модерации
   (`moderation`);
3. значение из перечня позиции, встреченное в тексте словом целиком («А4», «ПНД», «нестерильные»).
"""

from collections.abc import Iterator
from typing import Literal

import regex as re

from app.catalog import CharacteristicSpec
from app.checks.moderation import SINGLE_NUM, TitleValue, find_title_values, target_char
from app.extract.model import Extracted
from app.ingest.units import normalize_unit
from app.schemas import Span
from app.search.text import tokens
from app.values import convert, fit_value, fold

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
    return list(found.values())
