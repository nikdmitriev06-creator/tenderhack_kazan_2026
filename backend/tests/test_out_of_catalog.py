"""Товары рядом со справочником, но не из него: итоговый код без подтверждения не ставится.

Примеры — из ревью на 1 484 реальных строках портала: «Белая глина» стала офисной бумагой, «Шланг
высокого давления» — мешком из ПВД, «Стержень гелевый» — ручкой. Код КТРУ — авторитетный результат,
поэтому совпадение одного прилагательного его не даёт.
"""

import asyncio
from pathlib import Path

import pytest

from app.catalog import Catalog
from app.extract import LLMItems
from app.glossary import Glossary
from app.narrowing import CONFIRM, NOTHING_FITS
from app.pipeline import AnswerIn, AutofillIn, AutofillOut, Deps, answer, autofill
from app.search import build_bm25
from app.session import SessionStore
from tests.fakes import FakeLLM, FakeRedis

CATALOG = Catalog.load([Path(__file__).parent.parent / "app" / "catalog" / "demo" / "demo.json"])
WHITE = "17.12.14.129-00000031"
NITRILE = "22.19.60.119-00000301"
BATTERY = "27.20.11.000-00000501"


def _deps() -> Deps:
    return Deps(
        catalog=CATALOG,
        bm25=build_bm25(CATALOG),
        vectors=None,
        llm=FakeLLM([LLMItems(items=[])] * 5),  # type: ignore[arg-type]
        glossary=Glossary([]),
        sessions=SessionStore(FakeRedis(), ttl_s=900),  # type: ignore[arg-type]
        min_score=0.2,
    )


def _fill(name: str, deps: Deps | None = None) -> AutofillOut:
    return asyncio.run(autofill(AutofillIn(name=name), deps or _deps()))


@pytest.mark.parametrize(
    "name",
    [
        "Белая глина",
        "Куприн. Белый пудель",
        "Кожа натуральная Наппа, белый",
        "Бумага туалетная 4 рулона",
        "Шланг высокого давления 1SN",
        "Стержень гелевый синий",
        "Маркер перманентный черный",
        "Перчатки латексные хозяйственные",
        "Папка уголок А4",
        "Бумага наждачная",
    ],
)
def test_near_domain_product_gets_no_final_code(name: str) -> None:
    out = _fill(name)
    assert out.ktru.final_code is None


def test_unexplained_word_asks_to_confirm_the_position() -> None:
    out = _fill("Бумага туалетная 4 рулона")
    q = out.ktru.question
    if out.ktru.candidates:  # кандидат нашёлся по «бумага» — его надо подтвердить или отклонить
        assert q is not None
        assert q.characteristic == CONFIRM or NOTHING_FITS in [o.value for o in q.options]
        assert any("туалетн" in s for s in out.ktru.steps)


def test_negation_excludes_the_negated_material() -> None:
    out = _fill("Перчатки смотровые не нитриловые, размер M")
    assert NITRILE not in [c.code for c in out.ktru.candidates]


def test_every_question_offers_nothing_fits() -> None:
    out = _fill("Бумага офисная А4 500 листов")
    assert out.ktru.question is not None
    assert NOTHING_FITS in [o.value for o in out.ktru.question.options]


def test_nothing_fits_answer_is_an_honest_refusal() -> None:
    deps = _deps()
    out = _fill("Бумага офисная А4 500 листов", deps)
    q = out.ktru.question
    assert q is not None
    after = asyncio.run(
        answer(out.session_id, AnswerIn(characteristic=q.characteristic, value=NOTHING_FITS), deps)
    )
    assert after.ktru.final_code is None
    assert after.ktru.candidates == []
    assert after.ktru.steps[0].startswith("Категория не найдена")


def test_fully_explained_name_still_gets_final_code() -> None:
    assert _fill("Бумага офисная белая А4 500 листов").ktru.final_code == WHITE
    nitrile = "Перчатки смотровые нитриловые нестерильные неопудренные, размер M"
    assert _fill(nitrile).ktru.final_code == NITRILE


def test_brand_and_model_words_do_not_block_the_code() -> None:
    # «Туринский ЦБЗ», «IQ COLOR» — бренды: их нет в справочнике, но подтверждать позицию
    # из-за них не нужно.
    assert _fill("Бумага офисная белая Туринский ЦБЗ А4 500 листов").ktru.final_code == WHITE


def test_confirming_the_position_gives_final_code() -> None:
    deps = _deps()
    out = _fill("Батарейка AA щелочная 1,5 В", deps)
    q = out.ktru.question
    assert q is not None and q.characteristic == CONFIRM
    assert BATTERY in [o.value for o in q.options]
    after = asyncio.run(
        answer(out.session_id, AnswerIn(characteristic=CONFIRM, value=BATTERY), deps)
    )
    assert after.ktru.final_code == BATTERY


def test_typo_in_name_is_not_an_unexplained_word() -> None:
    # «Бумаага» — та же «бумага» с опечаткой: подтверждать позицию из-за неё не нужно.
    out = _fill("Бумаага офисная белая А4 500 листов")
    assert out.ktru.final_code == WHITE


def test_typo_correction_keeps_the_first_letter() -> None:
    # Оценка: «колёсах» исправлялось в «солевая» (батарейка) — стул получал кандидата.
    out = _fill("Стул офисный на колёсах")
    assert out.ktru.candidates == []
