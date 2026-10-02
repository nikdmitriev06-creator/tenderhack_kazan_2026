"""Карточки СТЕ Портала поставщиков (`data/portal/*.jsonl`): что поставщики ввели на портале.

Собирают их скрипты `data/portal/fetch_portal.py` и `fetch_categories.py` с публичного API портала.
Значения приводятся к тексту так, как их показывает портал: «2027», «0,5», «Да».
"""

import json
from pathlib import Path

from pydantic import BaseModel

from app.schemas import CardIn, CharIn

SKU_URL = "https://zakupki.mos.ru/sku/view/{id}"
# Тип значения у портала (productCharacteristicDescriptionTypeId) повторяет тип JSON: 1 — целое,
# 2 — дробное, 4 — да/нет, 5 и 6 — текст; поэтому разбираем по самому значению.


class PortalChar(BaseModel):
    name: str
    value: str
    unit: str | None = None
    numeric: bool = False
    boolean: bool = False


class PortalCard(BaseModel):
    id: int
    name: str
    description: str = ""
    root: str = ""
    category: str = ""
    category_path: str = ""
    okpd: str = ""
    characteristics: list[PortalChar] = []

    @property
    def url(self) -> str:
        return SKU_URL.format(id=self.id)

    @property
    def text(self) -> str:
        return f"{self.name}\n{self.description}"

    def to_card_in(self) -> CardIn:
        return CardIn(
            name=self.name,
            description=self.description,
            characteristics=[
                CharIn(name=c.name, value=c.value, unit=c.unit) for c in self.characteristics
            ],
        )


def _number_text(v: float) -> str:
    if float(v).is_integer():
        return str(int(v))
    return format(v, "f").rstrip("0").rstrip(".").replace(".", ",")


def _unit(raw: object) -> str | None:
    """«г; лет» — несколько единиц через «;»: берём первую; «.» и пустое — без единицы."""
    if not isinstance(raw, str):
        return None
    first = raw.split(";")[0].strip()
    return first if first and first != "." else None


def _char(raw: dict) -> PortalChar | None:
    name, value = (raw.get("name") or "").strip(), raw.get("value")
    if not name or value is None:
        return None
    if isinstance(value, bool):
        return PortalChar(name=name, value="Да" if value else "Нет", boolean=True)
    if isinstance(value, int | float):
        return PortalChar(name=name, value=_number_text(value), unit=_unit(raw.get("unit")),
                          numeric=True)  # fmt: skip
    text = str(value).strip()
    return PortalChar(name=name, value=text, unit=_unit(raw.get("unit"))) if text else None


def parse_card(raw: dict) -> PortalCard | None:
    name = (raw.get("name") or "").strip()
    if not name:
        return None
    chars = [c for ch in raw.get("characteristics") or [] if (c := _char(ch)) is not None]
    return PortalCard(
        id=int(raw["id"]),
        name=name,
        description=(raw.get("description") or "").strip(),
        root=raw.get("root") or "",
        category=raw.get("category") or "",
        category_path=raw.get("category_path") or "",
        okpd=raw.get("okpd") or "",
        characteristics=chars,
    )


def load_cards(paths: list[Path]) -> list[PortalCard]:
    """Карточки из jsonl-файлов; повтор по id и карточки без наименования отбрасываются."""
    out: dict[int, PortalCard] = {}
    for path in paths:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            card = parse_card(json.loads(line))
            if card is not None:
                out.setdefault(card.id, card)
    return list(out.values())
