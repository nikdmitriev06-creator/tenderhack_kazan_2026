"""Детектор ошибок карточки: правила модерации портала плюс сверка со спецификацией позиции.

Каждое замечание говорит, что не так (`message`), почему — с перечнем или правилом (`why`, `rule`) и
чем исправить (`fix`), если исправление однозначно. Блокирующее замечание (`block`) вернёт карточку
с модерации; `warn` — исправление, которое модуль предлагает; `info` — справка.
"""

from typing import Literal

import regex as re

from app.catalog import CharacteristicSpec, Position
from app.checks.moderation import RULE_TEXT, Card, Char, Finding, auto_fix, check_card
from app.ingest.characteristics import split_name_unit
from app.schemas import CardIn, Fix, Issue
from app.search.text import tokens
from app.values import fit_value, fold, nearest_allowed

RULE_UNIT = "единица из справочника ОКЕИ и той же величины, что у характеристики позиции"
RULE_NUMBER = "количественная характеристика задаётся числом"
RULE_REQUIRED = "обязательные характеристики позиции заполнены"
RULE_NAME = "значение не противоречит наименованию товара"
RULE_SPEC_NAME = "название характеристики как в позиции справочника"
RULE_KTRU = "код КТРУ есть в справочнике"


def _field(char_name: str | None) -> str:
    return f"characteristics.{char_name}" if char_name else "characteristics"


def _moderation_issues(card: CardIn) -> list[Issue]:
    mod_card = Card(
        name=card.name,
        chars=[Char(name=c.name, value=c.value, unit=c.unit) for c in card.characteristics],
    )
    findings = check_card(mod_card)
    # Значение с единицей в наименовании: исправление — наименование после переноса
    # значений в характеристики.
    title = (
        auto_fix(mod_card)[0].name
        if any(f.rule == "value-unit-in-title" for f in findings)
        else None
    )
    return [_from_finding(f, card.name, title) for f in findings]


def _from_finding(f: Finding, name: str, fixed_title: str | None) -> Issue:
    fix = None
    if f.rule == "unit-in-char-name" and f.char:
        base, unit = split_name_unit(f.char)
        fix = Fix(name=base, unit=unit)
    elif f.rule == "value-unit-in-title" and fixed_title and fixed_title != name:
        fix = Fix(value=fixed_title)
    return Issue(
        field="name" if f.rule == "value-unit-in-title" else _field(f.char),
        kind="moderation_rule",
        severity="block" if f.level == "block" else "warn",
        message=f.text,
        why=f"Правило модерации портала: {RULE_TEXT[f.rule]}.",
        rule=RULE_TEXT[f.rule],
        fix=fix,
    )


def _spec_for(name: str, position: Position) -> tuple[CharacteristicSpec | None, str | None]:
    """Спецификация позиции для характеристики карточки и, если имя с опечаткой, верное имя."""
    base, _ = split_name_unit(name)
    for spec in position.characteristics:
        if fold(spec.name) in (fold(name), fold(base)):
            return spec, None
    near = nearest_allowed(base, [s.name for s in position.characteristics])
    if near is None:
        return None, None
    spec = next(s for s in position.characteristics if s.name == near[0])
    return spec, spec.name


# Форма слова — основа плюс короткое окончание: «стерильная» — «Стерильные», но не
# «краснодарский» — «Красный».
MAX_ENDING = 3
MIN_STEM = 4
_TEXT_WORD = re.compile(r"[\w-]+")


def _word_in(text: str, word: str) -> bool:
    """Значение стоит в тексте целым словом или в другой форме тех же слов.

    Значение из нескольких слов — если в тексте есть каждое его слово («черное экокожа» и
    «Черная экокожа»).
    """
    if re.search(rf"(?<![\w-]){re.escape(fold(word))}(?![\w-])", fold(text)):
        return True
    stems = tokens(word)
    if not stems or (len(stems) == 1 and len(stems[0]) < MIN_STEM):
        return False
    words = _TEXT_WORD.findall(fold(text))
    return all(
        stem in words
        if len(stem) < MIN_STEM
        else any(w.startswith(stem) and len(w) - len(stem) <= MAX_ENDING for w in words)
        for stem in stems
    )


def _contradiction(card: CardIn, spec: CharacteristicSpec, value: str) -> str | None:
    """Другое допустимое значение этой характеристики стоит в наименовании, а это — нет."""
    if spec.kind != "qualitative" or _word_in(card.name, value):
        return None
    others = [v for v in spec.values if fold(v) != fold(value) and _word_in(card.name, v)]
    return others[0] if others else None


def _spec_issues(card: CardIn, position: Position) -> list[Issue]:
    issues: list[Issue] = []
    filled: set[str] = set()
    for c in card.characteristics:
        spec, right_name = _spec_for(c.name, position)
        if spec is None:
            continue
        filled.add(spec.name)
        field = _field(c.name)
        if right_name is not None:
            issues.append(
                Issue(
                    field=field,
                    kind="typo",
                    severity="warn",
                    message=f"Характеристика «{c.name}» похожа на «{right_name}» из позиции.",
                    why=f"В позиции {position.code} характеристика называется «{right_name}».",
                    rule=RULE_SPEC_NAME,
                    fix=Fix(name=right_name),
                )
            )
        _, unit_in_name = split_name_unit(c.name)
        fit = fit_value(c.value, c.unit or unit_in_name, spec)
        shown = f"{c.value} {c.unit}".strip() if c.unit else c.value
        if fit.status == "not_in_list":
            expected = fit.note or "значение из перечня позиции"
            issues.append(
                Issue(
                    field=field,
                    kind="not_in_list",
                    severity="block",
                    message=(
                        f"Значение «{spec.name}» противоречит КТРУ {position.code}. "
                        f"Сейчас: «{shown}». Ожидается: {expected}."
                    ),
                    why=f"«{spec.name}» в позиции {position.code}: {fit.note}.",
                    rule=RULE_TEXT["value-not-allowed"],
                )
            )
        elif fit.status == "typo":
            issues.append(
                Issue(
                    field=field,
                    kind="typo",
                    severity="warn",
                    message=f"Похоже на опечатку: «{c.value}».",
                    why=f"{fit.note}: ближайшее значение перечня позиции {position.code}.",
                    rule=RULE_TEXT["value-not-allowed"],
                    fix=Fix(value=fit.value),
                )
            )
        elif fit.status in ("unit_mismatch", "unparsed"):
            issues.append(
                Issue(
                    field=field,
                    kind="mismatch",
                    severity="block",
                    message=(
                        f"Значение «{spec.name}» противоречит КТРУ {position.code}. "
                        f"Сейчас: «{shown}». Ожидается: {fit.note}."
                    ),
                    why=f"{fit.note}.",
                    rule=RULE_UNIT if fit.status == "unit_mismatch" else RULE_NUMBER,
                )
            )
        elif (other := _contradiction(card, spec, fit.value or c.value)) is not None:
            issues.append(
                Issue(
                    field=field,
                    kind="mismatch",
                    severity="block",
                    message=f"«{spec.name}: {c.value}» противоречит наименованию.",
                    why=f"В наименовании «{card.name}» указано «{other.lower()}».",
                    rule=RULE_NAME,
                    fix=Fix(value=other),
                )
            )
    for spec in position.characteristics:
        if spec.required and spec.name not in filled:
            issues.append(
                Issue(
                    field=_field(spec.name),
                    kind="moderation_rule",
                    severity="block",
                    message=(
                        f"Обязательная характеристика «{spec.name}» не заполнена. "
                        f"КТРУ {position.code} требует её указать."
                    ),
                    why=f"Характеристика обязательна в позиции {position.code}.",
                    rule=RULE_REQUIRED,
                )
            )
    return issues


def unknown_code(code: str) -> Issue:
    """Код КТРУ карточки не найден: характеристики проверены только правилами модерации."""
    return Issue(
        field="ktru_code",
        kind="not_in_list",
        severity="warn",
        message=f"Кода КТРУ {code} нет в справочнике модуля.",
        why="Характеристики проверены только правилами модерации, без позиции КТРУ.",
        rule=RULE_KTRU,
    )


def detect(card: CardIn, position: Position | None) -> list[Issue]:
    issues = _moderation_issues(card)
    if position is not None:
        issues.extend(_spec_issues(card, position))
    return issues


def verdict(issues: list[Issue]) -> Literal["ready", "needs_fix"]:
    return "needs_fix" if any(i.severity == "block" for i in issues) else "ready"
