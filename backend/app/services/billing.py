"""Subscription orchestration with provider-independent, server-side activation."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from app.billing.events import BillingEvent, normalize_paypal_event
from app.billing.gateway import BillingGateway, BillingGatewayError
from app.core.config import Settings
from app.core.product import ProductConfig
from app.persistence.billing import (
    BillingAttempt,
    BillingEventRejectedError,
    BillingEventResult,
    BillingRepository,
)

FAKE_PLAN_ID = "P-FAKE-MONTHLY-V1"
FAKE_MERCHANT_ID = "MERCHANT-FAKE"


class InvalidWebhookSignatureError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ReconciliationResult:
    attempts_recovered: int = 0
    subscriptions_checked: int = 0
    transactions_processed: int = 0
    uncertain_events_reprocessed: int = 0
    failures: int = 0


class BillingService:
    def __init__(
        self,
        repository: BillingRepository,
        gateway: BillingGateway,
        settings: Settings,
        product: ProductConfig,
    ) -> None:
        self._repository = repository
        self._gateway = gateway
        self._settings = settings
        self._product = product
        self._plan_id = settings.paypal_plan_id or FAKE_PLAN_ID
        self._merchant_id = settings.paypal_merchant_id or FAKE_MERCHANT_ID

    async def start_checkout(self, clerk_user_id: str) -> BillingAttempt:
        attempt = self._repository.begin_checkout(
            clerk_user_id, self._gateway.environment
        )
        if attempt.status == "approval_pending" and attempt.approval_url is not None:
            return attempt
        try:
            session = await self._gateway.create_subscription(
                request_id=attempt.provider_request_id,
                custom_id=attempt.id,
                plan_id=self._plan_id,
                return_url=str(self._settings.billing_return_url),
                cancel_url=str(self._settings.billing_cancel_url),
            )
        except BillingGatewayError as error:
            if error.uncertain:
                self._repository.mark_attempt_uncertain(attempt.id)
            else:
                self._repository.mark_attempt_failed(attempt.id)
            raise
        return self._repository.attach_provider_subscription(
            attempt.id,
            session.provider_subscription_id,
            session.approval_url,
            session.status,
        )

    def account(self, clerk_user_id: str) -> dict[str, Any]:
        return {
            **self._repository.account(clerk_user_id),
            "mode": self._settings.billing_mode,
            "offer": {
                "plan_code": self._product.plan_code,
                "price_minor": self._product.price_minor,
                "currency": self._product.currency,
            },
        }

    async def cancel(self, clerk_user_id: str) -> dict[str, Any]:
        subscription = self._repository.cancellable_subscription(clerk_user_id)
        await self._gateway.cancel_subscription(
            subscription.provider_subscription_id,
            request_id=f"cancel-{subscription.id}",
        )
        self._repository.mark_cancelled(
            clerk_user_id, subscription.provider_subscription_id
        )
        return self.account(clerk_user_id)

    async def confirm_checkout(self, clerk_user_id: str) -> dict[str, Any]:
        """Verify the current user's PayPal return without trusting browser state."""

        owned = self._repository.reconcilable_subscription(clerk_user_id)
        subscription = await self._gateway.get_subscription(
            owned.provider_subscription_id
        )
        if subscription.plan_id != self._plan_id:
            raise BillingEventRejectedError("plan_mismatch")
        self._repository.reconcile_subscription_status(
            owned.provider_subscription_id, subscription.status
        )
        start_time, end_time = _reconciliation_window()
        transactions = await self._gateway.list_transactions(
            owned.provider_subscription_id,
            start_time=start_time,
            end_time=end_time,
        )
        for transaction in transactions:
            self.process_normalized_event(
                BillingEvent(
                    event_id=f"confirm:{transaction.provider_transaction_id}",
                    event_type="PAYMENT.SALE.COMPLETED",
                    occurred_at=transaction.occurred_at,
                    provider_subscription_id=owned.provider_subscription_id,
                    provider_transaction_id=transaction.provider_transaction_id,
                    merchant_id=self._merchant_id,
                    amount_minor=transaction.amount_minor,
                    currency=transaction.currency,
                )
            )
        return self.account(clerk_user_id)

    async def process_webhook(
        self,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> BillingEventResult:
        if not await self._gateway.verify_webhook(headers, payload):
            raise InvalidWebhookSignatureError
        return self.process_normalized_event(normalize_paypal_event(payload))

    def process_normalized_event(self, event: BillingEvent) -> BillingEventResult:
        return self._repository.process_event(
            event,
            environment=self._gateway.environment,
            expected_plan_id=self._plan_id,
            expected_merchant_id=self._merchant_id,
        )

    async def reconcile(self) -> ReconciliationResult:
        attempts_recovered = 0
        subscriptions_checked = 0
        transactions_processed = 0
        uncertain_events_reprocessed = 0
        failures = 0

        for attempt_data in self._repository.reconciliation_attempts():
            try:
                session = await self._gateway.create_subscription(
                    request_id=attempt_data["provider_request_id"],
                    custom_id=attempt_data["id"],
                    plan_id=self._plan_id,
                    return_url=str(self._settings.billing_return_url),
                    cancel_url=str(self._settings.billing_cancel_url),
                )
                self._repository.attach_provider_subscription(
                    attempt_data["id"],
                    session.provider_subscription_id,
                    session.approval_url,
                    session.status,
                )
                attempts_recovered += 1
            except (BillingGatewayError, RuntimeError, ValueError):
                failures += 1

        start_time, end_time = _reconciliation_window()
        for provider_subscription_id in self._repository.reconciliation_subscriptions():
            try:
                subscription = await self._gateway.get_subscription(
                    provider_subscription_id
                )
                if subscription.plan_id != self._plan_id:
                    raise BillingEventRejectedError("plan_mismatch")
                self._repository.reconcile_subscription_status(
                    provider_subscription_id, subscription.status
                )
                subscriptions_checked += 1
                transactions = await self._gateway.list_transactions(
                    provider_subscription_id,
                    start_time=start_time,
                    end_time=end_time,
                )
                for transaction in transactions:
                    result = self.process_normalized_event(
                        BillingEvent(
                            event_id=f"reconcile:{transaction.provider_transaction_id}",
                            event_type="PAYMENT.SALE.COMPLETED",
                            occurred_at=transaction.occurred_at,
                            provider_subscription_id=provider_subscription_id,
                            provider_transaction_id=transaction.provider_transaction_id,
                            merchant_id=self._merchant_id,
                            amount_minor=transaction.amount_minor,
                            currency=transaction.currency,
                        )
                    )
                    if not result.duplicate:
                        transactions_processed += 1
            except (BillingGatewayError, RuntimeError, ValueError):
                failures += 1

        for event in self._repository.uncertain_events():
            try:
                result = self.process_normalized_event(event)
                if result.status != "uncertain":
                    uncertain_events_reprocessed += 1
            except (RuntimeError, ValueError):
                failures += 1

        return ReconciliationResult(
            attempts_recovered=attempts_recovered,
            subscriptions_checked=subscriptions_checked,
            transactions_processed=transactions_processed,
            uncertain_events_reprocessed=uncertain_events_reprocessed,
            failures=failures,
        )


def _reconciliation_window() -> tuple[str, str]:
    end = datetime.now(UTC)
    start = end - timedelta(days=40)
    return _iso(start), _iso(end)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")
