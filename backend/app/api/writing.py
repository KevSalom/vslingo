"""Typed HTTP contract for Writing Studio."""

from enum import StrEnum
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.api.usage import quota_error_response
from app.core.auth import AuthIdentity
from app.core.protection import ProviderBusyError
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.writing import (
    MAX_CORRECTION_TEXT_LENGTH,
    CorrectionResult,
    WritingInputError,
    WritingInputErrorCode,
)
from app.persistence.usage import (
    QuotaExhaustedError,
    UsageAccessExpiredError,
    UsageOperationInProgressError,
    UsageOperationReleasedError,
    UsageOperationUncertainError,
    UsageRepository,
)
from app.services.correction import CorrectionService


class CorrectionRequest(BaseModel):
    """Text submitted for one English correction."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(description="English sentence or short paragraph to correct.")
    operation_id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=128)


class WritingPublicErrorCode(StrEnum):
    """Stable error codes consumed by the Writing Studio UI."""

    EMPTY_TEXT = "empty_text"
    TEXT_TOO_LONG = "text_too_long"
    PROVIDER_NOT_CONFIGURED = "provider_not_configured"
    PROVIDER_TIMEOUT = "provider_timeout"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    PROVIDER_BUSY = "provider_busy"
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


def build_writing_router(service: CorrectionService, usage: UsageRepository) -> APIRouter:
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
        request: Request,
        payload: CorrectionRequest,
    ) -> CorrectionResult | JSONResponse:
        """Correct one English text and expose only normalized failures."""

        identity = getattr(request.state, "auth_identity", None)
        if not isinstance(identity, AuthIdentity):
            raise RuntimeError("Protected endpoint reached without authenticated state.")
        try:
            reservation = usage.reserve(identity.user_id, payload.operation_id, "writing")
            if reservation.result is not None:
                return CorrectionResult.model_validate(reservation.result)
            usage.mark_provider_started(identity.user_id, payload.operation_id)
            result = await service.correct(payload.text)
            _record_provider_cost(usage, identity.user_id, payload.operation_id, service.provider)
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
        except WritingInputError as exc:
            usage.release(identity.user_id, payload.operation_id)
            return _input_error_response(exc.code)
        except ProviderBusyError:
            usage.release(identity.user_id, payload.operation_id)
            return _error_response(
                503,
                ErrorDetail(
                    code=WritingPublicErrorCode.PROVIDER_BUSY,
                    message="El proveedor de corrección está ocupado. Inténtalo de nuevo pronto.",
                    retryable=True,
                ),
            )
        except IntegrationError as exc:
            _record_provider_cost(usage, identity.user_id, payload.operation_id, service.provider)
            usage.release(identity.user_id, payload.operation_id)
            return _integration_error_response(exc.code)

    return router


def _record_provider_cost(
    usage: UsageRepository, clerk_user_id: str, operation_id: str, provider: object
) -> None:
    consume = getattr(provider, "consume_usage", None)
    provider_usage = consume() if callable(consume) else None
    cost = getattr(provider_usage, "cost_usd", None)
    if isinstance(cost, (int, float)):
        usage.add_cost_usd(clerk_user_id, operation_id, float(cost))


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
