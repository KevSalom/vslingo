"""Typed HTTP contract for Video Lab transcripts."""

from enum import StrEnum

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.domain.video import (
    MAX_VIDEO_URL_LENGTH,
    TranscriptResult,
    VideoInputError,
    VideoProviderError,
    VideoProviderErrorCode,
)
from app.services.video import VideoService


class TranscriptRequest(BaseModel):
    """YouTube URL submitted for transcript discovery."""

    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, max_length=MAX_VIDEO_URL_LENGTH)


class VideoPublicErrorCode(StrEnum):
    """Stable Video Lab error codes consumed by the frontend."""

    INVALID_URL = "invalid_url"
    CAPTIONS_UNAVAILABLE = "captions_unavailable"
    PROVIDER_BLOCKED = "provider_blocked"
    PROVIDER_TIMEOUT = "provider_timeout"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    INVALID_PROVIDER_RESPONSE = "invalid_provider_response"
    INVALID_REQUEST = "invalid_request"


class VideoErrorDetail(BaseModel):
    """Safe public Video Lab error information."""

    code: VideoPublicErrorCode
    message: str
    retryable: bool


class VideoErrorResponse(BaseModel):
    """Normalized error envelope returned by the Video endpoint."""

    error: VideoErrorDetail


ErrorMapping = tuple[int, VideoPublicErrorCode, str, bool]

_PROVIDER_ERRORS: dict[VideoProviderErrorCode, ErrorMapping] = {
    VideoProviderErrorCode.CAPTIONS_UNAVAILABLE: (
        404,
        VideoPublicErrorCode.CAPTIONS_UNAVAILABLE,
        "Este video no ofrece subtítulos en inglés ni traducibles.",
        False,
    ),
    VideoProviderErrorCode.PROVIDER_BLOCKED: (
        503,
        VideoPublicErrorCode.PROVIDER_BLOCKED,
        "YouTube bloqueó temporalmente la solicitud. Usa la demo técnica incorporada.",
        False,
    ),
    VideoProviderErrorCode.TIMEOUT: (
        504,
        VideoPublicErrorCode.PROVIDER_TIMEOUT,
        "La transcripción tardó demasiado. Inténtalo de nuevo.",
        True,
    ),
    VideoProviderErrorCode.UNAVAILABLE: (
        503,
        VideoPublicErrorCode.PROVIDER_UNAVAILABLE,
        "YouTube no está disponible. Inténtalo de nuevo o usa la demo técnica.",
        True,
    ),
    VideoProviderErrorCode.INVALID_RESPONSE: (
        502,
        VideoPublicErrorCode.INVALID_PROVIDER_RESPONSE,
        "YouTube devolvió una transcripción que no se puede mostrar.",
        True,
    ),
}


def build_video_router(service: VideoService) -> APIRouter:
    """Build an isolated Video router with an explicit service dependency."""

    router = APIRouter(prefix="/api/video", tags=["video"])

    @router.post(
        "/transcript",
        response_model=TranscriptResult,
        responses={
            404: {"model": VideoErrorResponse},
            422: {"model": VideoErrorResponse},
            502: {"model": VideoErrorResponse},
            503: {"model": VideoErrorResponse},
            504: {"model": VideoErrorResponse},
        },
    )
    async def get_transcript(
        request: TranscriptRequest,
    ) -> TranscriptResult | JSONResponse:
        """Return navigable English captions and expose only safe failures."""

        try:
            return await service.transcript(request.url)
        except VideoInputError:
            return video_error_response(
                422,
                VideoErrorDetail(
                    code=VideoPublicErrorCode.INVALID_URL,
                    message="Introduce una URL válida de YouTube.",
                    retryable=False,
                ),
            )
        except VideoProviderError as exc:
            status_code, public_code, message, retryable = _PROVIDER_ERRORS[exc.code]
            return video_error_response(
                status_code,
                VideoErrorDetail(
                    code=public_code,
                    message=message,
                    retryable=retryable,
                ),
            )

    return router


def video_validation_error_response() -> JSONResponse:
    """Normalize malformed Video requests to the Video error contract."""

    return video_error_response(
        422,
        VideoErrorDetail(
            code=VideoPublicErrorCode.INVALID_REQUEST,
            message="La solicitud de transcripción no es válida.",
            retryable=False,
        ),
    )


def video_error_response(status_code: int, detail: VideoErrorDetail) -> JSONResponse:
    payload = VideoErrorResponse(error=detail).model_dump(mode="json")
    return JSONResponse(status_code=status_code, content=payload)
