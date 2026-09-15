"""Authenticated study-history endpoints; every operation is owner scoped."""

from collections.abc import Callable
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import AuthIdentity
from app.domain.feedback import VoiceFeedback
from app.domain.voice_protocol import ScenarioType
from app.persistence.study import NoteConflictError, StudyNotFoundError, StudyRepository


class CorrectionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    original: str = Field(min_length=1, max_length=1_000)
    corrected: str = Field(min_length=1, max_length=1_000)
    explanation: str = Field(min_length=1, max_length=2_000)
    category: Literal["grammar", "spelling", "punctuation", "vocabulary", "style"]


class WritingHistoryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: str = Field(min_length=1, max_length=128)
    original_text: str = Field(min_length=1, max_length=1_000)
    corrected_text: str = Field(min_length=1, max_length=2_000)
    has_corrections: bool
    corrections: list[CorrectionPayload] = Field(max_length=100)
    general_feedback: str = Field(min_length=1, max_length=4_000)


class SegmentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=4_000)
    start: float = Field(ge=0)
    duration: float = Field(gt=0, le=3_600)


class VideoHistoryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    video_id: str = Field(min_length=1, max_length=128)
    source: Literal["youtube", "fixture"]
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(min_length=1, max_length=2_048)
    segments: list[SegmentPayload] = Field(min_length=1, max_length=20_000)


class NoteCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: str | None = Field(default=None, min_length=1, max_length=100)
    video_id: str | None = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=2_000)
    timestamp: float | None = Field(default=None, ge=0)


class NoteUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=2_000)
    timestamp: float | None = Field(default=None, ge=0)
    version: int = Field(ge=0)


class ConversationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: ScenarioType


class TurnPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: str = Field(min_length=1, max_length=128)
    user_text: str = Field(min_length=1, max_length=12_000)
    assistant_text: str = Field(min_length=1, max_length=12_000)


class FeedbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feedback: VoiceFeedback


def build_history_router(repository: StudyRepository) -> APIRouter:
    router = APIRouter(prefix="/api/history", tags=["history"])

    @router.post("/writings", status_code=201)
    async def create_writing(request: Request, payload: WritingHistoryPayload) -> dict[str, Any]:
        return repository.create_writing(_identity(request).user_id, payload.model_dump())

    @router.get("/writings")
    async def list_writings(
        request: Request, limit: int = Query(default=30, ge=1, le=100)
    ) -> dict[str, Any]:
        return {"items": repository.list_writings(_identity(request).user_id, limit)}

    @router.get("/writings/{entry_id}", response_model=None)
    async def get_writing(request: Request, entry_id: str) -> dict[str, Any] | JSONResponse:
        return _not_found(repository.get_writing, _identity(request).user_id, entry_id)

    @router.delete(
        "/writings/{entry_id}", status_code=204, response_class=Response, response_model=None
    )
    async def delete_writing(request: Request, entry_id: str) -> Response | JSONResponse:
        return _delete(repository.delete_writing, _identity(request).user_id, entry_id)

    @router.post("/videos", status_code=201)
    async def save_video(request: Request, payload: VideoHistoryPayload) -> dict[str, Any]:
        return repository.save_video(_identity(request).user_id, payload.model_dump())

    @router.get("/videos")
    async def list_videos(
        request: Request, limit: int = Query(default=30, ge=1, le=100)
    ) -> dict[str, Any]:
        return {"items": repository.list_videos(_identity(request).user_id, limit)}

    @router.get("/videos/{video_id}", response_model=None)
    async def get_video(request: Request, video_id: str) -> dict[str, Any] | JSONResponse:
        return _not_found(repository.get_video, _identity(request).user_id, video_id)

    @router.delete(
        "/videos/{video_id}", status_code=204, response_class=Response, response_model=None
    )
    async def delete_video(request: Request, video_id: str) -> Response | JSONResponse:
        return _delete(repository.delete_video, _identity(request).user_id, video_id)

    @router.post("/notes", status_code=201, response_model=None)
    async def create_note(
        request: Request, payload: NoteCreatePayload
    ) -> dict[str, Any] | JSONResponse:
        try:
            return repository.create_note(_identity(request).user_id, payload.model_dump())
        except StudyNotFoundError:
            return _missing()

    @router.get("/notes")
    async def list_notes(
        request: Request,
        video_id: str | None = None,
        limit: int = Query(default=100, ge=1, le=100),
    ) -> dict[str, Any]:
        return {
            "items": repository.list_notes(_identity(request).user_id, limit, video_id)
        }

    @router.put("/notes/{note_id}", response_model=None)
    async def update_note(
        request: Request, note_id: str, payload: NoteUpdatePayload
    ) -> dict[str, Any] | JSONResponse:
        try:
            return repository.update_note(_identity(request).user_id, note_id, payload.model_dump())
        except StudyNotFoundError:
            return _missing()
        except NoteConflictError as error:
            return JSONResponse(
                status_code=409,
                content={
                    "error": {
                        "code": "note_conflict",
                        "message": "La nota cambió en otra sesión. Conservamos ambas versiones.",
                        "retryable": False,
                    },
                    "current": error.current,
                },
            )

    @router.delete(
        "/notes/{note_id}", status_code=204, response_class=Response, response_model=None
    )
    async def delete_note(request: Request, note_id: str) -> Response | JSONResponse:
        return _delete(repository.delete_note, _identity(request).user_id, note_id)

    @router.post("/conversations", status_code=201)
    async def create_conversation(
        request: Request, payload: ConversationPayload
    ) -> dict[str, Any]:
        return repository.create_conversation(_identity(request).user_id, payload.scenario)

    @router.get("/conversations")
    async def list_conversations(
        request: Request, limit: int = Query(default=30, ge=1, le=100)
    ) -> dict[str, Any]:
        return {"items": repository.list_conversations(_identity(request).user_id, limit)}

    @router.get("/conversations/{conversation_id}", response_model=None)
    async def get_conversation(
        request: Request, conversation_id: str
    ) -> dict[str, Any] | JSONResponse:
        return _not_found(
            repository.get_conversation, _identity(request).user_id, conversation_id
        )

    @router.post(
        "/conversations/{conversation_id}/turns", status_code=201, response_model=None
    )
    async def create_turn(
        request: Request, conversation_id: str, payload: TurnPayload
    ) -> dict[str, Any] | JSONResponse:
        try:
            return repository.add_turn(
                _identity(request).user_id, conversation_id, payload.model_dump()
            )
        except StudyNotFoundError:
            return _missing()

    @router.patch("/turns/{turn_id}/feedback", response_model=None)
    async def update_feedback(
        request: Request, turn_id: str, payload: FeedbackPayload
    ) -> dict[str, Any] | JSONResponse:
        try:
            return repository.update_feedback(
                _identity(request).user_id, turn_id, payload.feedback.model_dump()
            )
        except StudyNotFoundError:
            return _missing()

    @router.delete(
        "/conversations/{conversation_id}",
        status_code=204,
        response_class=Response,
        response_model=None,
    )
    async def delete_conversation(
        request: Request, conversation_id: str
    ) -> Response | JSONResponse:
        return _delete(
            repository.delete_conversation, _identity(request).user_id, conversation_id
        )

    return router


def _identity(request: Request) -> AuthIdentity:
    identity = getattr(request.state, "auth_identity", None)
    if not isinstance(identity, AuthIdentity):
        raise RuntimeError("Protected endpoint reached without authenticated state.")
    return identity


def _not_found(
    function: Callable[[str, str], dict[str, Any]],
    user_id: str,
    item_id: str,
) -> dict[str, Any] | JSONResponse:
    try:
        return function(user_id, item_id)
    except StudyNotFoundError:
        return _missing()


def _delete(
    function: Callable[[str, str], None], user_id: str, item_id: str
) -> Response | JSONResponse:
    try:
        function(user_id, item_id)
    except StudyNotFoundError:
        return _missing()
    return Response(status_code=204)


def _missing() -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={
            "error": {
                "code": "not_found",
                "message": "No se encontró este elemento.",
                "retryable": False,
            }
        },
    )
