"""Strict, content-free normalization of PayPal subscription webhook events."""

from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from app.billing.gateway import ProviderSubscriptionStatus

SUPPORTED_EVENT_TYPES = frozenset(
    {
        "PAYMENT.SALE.COMPLETED",
        "PAYMENT.SALE.REFUNDED",
        "PAYMENT.SALE.REVERSED",
        "BILLING.SUBSCRIPTION.CREATED",
        "BILLING.SUBSCRIPTION.ACTIVATED",
        "BILLING.SUBSCRIPTION.UPDATED",
        "BILLING.SUBSCRIPTION.EXPIRED",
        "BILLING.SUBSCRIPTION.CANCELLED",
        "BILLING.SUBSCRIPTION.SUSPENDED",
        "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
    }
)

_SUBSCRIPTION_STATUS: dict[str, ProviderSubscriptionStatus] = {
    "BILLING.SUBSCRIPTION.CREATED": "approval_pending",
    "BILLING.SUBSCRIPTION.ACTIVATED": "active",
    "BILLING.SUBSCRIPTION.EXPIRED": "expired",
    "BILLING.SUBSCRIPTION.CANCELLED": "cancelled",
    "BILLING.SUBSCRIPTION.SUSPENDED": "suspended",
    "BILLING.SUBSCRIPTION.PAYMENT.FAILED": "suspended",
}


class BillingEventError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class BillingEvent:
    event_id: str
    event_type: str
    occurred_at: str
    provider_subscription_id: str | None = None
    provider_transaction_id: str | None = None
    parent_transaction_id: str | None = None
    plan_id: str | None = None
    merchant_id: str | None = None
    amount_minor: int | None = None
    currency: str | None = None
    subscription_status: ProviderSubscriptionStatus | None = None

    def as_minimal_dict(self) -> dict[str, Any]:
        return {key: value for key, value in asdict(self).items() if value is not None}


def normalize_paypal_event(payload: dict[str, Any]) -> BillingEvent:
    event_id = _required_string(payload, "id", max_length=128)
    event_type = _required_string(payload, "event_type", max_length=128)
    occurred_at = _required_string(payload, "create_time", max_length=64)
    resource = payload.get("resource")
    if not isinstance(resource, dict):
        raise BillingEventError("invalid_resource")
    resource = dict(resource)

    if event_type not in SUPPORTED_EVENT_TYPES:
        return BillingEvent(event_id, event_type, occurred_at)

    if event_type.startswith("BILLING.SUBSCRIPTION."):
        provider_subscription_id = _required_string(resource, "id", max_length=128)
        status = _subscription_status(event_type, resource.get("status"))
        return BillingEvent(
            event_id=event_id,
            event_type=event_type,
            occurred_at=occurred_at,
            provider_subscription_id=provider_subscription_id,
            plan_id=_optional_string(resource.get("plan_id"), max_length=128),
            merchant_id=_merchant_id(resource),
            subscription_status=status,
        )

    if event_type == "PAYMENT.SALE.COMPLETED":
        amount_minor, currency = _money(resource.get("amount"))
        return BillingEvent(
            event_id=event_id,
            event_type=event_type,
            occurred_at=occurred_at,
            provider_subscription_id=_required_string(
                resource, "billing_agreement_id", max_length=128
            ),
            provider_transaction_id=_required_string(resource, "id", max_length=128),
            merchant_id=_merchant_id(resource),
            amount_minor=amount_minor,
            currency=currency,
        )

    amount_minor, currency = _money(resource.get("amount"))
    parent_transaction_id = _first_string(
        resource.get("sale_id"),
        _nested(resource, "links", "sale_id"),
        _nested(resource, "supplementary_data", "related_ids", "sale_id"),
        resource.get("parent_payment"),
    )
    if parent_transaction_id is None:
        raise BillingEventError("missing_parent_transaction")
    return BillingEvent(
        event_id=event_id,
        event_type=event_type,
        occurred_at=occurred_at,
        provider_subscription_id=_optional_string(
            resource.get("billing_agreement_id"), max_length=128
        ),
        provider_transaction_id=_required_string(resource, "id", max_length=128),
        parent_transaction_id=parent_transaction_id,
        merchant_id=_merchant_id(resource),
        amount_minor=amount_minor,
        currency=currency,
    )


def _subscription_status(
    event_type: str, raw_status: object
) -> ProviderSubscriptionStatus:
    if event_type == "BILLING.SUBSCRIPTION.UPDATED":
        if not isinstance(raw_status, str):
            raise BillingEventError("missing_subscription_status")
        normalized = raw_status.lower()
        if normalized not in {
            "approval_pending",
            "approved",
            "active",
            "suspended",
            "cancelled",
            "expired",
        }:
            raise BillingEventError("invalid_subscription_status")
        return normalized  # type: ignore[return-value]
    return _SUBSCRIPTION_STATUS[event_type]


def _money(raw: object) -> tuple[int, str]:
    if not isinstance(raw, dict):
        raise BillingEventError("invalid_amount")
    value = raw.get("total", raw.get("value"))
    currency = raw.get("currency", raw.get("currency_code"))
    if not isinstance(value, str) or not isinstance(currency, str):
        raise BillingEventError("invalid_amount")
    try:
        decimal = Decimal(value)
    except InvalidOperation as exc:
        raise BillingEventError("invalid_amount") from exc
    minor = decimal * 100
    if decimal <= 0 or minor != minor.to_integral_value():
        raise BillingEventError("invalid_amount")
    return int(minor), currency.upper()


def _merchant_id(resource: dict[str, Any]) -> str | None:
    return _first_string(
        _nested(resource, "payee", "merchant_id"),
        _nested(resource, "payee", "email_address"),
        resource.get("merchant_id"),
    )


def _required_string(
    mapping: dict[str, Any], key: str, *, max_length: int
) -> str:
    value = _optional_string(mapping.get(key), max_length=max_length)
    if value is None:
        raise BillingEventError(f"missing_{key}")
    return value


def _optional_string(value: object, *, max_length: int) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    if not stripped or len(stripped) > max_length:
        return None
    return stripped


def _first_string(*values: object) -> str | None:
    for value in values:
        normalized = _optional_string(value, max_length=128)
        if normalized is not None:
            return normalized
    return None


def _nested(mapping: dict[str, Any], *keys: str) -> object:
    current: object = mapping
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current
