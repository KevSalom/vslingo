"""PayPal Subscriptions v1 adapter for explicitly configured sandbox or live use."""

from collections.abc import Mapping
from typing import Any, cast

import httpx

from app.billing.gateway import (
    BillingGatewayError,
    CheckoutSession,
    ProviderEnvironment,
    ProviderSubscription,
    ProviderSubscriptionStatus,
    ProviderTransaction,
)
from app.core.config import Settings

_STATUS_MAP: dict[str, ProviderSubscriptionStatus] = {
    "APPROVAL_PENDING": "approval_pending",
    "APPROVED": "approved",
    "ACTIVE": "active",
    "SUSPENDED": "suspended",
    "CANCELLED": "cancelled",
    "EXPIRED": "expired",
}


class PayPalBillingGateway:
    def __init__(self, settings: Settings) -> None:
        if settings.billing_mode not in {"paypal_sandbox", "paypal_live"}:
            raise ValueError("PayPal gateway requires an explicit PayPal billing mode.")
        if not settings.paypal_configured:
            raise ValueError("PayPal gateway is not completely configured.")
        self.environment: ProviderEnvironment = (
            "sandbox" if settings.billing_mode == "paypal_sandbox" else "live"
        )
        self._base_url = (
            "https://api-m.sandbox.paypal.com"
            if self.environment == "sandbox"
            else "https://api-m.paypal.com"
        )
        assert settings.paypal_client_id is not None
        assert settings.paypal_client_secret is not None
        assert settings.paypal_webhook_id is not None
        self._client_id = settings.paypal_client_id.get_secret_value().strip()
        self._client_secret = settings.paypal_client_secret.get_secret_value().strip()
        self._webhook_id = settings.paypal_webhook_id.strip()
        self._timeout = settings.provider_timeout_seconds

    async def create_subscription(
        self,
        *,
        request_id: str,
        custom_id: str,
        plan_id: str,
        return_url: str,
        cancel_url: str,
    ) -> CheckoutSession:
        payload = {
            "plan_id": plan_id,
            "custom_id": custom_id,
            "application_context": {
                "user_action": "SUBSCRIBE_NOW",
                "return_url": return_url,
                "cancel_url": cancel_url,
            },
        }
        response = await self._request(
            "POST",
            "/v1/billing/subscriptions",
            request_id=request_id,
            json=payload,
        )
        data = _json_object(response)
        provider_id = data.get("id")
        links = data.get("links")
        approval_url = None
        if isinstance(links, list):
            for link in links:
                if isinstance(link, dict) and link.get("rel") == "approve":
                    approval_url = link.get("href")
                    break
        if not isinstance(provider_id, str) or not isinstance(approval_url, str):
            raise BillingGatewayError("PayPal returned an incomplete subscription.", uncertain=True)
        return CheckoutSession(provider_id, approval_url, _status(data.get("status")))

    async def cancel_subscription(
        self, provider_subscription_id: str, *, request_id: str
    ) -> None:
        await self._request(
            "POST",
            f"/v1/billing/subscriptions/{provider_subscription_id}/cancel",
            request_id=request_id,
            json={"reason": "El usuario desactivó la renovación desde Inglés al Grano."},
        )

    async def get_subscription(
        self, provider_subscription_id: str
    ) -> ProviderSubscription:
        response = await self._request(
            "GET", f"/v1/billing/subscriptions/{provider_subscription_id}"
        )
        data = _json_object(response)
        billing_info = data.get("billing_info")
        next_billing_time = (
            billing_info.get("next_billing_time")
            if isinstance(billing_info, dict)
            else None
        )
        return ProviderSubscription(
            provider_subscription_id=provider_subscription_id,
            status=_status(data.get("status")),
            next_billing_time=(
                next_billing_time if isinstance(next_billing_time, str) else None
            ),
        )

    async def verify_webhook(
        self,
        headers: Mapping[str, str],
        event: dict[str, Any],
    ) -> bool:
        required = {
            "auth_algo": headers.get("paypal-auth-algo"),
            "cert_url": headers.get("paypal-cert-url"),
            "transmission_id": headers.get("paypal-transmission-id"),
            "transmission_sig": headers.get("paypal-transmission-sig"),
            "transmission_time": headers.get("paypal-transmission-time"),
        }
        if any(not value for value in required.values()):
            return False
        response = await self._request(
            "POST",
            "/v1/notifications/verify-webhook-signature",
            json={**required, "webhook_id": self._webhook_id, "webhook_event": event},
        )
        data = _json_object(response)
        return data.get("verification_status") == "SUCCESS"

    async def list_transactions(
        self,
        provider_subscription_id: str,
        *,
        start_time: str,
        end_time: str,
    ) -> tuple[ProviderTransaction, ...]:
        response = await self._request(
            "GET",
            f"/v1/billing/subscriptions/{provider_subscription_id}/transactions",
            params={"start_time": start_time, "end_time": end_time},
        )
        data = _json_object(response)
        raw_transactions = data.get("transactions")
        if not isinstance(raw_transactions, list):
            raise BillingGatewayError("PayPal returned invalid transactions.", uncertain=True)
        transactions: list[ProviderTransaction] = []
        for raw in raw_transactions:
            if not isinstance(raw, dict) or raw.get("status") != "COMPLETED":
                continue
            transaction_id = raw.get("id")
            occurred_at = raw.get("time")
            gross = raw.get("amount_with_breakdown")
            gross_amount = gross.get("gross_amount") if isinstance(gross, dict) else None
            if (
                not isinstance(transaction_id, str)
                or not isinstance(occurred_at, str)
                or not isinstance(gross_amount, dict)
            ):
                raise BillingGatewayError(
                    "PayPal returned an incomplete transaction.", uncertain=True
                )
            value = gross_amount.get("value")
            currency = gross_amount.get("currency_code")
            transactions.append(
                ProviderTransaction(
                    transaction_id,
                    occurred_at,
                    _minor_units(value),
                    currency if isinstance(currency, str) else "",
                )
            )
        return tuple(transactions)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        request_id: str | None = None,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> httpx.Response:
        token = await self._access_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        if request_id is not None:
            headers["PayPal-Request-Id"] = request_id
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.request(
                    method,
                    f"{self._base_url}{path}",
                    headers=headers,
                    json=json,
                    params=params,
                )
                response.raise_for_status()
                return response
        except httpx.TimeoutException as exc:
            raise BillingGatewayError("PayPal timed out.", uncertain=True) from exc
        except httpx.HTTPStatusError as exc:
            raise BillingGatewayError(
                "PayPal rejected the billing request.",
                uncertain=exc.response.status_code >= 500,
            ) from exc
        except httpx.HTTPError as exc:
            raise BillingGatewayError("PayPal is unavailable.", uncertain=True) from exc

    async def _access_token(self) -> str:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    f"{self._base_url}/v1/oauth2/token",
                    auth=(self._client_id, self._client_secret),
                    headers={"Accept": "application/json"},
                    data={"grant_type": "client_credentials"},
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise BillingGatewayError("PayPal authentication failed.", uncertain=False) from exc
        data = _json_object(response)
        token = data.get("access_token")
        if not isinstance(token, str) or not token:
            raise BillingGatewayError("PayPal returned no access token.", uncertain=False)
        return token


def _json_object(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise BillingGatewayError("PayPal returned invalid JSON.", uncertain=True) from exc
    if not isinstance(payload, dict):
        raise BillingGatewayError("PayPal returned an invalid envelope.", uncertain=True)
    return cast(dict[str, Any], payload)


def _status(value: object) -> ProviderSubscriptionStatus:
    if isinstance(value, str) and value in _STATUS_MAP:
        return _STATUS_MAP[value]
    raise BillingGatewayError("PayPal returned an unknown subscription status.", uncertain=True)


def _minor_units(value: object) -> int:
    from decimal import Decimal, InvalidOperation

    if not isinstance(value, str):
        raise BillingGatewayError("PayPal returned an invalid amount.", uncertain=True)
    try:
        minor = Decimal(value) * 100
    except InvalidOperation as exc:
        raise BillingGatewayError("PayPal returned an invalid amount.", uncertain=True) from exc
    if minor <= 0 or minor != minor.to_integral_value():
        raise BillingGatewayError("PayPal returned an invalid amount.", uncertain=True)
    return int(minor)


def build_billing_gateway(settings: Settings) -> PayPalBillingGateway:
    return PayPalBillingGateway(settings)
