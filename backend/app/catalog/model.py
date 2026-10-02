"""Справочник позиций (КТРУ, СПГЗ): позиция и спецификации её характеристик.

Модуль не знает, откуда пришёл справочник: загрузчики (`loaders.py`) приводят любой источник
к этим моделям.
"""

from typing import Literal

from pydantic import BaseModel


class NumRange(BaseModel):
    min: float | None = None
    max: float | None = None


class CharacteristicSpec(BaseModel):
    """Характеристика позиции: перечень (`values`) или диапазон (`range`), единица."""

    name: str
    kind: Literal["qualitative", "quantitative"]
    unit: str | None = None
    values: list[str] = []
    range: NumRange | None = None
    required: bool = False
    # Характеристика определяет позицию (признак isLevelDefine портала).
    level_define: bool = False


class Position(BaseModel):
    code: str
    name: str
    okpd2: str
    unit: str | None = None
    characteristics: list[CharacteristicSpec]
    source: str


class CatalogError(RuntimeError):
    """Справочник не загружен или противоречив: модуль без него не работает."""
