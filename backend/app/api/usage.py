"""Public product contract and authenticated account quota."""

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.auth import AuthIdentity
from app.core.product import ProductConfig
from app.persistence.usage import (
    QuotaExhaustedError,
    UsageAccessExpiredError,
    UsageOperationInProgressError,
    UsageOperationReleasedError,
    UsageOperationUncertainError,
    UsageRepository,
)


def build_usage_router(config: ProductConfig, usage: UsageRepository) -> APIRouter:
    router = APIRouter(tags=["usage"])

    @router.get("/api/plan")
    async def public_plan() -> dict[str, Any]:
        return config.model_dump(mode="json")

    @router.get("/api/account/quota")
    async def account_quota(request: Request) -> Any:
        identity = getattr(request.state, "auth_identity", None)
        if not isinstance(identity, AuthIdentity):
            raise RuntimeError("Protected endpoint reached without authenticated state.")
        try:
            return usage.quota(identity.user_id)
        except UsageAccessExpiredError as error:
            status_code, content = quota_error_response(error)
            return JSONResponse(status_code=status_code, content=content)

    return router


def quota_error_response(error: Exception) -> tuple[int, dict[str, Any]]:
    if isinstance(error, QuotaExhaustedError):
        return 402, {
            "error": {
                "code": "quota_exhausted",
                "message": "Ya usaste el saldo disponible de este recurso.",
                "retryable": False,
            },
            "quota": error.snapshot,
        }
    if isinstance(error, UsageAccessExpiredError):
        return 403, {
            "error": {
                "code": "access_expired",
                "message": "Tu periodo de acceso terminó. Tu historial sigue disponible.",
                "retryable": False,
            }
        }
    if isinstance(error, UsageOperationInProgressError):
        return 409, {
            "error": {
                "code": "operation_in_progress",
                "message": "Esta operación todavía está en curso.",
                "retryable": True,
            }
        }
    if isinstance(error, UsageOperationUncertainError):
        return 409, {
            "error": {
                "code": "operation_uncertain",
                "message": "La operación necesita conciliación antes de repetirse.",
                "retryable": False,
            }
        }
    if isinstance(error, UsageOperationReleasedError):
        return 409, {
            "error": {
                "code": "operation_released",
                "message": "Este intento terminó sin consumir saldo. Inicia uno nuevo.",
                "retryable": True,
            }
        }
    raise error
