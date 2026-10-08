"""Стенд портала для демонстрации: очередь заявок модератора (`/api/demo`). Не часть модуля."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.v1 import DepsDep
from app.demo import (
    AlreadyDecided,
    DecisionIn,
    Submission,
    SubmissionIn,
    SubmissionRepo,
    SubmissionView,
)
from app.pipeline import check, moderation_block

router = APIRouter(prefix="/demo", tags=["стенд портала"])

NOT_FOUND = "заявка не найдена"


def get_submissions(request: Request) -> SubmissionRepo:
    return request.app.state.submissions


RepoDep = Annotated[SubmissionRepo, Depends(get_submissions)]


@router.post("/submissions", status_code=201, summary="Поставщик отправил заявку")
async def post_submission(s: SubmissionIn, repo: RepoDep, deps: DepsDep) -> Submission:
    reason = moderation_block(s.card, deps)
    if reason is not None:
        raise HTTPException(status_code=422, detail=reason)
    return await repo.add(s)


@router.get("/submissions", summary="Очередь модератора, новые сверху")
async def list_submissions(repo: RepoDep) -> list[Submission]:
    return await repo.list()


@router.get("/submissions/{id}", summary="Заявка с проверкой модуля")
async def get_submission(id: int, repo: RepoDep, deps: DepsDep) -> SubmissionView:
    sub = await repo.get(id)
    if sub is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return SubmissionView(**sub.model_dump(), check=check(sub.card, deps))


@router.post("/submissions/{id}/decision", summary="Решение модератора")
async def post_decision(id: int, d: DecisionIn, repo: RepoDep) -> Submission:
    try:
        sub = await repo.decide(id, d)
    except AlreadyDecided as exc:
        raise HTTPException(status_code=409, detail="по заявке уже есть решение") from exc
    if sub is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return sub
