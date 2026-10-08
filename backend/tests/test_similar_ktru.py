"""Регрессия на синтетическом каталоге из 30 похожих позиций.

Файл лежит в data/ (не в git): это текущий справочник стенда, его не подменяем фикстурой.
"""

import asyncio
from pathlib import Path

import pytest

from app.catalog import Catalog
from app.extract import LLMItems
from app.glossary import Glossary
from app.llm import LLMError
from app.pipeline import AutofillIn, Deps, autofill
from app.search import build_bm25
from app.session import SessionStore
from tests.fakes import FakeLLM, FakeRedis

CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "ktru_similar_products_30.json"
pytestmark = pytest.mark.skipif(
    not CATALOG_PATH.is_file(), reason="нет data/ktru_similar_products_30.json"
)

MASS = "Масса бумаги площадью 1 м2"
SHEETS = "Количество листов в пачке"
WHITENESS = "Белизна по CIE"


def _deps(llm: FakeLLM | None = None) -> tuple[Deps, FakeLLM]:
    catalog = Catalog.load([CATALOG_PATH])
    model = llm or FakeLLM([LLMItems(items=[])] * 30)
    deps = Deps(
        catalog=catalog,
        bm25=build_bm25(catalog),
        vectors=None,
        llm=model,  # type: ignore[arg-type]
        glossary=Glossary([]),
        sessions=SessionStore(FakeRedis(), ttl_s=900),  # type: ignore[arg-type]
        min_score=0.2,
    )
    return deps, model


def _fill(name: str, description: str = "", llm: FakeLLM | None = None):
    deps, model = _deps(llm)
    out = asyncio.run(autofill(AutofillIn(name=name, description=description), deps))
    return out, model


def _value(out, name: str) -> str | None:
    for char in out.characteristics:
        if char.name == name:
            return char.value
    return None


@pytest.mark.parametrize(
    ("name", "code"),
    [
        (
            "Бумага для принтера формата А4, плотность 80 г/м², пачка 500 листов",
            "17.12.14.129-TEST0001",
        ),
        ("Бумага для офисной печати А4, 90 г/м², 500 листов", "17.12.14.129-TEST0006"),
        ("Бумага А4, 100 г/м², 500 листов", "17.12.14.129-TEST0011"),
        ("Бумага для печати А3, 80 г/м², 500 листов", "17.12.14.129-TEST0016"),
        ("Бумага А4, 90 г/м², 250 листов", "17.12.14.129-TEST0008"),
        ("Бумага А4, 100 г/м², 500 листов, глянцевая", "17.12.14.129-TEST0028"),
        ("Бумага А4 80 г/м2 500 листов", "17.12.14.129-TEST0001"),
        ("Бумага А4 80 г/м² 500 листов", "17.12.14.129-TEST0001"),
        (
            "Бумага А4 80 грамм на квадратный метр, пачка 500 штук",
            "17.12.14.129-TEST0001",
        ),
        ("Бумага А4 80 500", "17.12.14.129-TEST0001"),
        ("Бумага А4 90 500", "17.12.14.129-TEST0006"),
        ("Бумга А4 80", "17.12.14.129-TEST0001"),
    ],
)
def test_similar_products_resolve_to_the_defining_code(name: str, code: str) -> None:
    out, _ = _fill(name)
    assert out.ktru.final_code == code
    question = out.ktru.question.characteristic if out.ktru.question else None
    assert question != WHITENESS


def test_typo_bumga_resolves_without_asking_whiteness() -> None:
    # «80» не называет число листов. 250 и 500 различают позиции, но текст этого не говорит,
    # поэтому берётся ближайшая, а не вопрос про белизну.
    out, _ = _fill("Бумга А4 80")
    assert out.ktru.final_code == "17.12.14.129-TEST0001"
    question = out.ktru.question.characteristic if out.ktru.question else None
    assert question != WHITENESS
    assert _value(out, MASS) == "80"


def test_printer_typo_still_retrieves_the_paper() -> None:
    out, model = _fill("Бумага для прнтера А4 80 г/м² 500 листов")
    assert out.ktru.final_code == "17.12.14.129-TEST0001"
    assert model.calls  # белизна и непрозрачность правила не закрывают


def test_bare_numbers_are_kept() -> None:
    out, _ = _fill("Бумага А4 80 500")
    assert (_value(out, MASS), _value(out, SHEETS)) == ("80", "500")
    assert not any("80" in i.message and "не подстав" in i.message for i in out.issues)


def test_density_range_is_not_an_exact_code() -> None:
    name = (
        "Нужна обычная белая бумага для офиса. Формат А4, пачка 500 листов. "
        "Плотность примерно 90–100 г/м², матовая, для лазерной и двусторонней печати."
    )
    out, _ = _fill(name)
    assert out.ktru.final_code is None
    assert out.ktru.question is not None
    assert out.ktru.question.characteristic == MASS
    codes = {c.code for c in out.ktru.candidates}
    assert "17.12.14.129-TEST0006" in codes
    assert "17.12.14.129-TEST0011" in codes


def test_llm_error_is_visible_and_rules_still_match() -> None:
    out, _ = _fill("Бумага А4 80 г/м² 500 листов", llm=FakeLLM([LLMError("нет связи")]))
    assert out.ktru.final_code == "17.12.14.129-TEST0001"
    assert "llm" in out.degraded


def test_compound_unit_spellings_land_on_gsm() -> None:
    for name in (
        "Бумага А4 80 г / м² 500 листов",
        "Бумага А4 80 г на м2 500 шт",
        "Бумага А4 80 грамм/м² 500 листов",
    ):
        out, _ = _fill(name)
        assert out.ktru.final_code == "17.12.14.129-TEST0001", name
        assert _value(out, MASS) == "80"
