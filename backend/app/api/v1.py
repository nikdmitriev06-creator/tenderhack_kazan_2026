"""Контракт модуля для Портала поставщиков: `/api/v1`. Описан в OpenAPI (`/api/docs`)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.batch import (
    BatchAccepted,
    BatchFormatError,
    BatchState,
    BatchTooLarge,
    parse_upload,
    result_workbook,
)
from app.catalog import Position
from app.evaluation import MetricsOut
from app.pipeline import (
    AnswerIn,
    AutofillIn,
    AutofillOut,
    BadAnswer,
    Deps,
    SessionNotFound,
    answer,
    autofill,
    check,
)
from app.portal import PortalReport
from app.schemas import CardIn, CheckOut

router = APIRouter(prefix="/v1", tags=["модуль"])

SESSION_GONE = "сессия заполнения не найдена или истекла"


def get_deps(request: Request) -> Deps:
    return request.app.state.deps


DepsDep = Annotated[Deps, Depends(get_deps)]


@router.post("/autofill", summary="Описание поставщика → черновик карточки")
async def post_autofill(inp: AutofillIn, deps: DepsDep) -> AutofillOut:
    """Кандидаты КТРУ, характеристики с источником в тексте, замечания и вопрос для сужения."""
    return await autofill(inp, deps)


@router.post("/autofill/{session_id}/answer", summary="Ответ на уточняющий вопрос")
async def post_answer(session_id: str, inp: AnswerIn, deps: DepsDep) -> AutofillOut:
    try:
        return await answer(session_id, inp, deps)
    except SessionNotFound as exc:
        raise HTTPException(status_code=404, detail=SESSION_GONE) from exc
    except BadAnswer as exc:
        raise HTTPException(status_code=422, detail=f"ответ не подходит к вопросу: {exc}") from exc


@router.post("/check", summary="Проверка готовой карточки")
async def post_check(card: CardIn, deps: DepsDep) -> CheckOut:
    """Замечания с обоснованием и ссылкой на правило; нужна поставщику и модератору."""
    return check(card, deps)


@router.get("/ktru/{code}", summary="Позиция справочника")
async def get_ktru(code: str, deps: DepsDep) -> Position:
    position = deps.catalog.get(code)
    if position is None:
        raise HTTPException(status_code=404, detail="позиция не найдена")
    return position


BATCH_GONE = "пакет не найден или истёк срок хранения"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.post("/batch", status_code=202, summary="Массовая загрузка: файл в очередь")
async def post_batch(file: UploadFile, deps: DepsDep) -> BatchAccepted:
    """xlsx или csv со списком СТЕ; роли колонок угадываются по содержимому.

    Обработка — воркером через очередь; состояние — `GET /api/v1/batch/{job_id}`.
    """
    if deps.batches is None or deps.enqueue_batch is None:
        raise HTTPException(status_code=503, detail="очередь пакетов не настроена")
    data = await file.read()
    filename = file.filename or "upload.xlsx"
    try:
        rows = await run_in_threadpool(parse_upload, filename, data)
    except BatchTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except BatchFormatError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    job_id = await deps.batches.create(filename, rows)
    try:
        await deps.enqueue_batch(job_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"очередь недоступна: {exc}") from exc
    return BatchAccepted(job_id=job_id, status_url=f"/api/v1/batch/{job_id}")


@router.get("/batch/{job_id}", summary="Состояние пакета")
async def get_batch(job_id: str, deps: DepsDep) -> BatchState:
    state = await deps.batches.state(job_id) if deps.batches else None
    if state is None:
        raise HTTPException(status_code=404, detail=BATCH_GONE)
    return state


@router.get(
    "/batch/{job_id}/result.xlsx",
    summary="Файл с результатом",
    response_class=Response,
    responses={200: {"content": {XLSX: {}}}},
)
async def get_batch_result(job_id: str, deps: DepsDep) -> Response:
    state = await deps.batches.state(job_id) if deps.batches else None
    if state is None or deps.batches is None:
        raise HTTPException(status_code=404, detail=BATCH_GONE)
    if state.status != "done":
        raise HTTPException(status_code=409, detail="пакет ещё обрабатывается")
    content = result_workbook(state, await deps.batches.rows(job_id))
    disposition = 'attachment; filename="result.xlsx"'
    return Response(content, media_type=XLSX, headers={"Content-Disposition": disposition})


@router.get("/metrics", summary="Качество на золотом наборе")
async def get_metrics(deps: DepsDep) -> MetricsOut:
    """Результат последнего прогона `python -m app.tools.evaluate`.

    У каждой метрики — значение, размер выборки и способ расчёта.
    """
    if not deps.metrics_path.is_file():
        raise HTTPException(status_code=404, detail="оценка ещё не запускалась")
    return MetricsOut.model_validate_json(deps.metrics_path.read_text(encoding="utf-8"))


@router.get("/metrics/portal", summary="Живые карточки портала: аудит и заполнение")
async def get_portal_report(deps: DepsDep) -> PortalReport:
    """Результат последнего прогона `python -m app.tools.portal_report`.

    Карточки СТЕ с публичного API портала: сколько нарушают правила модерации (с примерами-ссылками)
    и насколько значения, извлечённые модулем из текста, совпадают с введёнными поставщиком.
    """
    if not deps.portal_report_path.is_file():
        raise HTTPException(status_code=404, detail="отчёт по карточкам портала ещё не собран")
    return PortalReport.model_validate_json(deps.portal_report_path.read_text(encoding="utf-8"))
