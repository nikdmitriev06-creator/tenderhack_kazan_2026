"""Массовая загрузка: файл поставщика (xlsx, csv) → те же предложения и проверки по каждой строке.

API только разбирает файл и ставит задачу в очередь; строки обрабатывает воркер (`run_batch`).
Сбой одной строки не роняет задачу: у строки свой статус и причина.
"""

import io
import logging
import tempfile
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from openpyxl import Workbook
from pydantic import BaseModel
from redis.asyncio import Redis

from app.checks.detector import detect, verdict
from app.ingest.characteristics import parse_characteristics
from app.ingest.profile import profile_table
from app.ingest.readers import Table, read_tables
from app.schemas import CardIn, CharIn, Issue

log = logging.getLogger(__name__)

MAX_ROWS = 5000
MAX_BYTES = 5 * 1024 * 1024
MODULE_COLUMNS = ["Код КТРУ", "Заполнено", "Замечания", "Статус"]
STATUS_TEXT = {
    "ready": "готово",
    "needs_answer": "нужен ответ",
    "needs_fix": "нужно исправить",
    "not_found": "нет в справочнике",
    "skipped": "пустая строка",
    "failed": "сбой",
}


class BatchFormatError(ValueError):
    """Файл прочитан, но не похож на список СТЕ."""


class BatchTooLarge(ValueError):
    """Файл больше лимита: такие грузятся частями."""


class BatchRow(BaseModel):
    row: int
    name: str
    description: str = ""
    characteristics: list[CharIn] = []
    empty: bool = False
    raw: dict[str, str] = {}


class BatchRowResult(BaseModel):
    row: int
    name: str
    status: Literal["ready", "needs_answer", "needs_fix", "not_found", "skipped", "failed"]
    ktru_code: str | None
    filled: int
    issues: list[Issue]
    # Почему код не подобран (первый шаг сужения) — для «нет в справочнике».
    note: str | None = None
    error: str | None = None


class BatchState(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "failed"]
    filename: str
    total: int
    processed: int
    rows: list[BatchRowResult]


class BatchAccepted(BaseModel):
    job_id: str
    status_url: str


def _text(v: Any) -> str:
    return "" if v is None else str(v).strip()


def parse_upload(filename: str, data: bytes) -> list[BatchRow]:
    if len(data) > MAX_BYTES:
        raise BatchTooLarge(f"файл больше {MAX_BYTES // (1024 * 1024)} МБ: разбейте его на части")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / Path(filename).name
        path.write_bytes(data)
        tables, skipped = read_tables(Path(tmp))
        if not tables:
            reason = skipped[0].reason if skipped else "таблица не найдена"
            raise BatchFormatError(f"файл не прочитан: {reason}")
        try:
            return _rows_of(tables[0])
        finally:
            for t in tables:
                if t.close is not None:
                    t.close()


def _rows_of(table: Table) -> list[BatchRow]:
    """Строки таблицы: роли колонок — по содержимому (`profile_table`), а не по заголовку."""
    profile = profile_table(table)
    name_col = profile.column_for("name")
    if name_col is None:
        raise BatchFormatError("не найдена колонка с наименованием СТЕ")
    desc_col = profile.column_for("description")
    char_col = profile.column_for("characteristics")
    rows: list[BatchRow] = []
    for i, record in enumerate(table.rows(), start=1):
        if i > MAX_ROWS:
            raise BatchTooLarge(f"строк больше {MAX_ROWS}: разбейте файл на части")
        name = _text(record.get(name_col))
        chars = []
        if char_col:
            parsed = parse_characteristics(record.get(char_col))
            chars = [CharIn(name=c.name, value=c.value.raw, unit=c.unit) for c in parsed.items]
        rows.append(
            BatchRow(
                row=i,
                name=name,
                description=_text(record.get(desc_col)) if desc_col else "",
                characteristics=chars,
                empty=not name,
                raw={col: _text(record.get(col)) for col in table.columns},
            )
        )
    return rows


async def process_row(row: BatchRow, deps: Any) -> BatchRowResult:
    from app.pipeline import AutofillIn, prepare_session, render

    if row.empty:
        return BatchRowResult(
            row=row.row, name=row.name, status="skipped", ktru_code=None, filled=0, issues=[]
        )
    try:
        session = await prepare_session(
            AutofillIn(name=row.name, description=row.description), deps
        )
        out = render(session, deps)
        if not out.ktru.candidates:
            return BatchRowResult(
                row=row.row, name=row.name, status="not_found", ktru_code=None, filled=0,
                issues=[], note=out.ktru.steps[0] if out.ktru.steps else None,
            )  # fmt: skip
        position = deps.catalog.get(out.ktru.final_code) if out.ktru.final_code else None
        offered = [c for c in out.characteristics if c.value is not None and c.status != "conflict"]
        own = {c.name for c in row.characteristics}
        card = CardIn(
            name=row.name,
            description=row.description,
            characteristics=row.characteristics
            + [
                CharIn(name=c.name, value=c.value or "", unit=c.unit)
                for c in offered
                if c.name not in own
            ],
        )
        issues = detect(card, position)
        if out.ktru.final_code is None:
            status: Literal["ready", "needs_answer", "needs_fix"] = "needs_answer"
        else:
            status = "ready" if verdict(issues) == "ready" else "needs_fix"
        return BatchRowResult(
            row=row.row,
            name=row.name,
            status=status,
            ktru_code=out.ktru.final_code,
            filled=len(offered),
            issues=issues,
        )
    except Exception as exc:
        log.exception("строка %d пакета не обработана", row.row)
        return BatchRowResult(
            row=row.row, name=row.name, status="failed", ktru_code=None, filled=0, issues=[],
            error=f"{type(exc).__name__}: {exc}",
        )  # fmt: skip


def _state_key(job_id: str) -> str:
    return f"batch:{job_id}"


def _rows_key(job_id: str) -> str:
    return f"batch:{job_id}:rows"


class BatchStore:
    def __init__(self, redis: Redis, ttl_s: int) -> None:
        self.redis = redis
        self.ttl_s = ttl_s

    async def create(self, filename: str, rows: list[BatchRow]) -> str:
        job_id = uuid4().hex
        payload = "[" + ",".join(r.model_dump_json() for r in rows) + "]"
        await self.redis.set(_rows_key(job_id), payload, ex=self.ttl_s)
        state = BatchState(
            job_id=job_id, status="queued", filename=filename, total=len(rows), processed=0, rows=[]
        )
        await self.save(state)
        return job_id

    async def save(self, state: BatchState) -> None:
        await self.redis.set(_state_key(state.job_id), state.model_dump_json(), ex=self.ttl_s)

    async def state(self, job_id: str) -> BatchState | None:
        raw = await self.redis.get(_state_key(job_id))
        return BatchState.model_validate_json(raw) if raw else None

    async def rows(self, job_id: str) -> list[BatchRow]:
        raw = await self.redis.get(_rows_key(job_id))
        if not raw:
            return []
        from pydantic import TypeAdapter

        return TypeAdapter(list[BatchRow]).validate_json(raw)


async def run_batch(job_id: str, deps: Any) -> None:
    store: BatchStore = deps.batches
    state = await store.state(job_id)
    if state is None:
        log.warning("пакет %s не найден или истёк", job_id)
        return
    rows = await store.rows(job_id)
    state.status = "running"
    await store.save(state)
    for row in rows:
        state.rows.append(await process_row(row, deps))
        state.processed = len(state.rows)
        await store.save(state)
    state.status = "done"
    await store.save(state)


def result_workbook(state: BatchState, rows: list[BatchRow]) -> bytes:
    columns = list(rows[0].raw) if rows and rows[0].raw else ["Наименование"]
    results = {r.row: r for r in state.rows}
    wb = Workbook()
    ws = wb.active
    ws.title = "Результат"
    ws.append(columns + MODULE_COLUMNS)
    for row in rows:
        res = results.get(row.row)
        base = [row.raw.get(c, "") for c in columns] if row.raw else [row.name]
        if res is None:
            ws.append([*base, "", "", "", "не обработано"])
            continue
        notes = "; ".join(
            [
                *([res.note] if res.note else []),
                *(f"{i.field}: {i.message}" for i in res.issues if i.severity != "info"),
            ]
        )
        ws.append([*base, res.ktru_code or "", res.filled, notes, STATUS_TEXT[res.status]])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
