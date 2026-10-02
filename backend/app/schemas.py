"""Модели API модуля: единственный источник формы запросов и ответов (фронт берёт их из OpenAPI)."""

from typing import Literal

from pydantic import BaseModel


class Span(BaseModel):
    """Фрагмент исходного текста: в наименовании или в описании, позиции в символах."""

    field: Literal["name", "description"]
    start: int
    end: int
    text: str


class CharIn(BaseModel):
    name: str
    value: str
    unit: str | None = None


class CardIn(BaseModel):
    name: str
    description: str = ""
    characteristics: list[CharIn] = []
    ktru_code: str | None = None


IssueKind = Literal["typo", "mismatch", "not_in_list", "moderation_rule"]


class Fix(BaseModel):
    name: str | None = None
    value: str | None = None
    unit: str | None = None


class Issue(BaseModel):
    field: str
    kind: IssueKind
    severity: Literal["block", "warn", "info"]
    message: str
    why: str
    rule: str
    fix: Fix | None = None


class CheckOut(BaseModel):
    issues: list[Issue]
    verdict: Literal["ready", "needs_fix"]
