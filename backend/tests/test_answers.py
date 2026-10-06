"""Ответы на уточняющие вопросы: одновременные ответы не теряются, чужой ответ — 422."""

import asyncio
from pathlib import Path

import pytest

from app.catalog import Catalog
from app.extract import LLMItems
from app.glossary import Glossary
from app.pipeline import AnswerIn, AutofillIn, BadAnswer, Deps, answer, autofill
from app.search import build_bm25
from app.session import SessionStore
from tests.fakes import FakeLLM, FakeRedis

CATALOG = Catalog.load([Path(__file__).parent.parent / "app" / "catalog" / "demo" / "demo.json"])


def _deps(redis: FakeRedis) -> Deps:
    return Deps(
        catalog=CATALOG,
        bm25=build_bm25(CATALOG),
        vectors=None,
        llm=FakeLLM([LLMItems(items=[])] * 5),  # type: ignore[arg-type]
        glossary=Glossary([]),
        sessions=SessionStore(redis, ttl_s=900),  # type: ignore[arg-type]
        min_score=0.2,
    )


def test_concurrent_answers_are_all_kept() -> None:
    redis = FakeRedis(yield_between=True)
    deps = _deps(redis)

    async def scenario() -> list[str]:
        out = await autofill(AutofillIn(name="Перчатки смотровые нитриловые"), deps)
        await asyncio.gather(
            answer(out.session_id, AnswerIn(characteristic="Размер", value="M"), deps),
            answer(
                out.session_id, AnswerIn(characteristic="Стерильность", value="Нестерильные"), deps
            ),
            answer(
                out.session_id, AnswerIn(characteristic="Опудренность", value="Неопудренные"), deps
            ),
        )
        session = await deps.sessions.load(out.session_id)
        assert session is not None
        return sorted(k for k, v in session.known.items() if v.source == "answer")

    assert asyncio.run(scenario()) == ["Опудренность", "Размер", "Стерильность"]


def test_answer_to_unknown_characteristic_is_rejected() -> None:
    deps = _deps(FakeRedis())
    out = asyncio.run(autofill(AutofillIn(name="Бумага офисная А4 500 листов"), deps))
    with pytest.raises(BadAnswer):
        asyncio.run(
            answer(out.session_id, AnswerIn(characteristic="Цвет кузова", value="Красный"), deps)
        )


def test_answer_value_outside_the_options_is_rejected() -> None:
    deps = _deps(FakeRedis())
    out = asyncio.run(autofill(AutofillIn(name="Бумага офисная А4 500 листов"), deps))
    with pytest.raises(BadAnswer):
        asyncio.run(
            answer(out.session_id, AnswerIn(characteristic="Цветность", value="Зелёная"), deps)
        )
