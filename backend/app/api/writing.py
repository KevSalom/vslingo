"""Typed HTTP contract for Writing Studio."""

from enum import StrEnum

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.writing import (
    MAX_CORRECTION_TEXT_LENGTH,
    CorrectionResult,
    WritingInputError,
    WritingInputErrorCode,
)
from app.services.correction import CorrectionService


class CorrectionRequest(BaseModel):
    """Text submitted for one English correction."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(description="English sentence or short paragraph to correct.")


class WritingPublicErrorCode(StrEnum):
    """Stable error codes consumed by the Writing Studio UI."""

    EMPTY_TEXT = "empty_text"
    TEXT_TOO_LONG = "text_too_long"
    PROVIDER_NOT_CONFIGURED = "provider_not_configured"
    PROVIDER_TIMEOUT = "provider_timeout"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    INVALID_PROVIDER_RESPONSE = "invalid_provider_response"
    INVALID_REQUEST = "invalid_request"


class ErrorDetail(BaseModel):
    """Safe and actionable public error information."""

    code: WritingPublicErrorCode
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    """Normalized error envelope returned by the Writing endpoint."""

    error: ErrorDetail


ErrorMapping = tuple[int, WritingPublicErrorCode, str, bool]

_INTEGRATION_ERRORS: dict[IntegrationErrorCode, ErrorMapping] = {
    IntegrationErrorCode.NOT_CONFIGURED: (
        503,
        WritingPublicErrorCode.PROVIDER_NOT_CONFIGURED,
        "Writing Studio todavía no tiene un proveedor configurado.",
        False,
    ),
    IntegrationErrorCode.TIMEOUT: (
        504,
        WritingPublicErrorCode.PROVIDER_TIMEOUT,
        "La corrección tardó demasiado. Inténtalo de nuevo.",
        True,
    ),
    IntegrationErrorCode.UNAVAILABLE: (
        503,
        WritingPublicErrorCode.PROVIDER_UNAVAILABLE,
        "El proveedor de corrección no está disponible. Inténtalo de nuevo.",
        True,
    ),
    IntegrationErrorCode.INVALID_RESPONSE: (
        502,
        WritingPublicErrorCode.INVALID_PROVIDER_RESPONSE,
        "El proveedor devolvió una corrección inválida. Inténtalo de nuevo.",
        True,
    ),
    IntegrationErrorCode.INVALID_REQUEST: (
        400,
        WritingPublicErrorCode.INVALID_REQUEST,
        "El proveedor rechazó la solicitud de corrección.",
        False,
    ),
}


def build_writing_router(service: CorrectionService) -> APIRouter:
    """Build an isolated Writing router with an explicit service dependency."""

    router = APIRouter(prefix="/api/writing", tags=["writing"])

    @router.post(
        "/correct",
        response_model=CorrectionResult,
        responses={
            400: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            502: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
            504: {"model": ErrorResponse},
        },
    )
    async def correct_writing(
        request: CorrectionRequest,
    ) -> CorrectionResult | JSONResponse:
        """Correct one English text and expose only normalized failures."""

        try:
            return await service.correct(request.text)
        except WritingInputError as exc:
            return _input_error_response(exc.code)
        except IntegrationError as exc:
            return _integration_error_response(exc.code)

    return router


def _input_error_response(code: WritingInputErrorCode) -> JSONResponse:
    if code is WritingInputErrorCode.EMPTY_TEXT:
        detail = ErrorDetail(
            code=WritingPublicErrorCode.EMPTY_TEXT,
            message="Escribe un texto en inglés antes de solicitar la corrección.",
            retryable=False,
        )
    else:
        detail = ErrorDetail(
            code=WritingPublicErrorCode.TEXT_TOO_LONG,
            message=f"El texto no puede superar {MAX_CORRECTION_TEXT_LENGTH} caracteres.",
            retryable=False,
        )
    return _error_response(422, detail)


def _integration_error_response(code: IntegrationErrorCode) -> JSONResponse:
    status_code, public_code, message, retryable = _INTEGRATION_ERRORS[code]
    return _error_response(
        status_code,
        ErrorDetail(code=public_code, message=message, retryable=retryable),
    )


def _error_response(status_code: int, detail: ErrorDetail) -> JSONResponse:
    payload = ErrorResponse(error=detail).model_dump(mode="json")
    return JSONResponse(status_code=status_code, content=payload)


async def handle_request_validation_error(
    request: Request,
    error: Exception,
) -> JSONResponse:
    """Normalize malformed Writing requests to the public error contract."""

    del request, error
    return _error_response(
        422,
        ErrorDetail(
            code=WritingPublicErrorCode.INVALID_REQUEST,
            message="La solicitud de corrección no es válida.",
            retryable=False,
        ),
    )
