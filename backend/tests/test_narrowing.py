from pathlib import Path

from app.catalog import Catalog, CharacteristicSpec, Position
from app.narrowing import Known, best_question, build_state, compatible, narrow
from app.search import Candidate

FAKE = Path(__file__).parent / "fixtures" / "fake"
CATALOG = Catalog.load([FAKE / "ktru.json"])
WHITE_CODE = "17.12.14.129-00000101"
COLOR_CODE = "17.12.14.129-00000102"
PAPER = [CATALOG.get(WHITE_CODE), CATALOG.get(COLOR_CODE)]


def _cands(positions: list) -> list[Candidate]:
    return [Candidate(code=p.code, name=p.name, score=1.0, why=[]) for p in positions]


def _answer(value: str, unit: str | None = None) -> Known:
    return Known(value=value, unit=unit, source="answer")


def _text(value: str, unit: str | None = None) -> Known:
    return Known(value=value, unit=unit, source="text")


def test_answer_on_characteristic_missing_in_position_excludes_it() -> None:
    # Ответ на вопрос — выбор человека: позиция без такой характеристики ему не подходит.
    assert not compatible(PAPER[0], {"Цветность": _answer("Цветная")})
    assert compatible(PAPER[1], {"Цветность": _answer("Цветная")})


def test_text_value_on_missing_characteristic_keeps_position() -> None:
    # Значение из текста могло относиться к характеристике, которой в позиции просто нет.
    assert compatible(PAPER[1], {"Белизна по CIE": _text("160", "%")})


def test_value_outside_list_excludes_position() -> None:
    assert not compatible(PAPER[1], {"Количество листов в пачке": _text("1000", "шт")})


def test_number_is_compared_with_buckets() -> None:
    assert compatible(PAPER[0], {"Масса бумаги площадью 1 м2": _text("80", "г/м2")})


def test_known_colour_gives_final_code() -> None:
    state = build_state(_cands(PAPER), PAPER, {"Цветность": _answer("Цветная")})
    assert (state.remaining, state.final_code, state.question) == (1, COLOR_CODE, None)


def test_question_options_report_remaining_and_cuts() -> None:
    state = build_state(_cands(PAPER), PAPER, {})
    assert state.remaining == 2 and state.final_code is None
    q = state.question
    assert q is not None
    for o in q.options:
        assert o.cuts == 2 - o.remaining
        assert o.remaining == len(narrow(PAPER, {q.characteristic: _answer(o.value)}))


def test_answering_the_question_narrows_as_promised() -> None:
    q = best_question(PAPER, {})
    assert q is not None
    decisive = min(q.options, key=lambda o: o.remaining)
    state = build_state(_cands(PAPER), PAPER, {q.characteristic: _answer(decisive.value)})
    assert state.remaining == decisive.remaining


def test_question_prefers_characteristic_every_candidate_has() -> None:
    q = best_question(PAPER, {})
    assert q is not None
    spec_names = [{c.name for c in p.characteristics} for p in PAPER]
    assert all(q.characteristic in names for names in spec_names)


def test_dead_end_names_the_value_to_check() -> None:
    known = {"Формат": _answer("A5"), "Цветность": _answer("Цветная")}
    state = build_state(_cands(PAPER), PAPER, known)
    assert state.remaining == 0
    assert state.final_code is None
    assert state.steps[0].startswith("Нет позиции с такими значениями")


def test_no_candidates_says_category_not_found() -> None:
    state = build_state([], [], {})
    assert state.steps == [
        "Категория не найдена в справочнике: уточните наименование или опишите товар подробнее"
    ]


def test_indistinguishable_positions_ask_for_manual_choice() -> None:
    twins = [
        Position(
            code=f"T-{i}",
            name=f"Позиция {i}",
            okpd2="00",
            source="test",
            characteristics=[CharacteristicSpec(name="Цвет", kind="qualitative", values=["Синий"])],
        )
        for i in (1, 2)
    ]
    state = build_state(_cands(twins), twins, {})
    assert state.question is None
    assert state.steps[0].startswith("Выберите позицию вручную: T-1 (Позиция 1); T-2 (Позиция 2)")


def test_question_on_partial_characteristic_offers_none_option() -> None:
    known = {
        "Формат": _text("A4"),
        "Количество листов в пачке": _text("500", "шт"),
        "Масса бумаги площадью 1 м2": _text("80", "г/м2"),
    }
    q = best_question(PAPER, known)
    assert q is not None
    values = [o.value for o in q.options]
    assert "" in values  # «нет такой характеристики» — у белой бумаги её нет
    assert len(values) >= 2


def test_none_answer_keeps_positions_without_the_characteristic() -> None:
    left = narrow(PAPER, {"Цветность": _answer("")})
    assert [p.code for p in left] == [WHITE_CODE]
