"""Provider-neutral subscription gateway contract."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol

ProviderEnvironment = Literal["fake", "sandbox", "live"]
ProviderSubscriptionStatus = Literal[
    "approval_pending", "approved", "active", "suspended", "cancelled", "expired"
]


class BillingGatewayError(RuntimeError):
    """A safe provider failure with explicit external-side-effect uncertainty."""

    def __init__(self, message: str, *, uncertain: bool) -> None:
        super().__init__(message)
        self.uncertain = uncertain


class BillingProviderResponseError(BillingGatewayError):
    """A definitive HTTP response returned by the billing provider."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        issue_codes: frozenset[str] = frozenset(),
    ) -> None:
        super().__init__(message, uncertain=status_code >= 500)
        self.status_code = status_code
        self.issue_codes = issue_codes


@dataclass(frozen=True, slots=True)
class CheckoutSession:
    provider_subscription_id: str
    approval_url: str
    status: ProviderSubscriptionStatus = "approval_pending"


@dataclass(frozen=True, slots=True)
class ProviderSubscription:
    provider_subscription_id: str
    status: ProviderSubscriptionStatus
    plan_id: str
    next_billing_time: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderTransaction:
    provider_transaction_id: str
    occurred_at: str
    amount_minor: int
    currency: str


class BillingGateway(Protocol):
    environment: ProviderEnvironment

    async def create_subscription(
        self,
        *,
        request_id: str,
        custom_id: str,
        plan_id: str,
        return_url: str,
        cancel_url: str,
    ) -> CheckoutSession: ...

    async def cancel_subscription(
        self, provider_subscription_id: str, *, request_id: str
    ) -> None: ...

    async def get_subscription(
        self, provider_subscription_id: str
    ) -> ProviderSubscription: ...

    async def list_transactions(
        self,
        provider_subscription_id: str,
        *,
        start_time: str,
        end_time: str,
    ) -> tuple[ProviderTransaction, ...]: ...

    async def verify_webhook(
        self,
        headers: Mapping[str, str],
        event: dict[str, Any],
    ) -> bool: ...
