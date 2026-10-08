"""Пошаговое сужение кандидатов до конечного кода (Т2.4) и подсказки, когда код не определить
(Т2.5).

Известное значение характеристики (`Known`) приходит из текста поставщика или из ответа на вопрос.
Разница важна: позиция без характеристики, о которой спросили и на которую ответили, человеку не
подходит; а значение из текста могло относиться к характеристике, которой в позиции просто нет.
"""

from typing import Literal

from pydantic import BaseModel

from app.catalog import CharacteristicSpec, Position
from app.search import Candidate
from app.values import fit_value, fold

STEP_NOT_FOUND = (
    "Категория не найдена в справочнике: уточните наименование или опишите товар подробнее"
)
_FITS = {"exact", "normalized", "bucket", "typo"}
# Вариант «Ничего не подходит» есть в каждом вопросе: ответ им — честный отказ, а не ближайший код.
NOTHING_FITS = "__nothing__"
# Вопрос «Подтвердите позицию»: в наименовании есть значимые слова, которых нет в позиции.
CONFIRM = "Позиция КТРУ"


class Known(BaseModel):
    value: str
    unit: str | None = None
    source: Literal["text", "answer"]


class Option(BaseModel):
    value: str
    remaining: int
    cuts: int


class Question(BaseModel):
    characteristic: str
    options: list[Option]


class KtruState(BaseModel):
    candidates: list[Candidate]
    remaining: int
    final_code: str | None
    question: Question | None
    steps: list[str]


def _spec(position: Position, name: str) -> CharacteristicSpec | None:
    key = fold(name)
    return next((c for c in position.characteristics if fold(c.name) == key), None)


# Ответ «нет такой характеристики»: пустое значение. Оставляет позиции, у которых её нет.
NONE_VALUE = ""


def _fits(position: Position, name: str, k: Known) -> bool:
    spec = _spec(position, name)
    if k.source == "answer" and k.value == NONE_VALUE:
        return spec is None
    if spec is None:
        return k.source == "text"
    return fit_value(k.value, k.unit, spec).status in _FITS


def compatible(position: Position, known: dict[str, Known]) -> bool:
    return all(_fits(position, name, k) for name, k in known.items())


def narrow(positions: list[Position], known: dict[str, Known]) -> list[Position]:
    return [p for p in positions if compatible(p, known)]


def _options(positions: list[Position], name: str) -> list[str]:
    """Значения, которые можно предложить: перечни позиций, у которых характеристика есть."""
    seen: dict[str, str] = {}
    for p in positions:
        spec = _spec(p, name)
        if spec is None:
            continue
        for v in spec.values:
            seen.setdefault(fold(v), v)
    return list(seen.values())


def _has_level_define(positions: list[Position]) -> bool:
    return any(c.level_define for p in positions for c in p.characteristics)


def _known_defining(positions: list[Position], known: dict[str, Known]) -> int:
    names = {fold(c.name) for p in positions for c in p.characteristics if c.level_define}
    return sum(1 for name in known if fold(name) in names)


def best_question(
    positions: list[Position],
    known: dict[str, Known],
    *,
    defining_only: bool | None = None,
) -> Question | None:
    """Характеристика, ответ на которую в среднем оставит меньше всего позиций.

    Порядок при равенстве: есть у всех кандидатов, меньше остаётся в среднем, обязательная,
    определяющая позицию, меньше вариантов, по имени. Перечни пересекаются («A4» есть у нескольких
    позиций), поэтому мера — средний остаток по вариантам, а не энтропия разбиения.

    `defining_only=True` — только `level_define`. `False` — только остальные, когда определяющие
    уже не различают оставшиеся позиции (тогда спрашиваем белизну, если у кандидатов она разная).
    """
    asked = {fold(n) for n in known}
    names: dict[str, str] = {}
    for p in positions:
        for c in p.characteristics:
            if fold(c.name) in asked:
                continue
            if defining_only is True and not c.level_define:
                continue
            if defining_only is False and c.level_define:
                continue
            names.setdefault(fold(c.name), c.name)
    n = len(positions)
    ranked = []
    for name in names.values():
        specs = [s for p in positions if (s := _spec(p, name)) is not None]
        everyone = len(specs) == n
        values = _options(positions, name) + ([] if everyone else [NONE_VALUE])
        options = []
        for value in values:
            left = len(narrow(positions, {name: Known(value=value, source="answer")}))
            if left:
                options.append(Option(value=value, remaining=left, cuts=n - left))
        if len(options) < 2 or all(o.remaining == n for o in options):
            continue  # вопрос ничего не отсекает или выбирать не из чего
        mean_left = sum(o.remaining for o in options) / len(options)
        required = any(s.required for s in specs)
        level = any(s.level_define for s in specs)
        key = (not everyone, mean_left, not required, not level, len(options), name)
        ranked.append((key, Question(characteristic=name, options=options)))
    if not ranked:
        return None
    question = min(ranked, key=lambda kq: kq[0])[1]
    question.options.append(Option(value=NOTHING_FITS, remaining=0, cuts=n))
    return question


def _dead_end_step(positions: list[Position], known: dict[str, Known]) -> str:
    """Какое из известных значений отсекло последние позиции — его и предложить проверить."""
    for name, k in known.items():
        rest = {n: v for n, v in known.items() if n != name}
        if narrow(positions, rest):
            return f"Нет позиции с такими значениями: проверьте «{name}» = «{k.value}»"
    return "Нет позиции с такими значениями: проверьте введённые характеристики"


def _confirm_question(position: Position) -> Question:
    return Question(
        characteristic=CONFIRM,
        options=[
            Option(value=position.code, remaining=1, cuts=0),
            Option(value=NOTHING_FITS, remaining=0, cuts=1),
        ],
    )


def _next_question(positions: list[Position], known: dict[str, Known]) -> Question | None:
    """Сначала определяющая характеристику, потом любая, которая ещё режет список.

    Число записей в справочнике не выбирает значение: 500 листов не побеждают 250 только потому,
    что таких позиций больше.
    """
    if _has_level_define(positions):
        defining = best_question(positions, known, defining_only=True)
        if defining is not None:
            return defining
        return best_question(positions, known, defining_only=False)
    return best_question(positions, known)


def unexplained_step(words: list[str]) -> str:
    listed = ", ".join(f"«{w}»" for w in words)
    return (
        f"В наименовании есть слова, которых нет в подобранных позициях: {listed}. "
        "Подтвердите позицию или выберите «Ничего не подходит»."
    )


def build_state(
    candidates: list[Candidate],
    positions: list[Position],
    known: dict[str, Known],
    *,
    unexplained: list[str] | None = None,
    confirmed: str | None = None,
    rejected: bool = False,
    text: str = "",
) -> KtruState:
    """Состояние сужения.

    Итоговый код — авторитетный результат: если в наименовании остались слова, которых нет ни в
    одной позиции-кандидате (`unexplained`), код ставится только после подтверждения человеком.
    """
    # Текст не выбирает значение, которого в нём нет: «А4 80» не становится пачкой в 500 листов.
    _ = text
    if not positions or rejected:
        return KtruState(
            candidates=[], remaining=0, final_code=None, question=None, steps=[STEP_NOT_FOUND]
        )
    left = narrow(positions, known)
    codes = {p.code for p in left}
    kept = [c for c in candidates if c.code in codes]
    if not left:
        step = _dead_end_step(positions, known)
        return KtruState(candidates=[], remaining=0, final_code=None, question=None, steps=[step])
    doubt = [unexplained_step(unexplained)] if unexplained else []
    defined = _known_defining(left, known)
    if len(left) == 1:
        # Одно слово вроде «принтера» не отменяет код, если определяющие характеристики уже названы.
        # Пока их мало, незнакомое слово по-прежнему требует подтверждения.
        if doubt and confirmed != left[0].code and defined < 2:
            return KtruState(
                candidates=kept,
                remaining=1,
                final_code=None,
                question=_confirm_question(left[0]),
                steps=doubt,
            )
        return KtruState(
            candidates=kept, remaining=1, final_code=left[0].code, question=None, steps=[]
        )
    question = _next_question(left, known)
    steps = list(doubt)
    if question is None:
        listed = "; ".join(f"{p.code} ({p.name})" for p in left)
        steps.append(f"Выберите позицию вручную: {listed}")
    return KtruState(
        candidates=kept, remaining=len(left), final_code=None, question=question, steps=steps
    )
