from pathlib import Path

from app.catalog import Catalog, CharacteristicSpec, Position
from app.checks.detector import detect, verdict
from app.schemas import CardIn, CharIn

FAKE = Path(__file__).parent / "fixtures" / "fake"
CATALOG = Catalog.load([FAKE / "ktru.json"])
WHITE = CATALOG.get("17.12.14.129-00000101")
COLOR = CATALOG.get("17.12.14.129-00000102")

# Живая карточка портала 47453345 (docs/research/zakupki-portal.md):
# белая бумага с «Интенсивность цвета: Белый».
LIVE = CardIn(
    name="Бумага офисная Туринский ЦБЗ А4 500л",
    characteristics=[
        CharIn(name="Количество листов в пачке", value="500", unit="шт"),
        CharIn(name="Формат", value="А4"),
        CharIn(name="Масса бумаги площадью 1м2", value="80", unit="г"),
        CharIn(name="Толщина, мкм", value="104"),
        CharIn(name="Интенсивность цвета", value="Белый"),
    ],
)


def _by_field(issues: list, field: str) -> list:
    return [i for i in issues if i.field == field]


def test_value_outside_position_list_blocks() -> None:
    issues = detect(LIVE, COLOR)
    found = _by_field(issues, "characteristics.Интенсивность цвета")
    assert [(i.kind, i.severity) for i in found] == [("not_in_list", "block")]
    assert "Пастель" in found[0].why


def test_unit_in_characteristic_name_is_moderation_rule_with_fix() -> None:
    found = _by_field(detect(LIVE, COLOR), "characteristics.Толщина, мкм")
    rules = [i for i in found if i.kind == "moderation_rule"]
    assert len(rules) == 1
    assert rules[0].rule == "единица измерения в отдельном поле"
    assert rules[0].fix is not None
    assert (rules[0].fix.name, rules[0].fix.unit) == ("Толщина", "мкм")


def test_live_card_needs_fix() -> None:
    assert verdict(detect(LIVE, COLOR)) == "needs_fix"


def test_missing_required_characteristic_blocks_the_card() -> None:
    # Ревью: карточку без обязательной характеристики модерация не пропустит — это не «совет».
    found = _by_field(detect(LIVE, COLOR), "characteristics.Цветность")
    assert [(i.kind, i.severity) for i in found] == [("moderation_rule", "block")]
    assert "Цветность" in found[0].message


def test_without_position_only_moderation_rules() -> None:
    issues = detect(LIVE, None)
    assert issues
    assert {i.kind for i in issues} == {"moderation_rule"}


def test_value_contradicting_name_is_a_mismatch() -> None:
    position = Position(
        code="T-1",
        name="Бумага",
        okpd2="17.12.14.129",
        source="test",
        characteristics=[
            CharacteristicSpec(name="Цветность", kind="qualitative", values=["Белая", "Цветная"])
        ],
    )
    card = CardIn(
        name="Бумага цветная А4", characteristics=[CharIn(name="Цветность", value="Белая")]
    )
    found = _by_field(detect(card, position), "characteristics.Цветность")
    assert [(i.kind, i.severity) for i in found] == [("mismatch", "block")]
    assert "цветная" in found[0].why.lower()


def test_typo_in_value_is_fixable_warning() -> None:
    card = CardIn(
        name="Бумага цветная", characteristics=[CharIn(name="Интенсивность цвета", value="Медиму")]
    )
    found = _by_field(detect(card, COLOR), "characteristics.Интенсивность цвета")
    assert [(i.kind, i.severity) for i in found] == [("typo", "warn")]
    assert found[0].fix is not None and found[0].fix.value == "Медиум"


def test_typo_in_characteristic_name_points_to_position_name() -> None:
    card = CardIn(
        name="Бумага цветная", characteristics=[CharIn(name="Цветнасть", value="Цветная")]
    )
    found = _by_field(detect(card, COLOR), "characteristics.Цветнасть")
    assert [i.kind for i in found] == ["typo"]
    assert found[0].fix is not None and found[0].fix.name == "Цветность"


def test_clean_card_is_ready() -> None:
    card = CardIn(
        name="Бумага для офисной техники белая",
        characteristics=[
            CharIn(name="Формат", value="A4"),
            CharIn(name="Масса бумаги площадью 1 м2", value="80", unit="г/м2"),
            CharIn(name="Количество листов в пачке", value="500", unit="шт"),
            CharIn(name="Класс", value="A"),
        ],
    )
    issues = detect(card, WHITE)
    assert issues == []
    assert verdict(issues) == "ready"


GLOVES_POS = CATALOG.get("22.19.60.119-00000301")


def test_contradiction_is_found_by_word_form() -> None:
    # Ревью: «стерильная» в наименовании не совпадала со значением «Стерильные» целым словом.
    card = CardIn(
        name="Перчатки смотровые стерильная пара",
        characteristics=[CharIn(name="Стерильность", value="Нестерильные")],
    )
    found = _by_field(detect(card, GLOVES_POS), "characteristics.Стерильность")
    assert [(i.kind, i.severity) for i in found] == [("mismatch", "block")]
    assert found[0].fix is not None and found[0].fix.value == "Стерильные"


def test_same_value_in_another_word_form_is_not_a_contradiction() -> None:
    card = CardIn(
        name="Перчатки смотровые нестерильная пара",
        characteristics=[CharIn(name="Стерильность", value="Нестерильные")],
    )
    assert _by_field(detect(card, GLOVES_POS), "characteristics.Стерильность") == []


def test_multi_word_value_present_in_the_name_is_not_a_contradiction() -> None:
    # Справочник с портала: «Кресло офисное черное экокожа», значение «Черная экокожа» — то же,
    # а не противоречие с «Черный».
    spec = CharacteristicSpec(
        name="Требования к цветовому решению",
        kind="qualitative",
        values=["Черная экокожа", "Черный", "Серая ткань"],
    )
    chair = Position(code="K-1", name="Кресла офисные", okpd2="", characteristics=[spec],
                     source="test")  # fmt: skip
    card = CardIn(
        name="Кресло офисное черное экокожа",
        characteristics=[CharIn(name="Требования к цветовому решению", value="Черная экокожа")],
    )
    assert _by_field(detect(card, chair), "characteristics.Требования к цветовому решению") == []
    wrong = CardIn(
        name="Кресло офисное черное экокожа",
        characteristics=[CharIn(name="Требования к цветовому решению", value="Серая ткань")],
    )
    found = _by_field(detect(wrong, chair), "characteristics.Требования к цветовому решению")
    assert [i.kind for i in found] == ["mismatch"]


def test_allowed_value_is_not_a_conflict() -> None:
    card = CardIn(name="Бумага цветная", characteristics=[CharIn(name="Формат", value="A4")])
    assert _by_field(detect(card, COLOR), "characteristics.Формат") == []


def test_number_outside_range_names_the_bounds() -> None:
    bags = CATALOG.get("22.22.11.000-00000201")
    card = CardIn(
        name="Мешки для мусора", characteristics=[CharIn(name="Толщина", value="200", unit="мкм")]
    )
    found = _by_field(detect(card, bags), "characteristics.Толщина")
    assert found[0].severity == "block"
    assert "200" in found[0].message
    assert "120" in found[0].message


def test_several_conflicts_stay_together() -> None:
    card = CardIn(
        name="Бумага цветная",
        characteristics=[
            CharIn(name="Формат", value="A5"),
            CharIn(name="Интенсивность цвета", value="Белый"),
        ],
    )
    fields = {issue.field for issue in detect(card, COLOR) if issue.severity == "block"}
    assert "characteristics.Формат" in fields
    assert "characteristics.Интенсивность цвета" in fields


def test_corrected_value_drops_only_its_conflict() -> None:
    fixed = CardIn(
        name="Бумага цветная",
        characteristics=[
            CharIn(name="Формат", value="A4"),
            CharIn(name="Интенсивность цвета", value="Белый"),
        ],
    )
    found = detect(fixed, COLOR)
    assert _by_field(found, "characteristics.Формат") == []
    assert _by_field(found, "characteristics.Интенсивность цвета")
