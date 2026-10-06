import asyncio
from pathlib import Path

import pytest

from app.catalog import Catalog, CharacteristicSpec
from app.extract import Extracted, LLMItem, LLMItems, extract_llm, extract_rules
from app.glossary import Glossary
from app.llm import LLMError, LLMOutputError
from tests.fakes import FakeLLM

FAKE = Path(__file__).parent / "fixtures" / "fake"
CATALOG = Catalog.load([FAKE / "ktru.json"])
WHITE = CATALOG.get("17.12.14.129-00000101").characteristics  # type: ignore[union-attr]
BAGS = CATALOG.get("22.22.11.000-00000201").characteristics  # type: ignore[union-attr]
GLOVES = CATALOG.get("22.19.60.119-00000301").characteristics  # type: ignore[union-attr]

# Карточка портала 47453345: описание поставщика построчно (docs/research/zakupki-portal.md, §2).
NAME = "Бумага офисная Туринский ЦБЗ А4 500л"
DESCRIPTION = "\n".join(
    [
        "Масса бумага площадью 1 м2, г 80",
        "Толщина, мкм 104",
        "Белизна с ООВ по ISO, % 98",
        "Непрозрачность, % 90",
        "Размер листа. мм А4 210*297",
        "Предельные отклонения по косине листа, мм 0,5",
        "Количество листов в пачке А4 500",
        "Количество пачек в коробке 5 шт.",
    ]
)


def _by_name(items: list[Extracted]) -> dict[str, Extracted]:
    return {e.name: e for e in items}


def _spans_point_to_text(items: list[Extracted], name: str, description: str) -> None:
    for e in items:
        text = name if e.source.field == "name" else description
        assert text[e.source.start : e.source.end] == e.source.text


def test_labelled_lines_of_description() -> None:
    got = _by_name(extract_rules(NAME, DESCRIPTION, WHITE))
    mass = got["Масса бумаги площадью 1 м2"]
    assert (mass.raw_value, mass.source.text, mass.method) == ("80", "80", "rule")
    assert got["Количество листов в пачке"].raw_value == "500"
    _spans_point_to_text(list(got.values()), NAME, DESCRIPTION)


def test_list_value_found_anywhere_in_text() -> None:
    got = _by_name(extract_rules(NAME, DESCRIPTION, WHITE))
    assert got["Формат"].raw_value == "A4"  # значение перечня (латиница)
    assert got["Формат"].source.text == "А4"  # как в тексте (кириллица)


def test_line_about_another_count_is_not_taken() -> None:
    # «Количество пачек в коробке 5 шт.» — не «Количество листов в пачке».
    got = _by_name(extract_rules("Бумага", "Количество пачек в коробке 5 шт.", WHITE))
    assert "Количество листов в пачке" not in got


def test_values_from_name_with_units() -> None:
    name = "Пакеты для мусора 60 л, 20 шт, ПНД"
    got = _by_name(extract_rules(name, "", BAGS))
    assert (got["Объем"].raw_value, got["Объем"].raw_unit) == ("60", "л")
    assert got["Количество в упаковке"].raw_value == "20"
    assert got["Материал"].raw_value == "ПНД"
    _spans_point_to_text(list(got.values()), name, "")


def test_word_forms_of_list_value() -> None:
    # Перечень «Нестерильные», в тексте «нестерильные» — то же значение.
    got = _by_name(extract_rules("Перчатки нитриловые нестерильные, размер M", "", GLOVES))
    assert got["Стерильность"].raw_value.lower() == "нестерильные"
    assert got["Размер"].raw_value == "M"


def test_short_size_value_needs_a_standalone_token() -> None:
    # «5 м» — метры, а не размер M.
    got = _by_name(extract_rules("Перчатки, рулон 5 м", "", GLOVES))
    assert "Размер" not in got
    # Наименование заглавными: «М» совпадает с размером по букве, отсекает число перед ним.
    got = _by_name(extract_rules("ПЕРЧАТКИ, РУЛОН 5 М", "", GLOVES))
    assert "Размер" not in got


def _llm(replies: list) -> FakeLLM:
    return FakeLLM(replies)


def test_llm_items_are_validated_by_code() -> None:
    reply = LLMItems(
        items=[
            LLMItem(name="Класс", value="A", unit=None, quote="класс A"),  # верный
            LLMItem(name="Класс", value="B", unit=None, quote="класс B"),  # цитаты нет в тексте
            LLMItem(name="Формат", value="A7", unit=None, quote="A7"),  # нет в перечне
            LLMItem(name="Цвет", value="Белый", unit=None, quote="белая"),  # чужое имя
        ]
    )
    llm = _llm([reply])
    got = asyncio.run(
        extract_llm("Бумага белая, класс A", "", WHITE, llm, Glossary([]))  # type: ignore[arg-type]
    )
    assert [(e.name, e.raw_value, e.method) for e in got] == [("Класс", "A", "llm")]
    assert got[0].source.text == "класс A"


def test_llm_bad_output_twice_gives_nothing() -> None:
    bad = LLMOutputError("не JSON", raw="...")
    got = asyncio.run(
        extract_llm("Бумага", "", WHITE, _llm([bad, bad]), Glossary([]))  # type: ignore[arg-type]
    )
    assert got == []


def test_llm_outage_is_raised_to_the_pipeline() -> None:
    with pytest.raises(LLMError):
        asyncio.run(
            extract_llm(
                "Бумага",
                "",
                WHITE,
                _llm([LLMError("нет связи")]),
                Glossary([]),  # type: ignore[arg-type]
            )
        )


def test_llm_not_called_without_specs() -> None:
    llm = _llm([])
    assert asyncio.run(extract_llm("Бумага", "", [], llm, Glossary([]))) == []  # type: ignore[arg-type]
    assert llm.calls == []


def test_word_form_is_returned_as_the_list_value() -> None:
    material = CharacteristicSpec(name="Материал", kind="qualitative", values=["Нитрил", "Латекс"])
    got = _by_name(extract_rules("Перчатки смотровые нитриловые", "", [material]))
    assert got["Материал"].raw_value == "Нитрил"
    assert got["Материал"].source.text == "нитриловые"


COLOR_PAPER = CATALOG.get("17.12.14.129-00000102").characteristics  # type: ignore[union-attr]


def test_labelled_line_with_colon_gives_list_value_as_written() -> None:
    # Значение пишется как в тексте: опечатку и чужое значение покажет подгонка к перечню.
    got = _by_name(extract_rules("Бумага цветная", "Интенсивность цвета: Медимум", COLOR_PAPER))
    e = got["Интенсивность цвета"]
    assert (e.raw_value, e.source.text) == ("Медимум", "Медимум")
    got = _by_name(extract_rules("Бумага цветная", "Интенсивность цвета: Белый", COLOR_PAPER))
    assert got["Интенсивность цвета"].raw_value == "Белый"


def test_name_value_goes_to_the_best_matching_characteristic() -> None:
    # «500 листов» — «Количество листов в пачке», а не «Количество цветов в пачке»: у второй совпала
    # только половина слов, у первой — все.
    sheets = CharacteristicSpec(
        name="Количество листов в пачке", kind="quantitative", unit="шт", values=["250", "500"]
    )
    colors = CharacteristicSpec(name="Количество цветов в пачке", kind="quantitative", unit="шт")
    got = _by_name(extract_rules("Бумага офисная А4 500 листов", "", [colors, sheets]))
    assert got["Количество листов в пачке"].raw_value == "500"
    assert "Количество цветов в пачке" not in got


DEMO = Catalog.load([Path(__file__).parent.parent / "app" / "catalog" / "demo" / "demo.json"])


def _demo_specs(code: str) -> list:
    position = DEMO.get(code)
    assert position is not None
    return position.characteristics


def test_one_line_description_with_commas() -> None:
    # Ревью: «Толщина = 10» — бралось последнее число строки, а не число после метки.
    got = _by_name(
        extract_rules(
            "Мешки",
            "объем 120 л, толщина 30 мкм, в рулоне 10 шт",
            _demo_specs("22.22.11.000-00000201"),
        )
    )
    assert got["Толщина"].raw_value == "30"
    assert got["Объем"].raw_value == "120"


def test_sentences_with_periods_are_separate() -> None:
    got = _by_name(
        extract_rules(
            "Батарейка",
            "Типоразмер AAA. Напряжение 1,5 В. В упаковке 4 штуки",
            _demo_specs("27.20.11.000-00000501"),
        )
    )
    assert "Номинальное напряжение" not in got or got["Номинальное напряжение"].raw_value == "1,5"


def test_colon_value_stops_at_the_end_of_the_phrase() -> None:
    specs = _demo_specs("22.19.60.119-00000301")
    got = _by_name(
        extract_rules("Перчатки", "Опудренность: неопудренные. Стерильность: стерильные", specs)
    )
    assert got["Опудренность"].raw_value.lower() == "неопудренные"
    got = _by_name(extract_rules("Перчатки", "материал: латекс, размер M", specs))
    assert got["Материал"].raw_value.lower() == "латекс"


def test_one_shared_word_is_not_a_label_match() -> None:
    # «Масса бумаги площадью 1м2: 80 г» — не «Класс бумаги» (общее только «бумаги»).
    got = _by_name(
        extract_rules(
            "Бумага", "Масса бумаги площадью 1м2: 80 г", _demo_specs("17.12.14.129-00000031")
        )
    )
    assert "Класс бумаги" not in got


def test_llm_quote_must_contain_the_value() -> None:
    # Ревью: цитата есть в тексте, но значения в ней нет — значение придумано моделью.
    reply = LLMItems(
        items=[
            LLMItem(name="Класс", value="B", unit=None, quote="Бумага белая"),
            LLMItem(name="Белизна по CIE", value="170", unit="%", quote="белизна 160"),
            LLMItem(name="Формат", value="A4", unit=None, quote="формата А4"),
        ]
    )
    got = asyncio.run(
        extract_llm(
            "Бумага белая формата А4, белизна 160",
            "",
            WHITE,
            _llm([reply]),
            Glossary([]),  # type: ignore[arg-type]
        )
    )
    assert [(e.name, e.raw_value) for e in got] == [("Формат", "A4")]


def test_llm_quote_with_word_form_of_the_value_is_accepted() -> None:
    # «неопудренных» в тексте — «Неопудренные» в перечне: форма слова, а не другое значение.
    powder = next(s for s in GLOVES if s.name == "Опудренность")
    reply = LLMItems(
        items=[LLMItem(name=powder.name, value="Неопудренные", unit=None, quote="неопудренных")]
    )
    got = asyncio.run(
        extract_llm(
            "Пара перчаток неопудренных",
            "",
            [powder],
            _llm([reply]),
            Glossary([]),  # type: ignore[arg-type]
        )
    )
    assert [(e.name, e.raw_value) for e in got] == [(powder.name, "Неопудренные")]


def test_llm_bucket_value_is_accepted_when_quote_number_is_inside() -> None:
    # Модель отвечает значением перечня «>=80 ... <90», в цитате — «80 г/м2».
    mass = next(s for s in WHITE if s.name.startswith("Масса"))
    ok = LLMItem(name=mass.name, value=">=80 ... <90", unit="г/м2", quote="80 г/м2")
    got = asyncio.run(
        extract_llm(
            "Бумага 80 г/м2",
            "",
            [mass],
            _llm([LLMItems(items=[ok])]),
            Glossary([]),  # type: ignore[arg-type]
        )
    )
    assert [e.raw_value for e in got] == [">=80 ... <90"]
    wrong = LLMItem(name=mass.name, value=">=90 ... <100", unit="г/м2", quote="80 г/м2")
    got = asyncio.run(
        extract_llm(
            "Бумага 80 г/м2",
            "",
            [mass],
            _llm([LLMItems(items=[wrong])]),
            Glossary([]),  # type: ignore[arg-type]
        )
    )
    assert got == []


def test_compound_unit_from_name_goes_to_the_characteristic_with_that_unit() -> None:
    # Ревью: «80 г/м2» в наименовании пропускался, хотя у позиции есть характеристика в г/м2.
    mass = next(s for s in WHITE if s.name.startswith("Масса"))
    for name in ["Бумага офисная А4 80 г/м2 500 л", "Бумага офисная А4, 80г/м², 500 листов"]:
        e = _by_name(extract_rules(name, "", WHITE))[mass.name]
        assert (e.raw_value, e.raw_unit) == ("80", "г/м2")
        assert e.source.text.startswith("80")
    # «до 80 г/м2» — граница, а не значение.
    assert mass.name not in _by_name(extract_rules("Бумага плотность до 80 г/м2", "", WHITE))


def test_bare_number_list_value_is_not_taken_from_free_text() -> None:
    # Портал: «Велосипед … 20» — размер колеса, а не «Число зубьев: 20» из перечня.
    teeth = CharacteristicSpec(name="Число зубьев", kind="qualitative", values=["20", "32"])
    assert "Число зубьев" not in _by_name(extract_rules("Велосипед горный 20 дюймов", "", [teeth]))


def test_multi_word_list_value_is_found_as_a_phrase() -> None:
    # Портал: «Хризантема кустовая "Бакарди"» — значение из двух слов.
    kind = CharacteristicSpec(
        name="Название цветов и растений",
        kind="qualitative",
        values=["Хризантема кустовая", "Хризантема одноголовая", "Роза"],
    )
    got = _by_name(extract_rules('Хризантема кустовая "Бакарди"', "", [kind]))
    e = got["Название цветов и растений"]
    assert (e.raw_value, e.source.text) == ("Хризантема кустовая", "Хризантема кустовая")
    # Слова по отдельности и в другом порядке — не фраза: остаётся только «Роза».
    other = _by_name(extract_rules("Кустовая роза и хризантема", "", [kind]))
    assert other["Название цветов и растений"].raw_value == "Роза"
