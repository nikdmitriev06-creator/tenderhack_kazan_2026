from typing import Literal

from pydantic import BaseModel, Field

from app.schemas import Span


class Extracted(BaseModel):
    """Значение характеристики позиции, найденное в тексте, — ещё не подогнанное к перечню."""

    name: str
    raw_value: str
    raw_unit: str | None = None
    source: Span
    method: Literal["rule", "llm"]


class LLMItem(BaseModel):
    name: str = Field(description="имя характеристики строго из списка")
    value: str = Field(description="значение; если у характеристики есть перечень — из перечня")
    unit: str | None = Field(default=None, description="единица измерения или null")
    quote: str = Field(description="точный фрагмент текста поставщика, из которого взято значение")


class LLMItems(BaseModel):
    items: list[LLMItem]
