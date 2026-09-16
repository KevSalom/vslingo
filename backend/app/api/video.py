"""Typed HTTP contract for Video Lab transcripts."""

from enum import StrEnum
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.api.usage import quota_error_response
from app.core.auth import AuthIdentity
from app.core.protection import ProviderBusyError
from app.domain.video import (
    MAX_VIDEO_URL_LENGTH,
    TranscriptResult,
    VideoInputError,
    VideoProviderError,
    VideoProviderErrorCode,
    extract_youtube_video_id,
)
from app.persistence.usage import (
    QuotaExhaustedError,
    UsageAccessExpiredError,
    UsageOperationInProgressError,
    UsageOperationReleasedError,
    UsageOperationUncertainError,
    UsageRepository,
)
from app.services.video import VideoService


class TranscriptRequest(BaseModel):
    """YouTube URL submitted for transcript discovery."""

    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, max_length=MAX_VIDEO_URL_LENGTH)
    operation_id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=128)


class VideoPublicErrorCode(StrEnum):
    """Stable Video Lab error codes consumed by the frontend."""

    INVALID_URL = "invalid_url"
    CAPTIONS_UNAVAILABLE = "captions_unavailable"
    PROVIDER_BLOCKED = "provider_blocked"
    PROVIDER_TIMEOUT = "provider_timeout"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    PROVIDER_BUSY = "provider_busy"
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


def build_video_router(service: VideoService, usage: UsageRepository) -> APIRouter:
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
        request: Request,
        payload: TranscriptRequest,
    ) -> TranscriptResult | JSONResponse:
        """Return navigable English captions and expose only safe failures."""

        identity = getattr(request.state, "auth_identity", None)
        if not isinstance(identity, AuthIdentity):
            raise RuntimeError("Protected endpoint reached without authenticated state.")
        try:
            video_id = extract_youtube_video_id(payload.url)
            reservation = usage.reserve(
                identity.user_id,
                payload.operation_id,
                "video",
                resource_key=video_id,
            )
            if reservation.result is not None:
                return TranscriptResult.model_validate(reservation.result)
            usage.mark_provider_started(identity.user_id, payload.operation_id)
            result = await service.transcript(payload.url)
            usage.persist_result(
                identity.user_id,
                payload.operation_id,
                result.model_dump(mode="json"),
                actual_primary=1,
            )
            usage.settle(identity.user_id, payload.operation_id)
            return result
        except (
            QuotaExhaustedError,
            UsageOperationInProgressError,
            UsageOperationReleasedError,
            UsageOperationUncertainError,
            UsageAccessExpiredError,
        ) as exc:
            status_code, content = quota_error_response(exc)
            return JSONResponse(status_code=status_code, content=content)
        except VideoInputError:
            return video_error_response(
                422,
                VideoErrorDetail(
                    code=VideoPublicErrorCode.INVALID_URL,
                    message="Introduce una URL válida de YouTube.",
                    retryable=False,
                ),
            )
        except ProviderBusyError:
            usage.release(identity.user_id, payload.operation_id)
            return video_error_response(
                503,
                VideoErrorDetail(
                    code=VideoPublicErrorCode.PROVIDER_BUSY,
                    message=(
                        "El proveedor de transcripciones está ocupado. "
                        "Inténtalo de nuevo pronto."
                    ),
                    retryable=True,
                ),
            )
        except VideoProviderError as exc:
            usage.release(identity.user_id, payload.operation_id)
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
