"""Authenticated billing actions and the public, signature-verified PayPal webhook."""

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.billing.events import BillingEventError
from app.billing.gateway import BillingGatewayError
from app.core.auth import AuthIdentity
from app.persistence.billing import (
    AlreadySubscribedError,
    BillingEventRejectedError,
    BillingNotFoundError,
)
from app.services.billing import BillingService, InvalidWebhookSignatureError

MAX_WEBHOOK_BYTES = 256_000


def build_billing_router(service: BillingService) -> APIRouter:
    router = APIRouter(tags=["billing"])

    @router.get("/api/account/billing")
    async def account_billing(request: Request) -> dict[str, Any]:
        return service.account(_identity(request).user_id)

    @router.post("/api/billing/checkout")
    async def start_checkout(request: Request) -> Any:
        try:
            attempt = await service.start_checkout(_identity(request).user_id)
        except AlreadySubscribedError:
            return _error(
                409,
                "subscription_exists",
                "Ya tienes una suscripción que puede renovarse.",
            )
        except BillingGatewayError as error:
            return _error(
                503,
                "billing_provider_unavailable",
                "No pudimos iniciar el pago. Inténtalo de nuevo en unos minutos.",
                retryable=error.uncertain,
            )
        return {
            "attempt_id": attempt.id,
            "status": attempt.status,
            "approval_url": attempt.approval_url,
        }

    @router.post("/api/billing/cancel")
    async def cancel_subscription(request: Request) -> Any:
        try:
            return await service.cancel(_identity(request).user_id)
        except BillingNotFoundError:
            return _error(
                409,
                "subscription_not_cancellable",
                "No hay una renovación activa para cancelar.",
            )
        except BillingGatewayError:
            return _error(
                503,
                "billing_provider_unavailable",
                "No pudimos confirmar la cancelación. Tu renovación sigue activa.",
                retryable=True,
            )

    @router.post("/api/billing/webhooks/paypal")
    async def paypal_webhook(request: Request) -> Any:
        raw = await request.body()
        if len(raw) > MAX_WEBHOOK_BYTES:
            return _error(413, "webhook_too_large", "El evento excede el tamaño permitido.")
        try:
            decoded = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return _error(400, "invalid_webhook", "El evento no contiene JSON válido.")
        if not isinstance(decoded, dict):
            return _error(400, "invalid_webhook", "El evento no es un objeto JSON.")
        payload = dict(decoded)
        try:
            result = await service.process_webhook(dict(request.headers), payload)
        except InvalidWebhookSignatureError:
            return _error(401, "invalid_webhook_signature", "La firma no es válida.")
        except BillingEventError as error:
            return _error(400, error.code, "El evento no tiene el formato esperado.")
        except BillingEventRejectedError as error:
            return {"event_id": payload.get("id"), "status": "rejected", "code": error.code}
        except BillingGatewayError:
            return _error(
                503,
                "webhook_verification_unavailable",
                "No fue posible verificar el evento.",
                retryable=True,
            )
        return {
            "event_id": result.event_id,
            "status": result.status,
            "duplicate": result.duplicate,
        }

    return router


def _identity(request: Request) -> AuthIdentity:
    identity = getattr(request.state, "auth_identity", None)
    if not isinstance(identity, AuthIdentity):
        raise RuntimeError("Protected endpoint reached without authenticated state.")
    return identity


def _error(
    status_code: int,
    code: str,
    message: str,
    *,
    retryable: bool = False,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {"code": code, "message": message, "retryable": retryable}
        },
    )
