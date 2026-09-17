"""Deterministic billing gateway for local development and normal tests."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from app.billing.gateway import (
    CheckoutSession,
    ProviderEnvironment,
    ProviderSubscription,
    ProviderSubscriptionStatus,
    ProviderTransaction,
)


@dataclass(slots=True)
class FakeBillingGateway:
    environment: ProviderEnvironment = "fake"
    create_calls: list[str] = field(default_factory=list)
    cancel_calls: list[str] = field(default_factory=list)
    _sessions: dict[str, CheckoutSession] = field(default_factory=dict)
    _statuses: dict[str, ProviderSubscriptionStatus] = field(default_factory=dict)
    _plan_ids: dict[str, str] = field(default_factory=dict)
    _transactions: dict[str, list[ProviderTransaction]] = field(default_factory=dict)

    async def create_subscription(
        self,
        *,
        request_id: str,
        custom_id: str,
        plan_id: str,
        return_url: str,
        cancel_url: str,
    ) -> CheckoutSession:
        del custom_id, return_url, cancel_url
        self.create_calls.append(request_id)
        existing = self._sessions.get(request_id)
        if existing is not None:
            return existing
        provider_id = f"I-FAKE-{request_id[:12]}"
        session = CheckoutSession(
            provider_subscription_id=provider_id,
            approval_url=f"https://sandbox.paypal.test/approve/{provider_id}",
        )
        self._sessions[request_id] = session
        self._statuses[provider_id] = "approval_pending"
        self._plan_ids[provider_id] = plan_id
        return session

    async def cancel_subscription(
        self, provider_subscription_id: str, *, request_id: str
    ) -> None:
        del request_id
        self.cancel_calls.append(provider_subscription_id)
        self._statuses[provider_subscription_id] = "cancelled"

    async def get_subscription(
        self, provider_subscription_id: str
    ) -> ProviderSubscription:
        return ProviderSubscription(
            provider_subscription_id=provider_subscription_id,
            status=self._statuses.get(provider_subscription_id, "approval_pending"),
            plan_id=self._plan_ids.get(provider_subscription_id, "P-FAKE-MONTHLY-V1"),
        )

    async def verify_webhook(
        self,
        headers: Mapping[str, str],
        event: dict[str, Any],
    ) -> bool:
        del event
        return headers.get("x-fake-paypal-signature") == "valid"

    async def list_transactions(
        self,
        provider_subscription_id: str,
        *,
        start_time: str,
        end_time: str,
    ) -> tuple[ProviderTransaction, ...]:
        del start_time, end_time
        return tuple(self._transactions.get(provider_subscription_id, ()))

    def set_status(
        self, provider_subscription_id: str, status: ProviderSubscriptionStatus
    ) -> None:
        self._statuses[provider_subscription_id] = status

    def add_transaction(
        self, provider_subscription_id: str, transaction: ProviderTransaction
    ) -> None:
        self._transactions.setdefault(provider_subscription_id, []).append(transaction)
