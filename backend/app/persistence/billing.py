"""Transactional billing ledger, subscriptions, attempts, and period grants."""

import calendar
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from sqlite3 import Connection, Row
from typing import Any, cast
from uuid import uuid4

from app.billing.events import SUPPORTED_EVENT_TYPES, BillingEvent
from app.billing.gateway import ProviderEnvironment, ProviderSubscriptionStatus
from app.core.product import ProductConfig
from app.persistence.database import Database
from app.persistence.marketing import MarketingRepository


class AlreadySubscribedError(RuntimeError):
    pass


class BillingNotFoundError(LookupError):
    pass


class BillingConflictError(RuntimeError):
    pass


class BillingEventRejectedError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class BillingAttempt:
    id: str
    provider_request_id: str
    status: str
    provider_subscription_id: str | None
    approval_url: str | None


@dataclass(frozen=True, slots=True)
class OwnedSubscription:
    id: str
    provider_subscription_id: str
    status: ProviderSubscriptionStatus
    auto_renew: bool
    access_ends_at: str | None


@dataclass(frozen=True, slots=True)
class BillingEventResult:
    event_id: str
    status: str
    duplicate: bool = False


class BillingRepository:
    def __init__(
        self,
        database: Database,
        product: ProductConfig,
        marketing: MarketingRepository | None = None,
    ) -> None:
        self._database = database
        self._product = product
        self._marketing = marketing

    def begin_checkout(
        self, clerk_user_id: str, environment: ProviderEnvironment
    ) -> BillingAttempt:
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            open_attempt = connection.execute(
                """SELECT * FROM billing_attempts WHERE user_id = ?
                AND status IN ('creating', 'approval_pending', 'uncertain')
                ORDER BY created_at DESC, id DESC LIMIT 1""",
                (user_id,),
            ).fetchone()
            if open_attempt is not None:
                return _attempt(open_attempt)
            renewable = connection.execute(
                """SELECT 1 FROM subscriptions WHERE user_id = ?
                AND status IN ('approved', 'active', 'suspended') LIMIT 1""",
                (user_id,),
            ).fetchone()
            paid_access = connection.execute(
                """SELECT 1 FROM usage_periods WHERE user_id = ? AND source = 'monthly'
                AND status = 'active' AND ends_at >
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now') LIMIT 1""",
                (user_id,),
            ).fetchone()
            if renewable is not None or paid_access is not None:
                raise AlreadySubscribedError
            attempt_id = str(uuid4())
            request_id = str(uuid4())
            connection.execute(
                """INSERT INTO billing_attempts(
                    id, user_id, plan_code, provider_environment,
                    provider_request_id, status
                ) VALUES (?, ?, ?, ?, ?, 'creating')""",
                (
                    attempt_id,
                    user_id,
                    self._product.plan_code,
                    environment,
                    request_id,
                ),
            )
            created = connection.execute(
                "SELECT * FROM billing_attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
        assert created is not None
        return _attempt(created)

    def attach_provider_subscription(
        self,
        attempt_id: str,
        provider_subscription_id: str,
        approval_url: str,
        status: ProviderSubscriptionStatus,
    ) -> BillingAttempt:
        if status not in {"approval_pending", "approved", "active"}:
            raise ValueError("Unexpected checkout subscription status.")
        with self._database.transaction(immediate=True) as connection:
            attempt = connection.execute(
                "SELECT * FROM billing_attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
            if attempt is None:
                raise BillingNotFoundError
            if attempt["status"] == "approval_pending":
                return _attempt(attempt)
            if attempt["status"] not in {"creating", "uncertain"}:
                raise BillingConflictError
            connection.execute(
                """UPDATE billing_attempts SET provider_subscription_id = ?,
                    approval_url = ?, status = 'approval_pending',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?""",
                (provider_subscription_id, approval_url, attempt_id),
            )
            connection.execute(
                """INSERT INTO subscriptions(
                    id, user_id, billing_attempt_id, provider_environment,
                    provider_subscription_id, plan_code, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider_subscription_id) DO UPDATE SET
                    status = excluded.status,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')""",
                (
                    str(uuid4()),
                    attempt["user_id"],
                    attempt_id,
                    attempt["provider_environment"],
                    provider_subscription_id,
                    attempt["plan_code"],
                    status,
                ),
            )
            updated = connection.execute(
                "SELECT * FROM billing_attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
        assert updated is not None
        return _attempt(updated)

    def mark_attempt_uncertain(self, attempt_id: str) -> None:
        self._set_attempt_status(attempt_id, "uncertain")

    def mark_attempt_failed(self, attempt_id: str) -> None:
        self._set_attempt_status(attempt_id, "failed")

    def replace_pending_checkout(
        self, clerk_user_id: str, attempt_id: str
    ) -> BillingAttempt:
        """Retire one unapproved checkout and create its idempotent replacement."""

        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            attempt = connection.execute(
                """SELECT * FROM billing_attempts WHERE id = ? AND user_id = ?
                AND status = 'approval_pending'""",
                (attempt_id, user_id),
            ).fetchone()
            if attempt is None:
                current = connection.execute(
                    """SELECT * FROM billing_attempts WHERE user_id = ?
                    AND status IN ('creating', 'approval_pending', 'uncertain')
                    ORDER BY created_at DESC, id DESC LIMIT 1""",
                    (user_id,),
                ).fetchone()
                if current is not None:
                    return _attempt(current)
                raise BillingConflictError

            subscription = connection.execute(
                """SELECT * FROM subscriptions WHERE billing_attempt_id = ?
                AND user_id = ?""",
                (attempt_id, user_id),
            ).fetchone()
            if subscription is None or subscription["status"] != "approval_pending":
                raise AlreadySubscribedError
            payment = connection.execute(
                "SELECT 1 FROM payments WHERE subscription_id = ? LIMIT 1",
                (subscription["id"],),
            ).fetchone()
            if payment is not None:
                raise AlreadySubscribedError

            connection.execute(
                """UPDATE subscriptions SET status = 'cancelled', auto_renew = 0,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?""",
                (subscription["id"],),
            )
            connection.execute(
                """UPDATE billing_attempts SET status = 'cancelled',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?""",
                (attempt_id,),
            )

            replacement_id = str(uuid4())
            request_id = str(uuid4())
            connection.execute(
                """INSERT INTO billing_attempts(
                    id, user_id, plan_code, provider_environment,
                    provider_request_id, status
                ) VALUES (?, ?, ?, ?, ?, 'creating')""",
                (
                    replacement_id,
                    user_id,
                    attempt["plan_code"],
                    attempt["provider_environment"],
                    request_id,
                ),
            )
            replacement = connection.execute(
                "SELECT * FROM billing_attempts WHERE id = ?", (replacement_id,)
            ).fetchone()
        assert replacement is not None
        return _attempt(replacement)

    def account(self, clerk_user_id: str) -> dict[str, Any]:
        with self._database.transaction() as connection:
            user_id = _user_id(connection, clerk_user_id)
            subscription = connection.execute(
                """SELECT * FROM subscriptions WHERE user_id = ?
                ORDER BY updated_at DESC, id DESC LIMIT 1""",
                (user_id,),
            ).fetchone()
            attempt = connection.execute(
                """SELECT * FROM billing_attempts WHERE user_id = ?
                AND status IN ('creating', 'approval_pending', 'uncertain')
                ORDER BY updated_at DESC, id DESC LIMIT 1""",
                (user_id,),
            ).fetchone()
        return {
            "subscription": _subscription_dict(subscription),
            "pending_checkout": _attempt_dict(attempt),
        }

    def cancellable_subscription(self, clerk_user_id: str) -> OwnedSubscription:
        with self._database.transaction() as connection:
            user_id = _user_id(connection, clerk_user_id)
            row = connection.execute(
                """SELECT * FROM subscriptions WHERE user_id = ? AND auto_renew = 1
                AND status IN ('approved', 'active', 'suspended')
                ORDER BY updated_at DESC, id DESC LIMIT 1""",
                (user_id,),
            ).fetchone()
        if row is None:
            raise BillingNotFoundError
        return _owned_subscription(row)

    def reconcilable_subscription(self, clerk_user_id: str) -> OwnedSubscription:
        with self._database.transaction() as connection:
            user_id = _user_id(connection, clerk_user_id)
            row = connection.execute(
                """SELECT * FROM subscriptions WHERE user_id = ?
                AND status IN ('approval_pending', 'approved', 'active', 'suspended')
                ORDER BY updated_at DESC, id DESC LIMIT 1""",
                (user_id,),
            ).fetchone()
        if row is None:
            raise BillingNotFoundError
        return _owned_subscription(row)

    def mark_cancelled(self, clerk_user_id: str, provider_subscription_id: str) -> None:
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            updated = connection.execute(
                """UPDATE subscriptions SET status = 'cancelled', auto_renew = 0,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE user_id = ? AND provider_subscription_id = ?""",
                (user_id, provider_subscription_id),
            )
            if updated.rowcount != 1:
                raise BillingNotFoundError

    def process_event(
        self,
        event: BillingEvent,
        *,
        environment: ProviderEnvironment,
        expected_plan_id: str,
        expected_merchant_id: str,
    ) -> BillingEventResult:
        with self._database.transaction(immediate=True) as connection:
            existing = connection.execute(
                "SELECT status FROM paypal_events WHERE event_id = ?", (event.event_id,)
            ).fetchone()
            if existing is not None and existing["status"] in {
                "processed",
                "ignored",
                "rejected",
            }:
                return BillingEventResult(event.event_id, str(existing["status"]), True)
            if existing is None:
                connection.execute(
                    """INSERT INTO paypal_events(
                        event_id, event_type, provider_environment, status,
                        normalized_json, occurred_at
                    ) VALUES (?, ?, ?, 'received', ?, ?)""",
                    (
                        event.event_id,
                        event.event_type,
                        environment,
                        json.dumps(event.as_minimal_dict(), sort_keys=True),
                        event.occurred_at,
                    ),
                )
            try:
                status = self._apply_event(
                    connection,
                    event,
                    expected_plan_id=expected_plan_id,
                    expected_merchant_id=expected_merchant_id,
                )
            except BillingEventRejectedError as error:
                connection.execute(
                    """UPDATE paypal_events SET status = 'rejected', error_code = ?,
                        processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE event_id = ?""",
                    (error.code, event.event_id),
                )
                raise
            if status == "uncertain":
                connection.execute(
                    """UPDATE paypal_events SET processed_at =
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE event_id = ?""",
                    (event.event_id,),
                )
            else:
                connection.execute(
                    """UPDATE paypal_events SET status = ?, error_code = NULL,
                        processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE event_id = ?""",
                    (status, event.event_id),
                )
        return BillingEventResult(event.event_id, status)

    def reconciliation_attempts(self) -> list[dict[str, str]]:
        rows = self._database.query_all(
            """SELECT id, provider_request_id FROM billing_attempts
            WHERE status IN ('creating', 'uncertain') ORDER BY created_at, id"""
        )
        return [dict(row) for row in rows]

    def uncertain_events(self) -> list[BillingEvent]:
        rows = self._database.query_all(
            """SELECT normalized_json FROM paypal_events WHERE status = 'uncertain'
            ORDER BY received_at, event_id"""
        )
        events: list[BillingEvent] = []
        for row in rows:
            payload = json.loads(str(row["normalized_json"]))
            if isinstance(payload, dict):
                events.append(BillingEvent(**cast(dict[str, Any], payload)))
        return events

    def reconciliation_subscriptions(self) -> list[str]:
        rows = self._database.query_all(
            """SELECT provider_subscription_id FROM subscriptions
            WHERE status IN ('approval_pending', 'approved', 'active', 'suspended')
            ORDER BY updated_at, id"""
        )
        return [str(row["provider_subscription_id"]) for row in rows]

    def reconcile_subscription_status(
        self, provider_subscription_id: str, status: ProviderSubscriptionStatus
    ) -> None:
        with self._database.transaction(immediate=True) as connection:
            auto_renew = 0 if status in {"cancelled", "expired"} else 1
            connection.execute(
                """UPDATE subscriptions SET status = ?, auto_renew = ?,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE provider_subscription_id = ?""",
                (status, auto_renew, provider_subscription_id),
            )

    def _apply_event(
        self,
        connection: Connection,
        event: BillingEvent,
        *,
        expected_plan_id: str,
        expected_merchant_id: str,
    ) -> str:
        if event.event_type not in SUPPORTED_EVENT_TYPES:
            return "ignored"
        if event.merchant_id is not None and event.merchant_id != expected_merchant_id:
            raise BillingEventRejectedError("merchant_mismatch")
        if event.plan_id is not None and event.plan_id != expected_plan_id:
            raise BillingEventRejectedError("plan_mismatch")
        if event.event_type.startswith("BILLING.SUBSCRIPTION."):
            return self._apply_subscription_event(connection, event)
        if event.event_type == "PAYMENT.SALE.COMPLETED":
            if event.merchant_id != expected_merchant_id:
                raise BillingEventRejectedError("merchant_mismatch")
            return self._apply_payment(connection, event)
        return self._apply_refund_or_reversal(connection, event)

    def _apply_subscription_event(
        self, connection: Connection, event: BillingEvent
    ) -> str:
        if event.provider_subscription_id is None or event.subscription_status is None:
            raise BillingEventRejectedError("invalid_subscription_event")
        row = connection.execute(
            "SELECT * FROM subscriptions WHERE provider_subscription_id = ?",
            (event.provider_subscription_id,),
        ).fetchone()
        if row is None:
            self._mark_event_uncertain(connection, event.event_id, "unknown_subscription")
            return "uncertain"
        auto_renew = 0 if event.subscription_status in {"cancelled", "expired"} else 1
        connection.execute(
            """UPDATE subscriptions SET status = ?, auto_renew = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?""",
            (event.subscription_status, auto_renew, row["id"]),
        )
        return "processed"

    def _apply_payment(self, connection: Connection, event: BillingEvent) -> str:
        if (
            event.provider_subscription_id is None
            or event.provider_transaction_id is None
            or event.amount_minor is None
            or event.currency is None
        ):
            raise BillingEventRejectedError("invalid_payment")
        if event.amount_minor != self._product.price_minor:
            raise BillingEventRejectedError("amount_mismatch")
        if event.currency != self._product.currency:
            raise BillingEventRejectedError("currency_mismatch")
        subscription = connection.execute(
            "SELECT * FROM subscriptions WHERE provider_subscription_id = ?",
            (event.provider_subscription_id,),
        ).fetchone()
        if subscription is None:
            self._mark_event_uncertain(connection, event.event_id, "unknown_subscription")
            return "uncertain"
        existing = connection.execute(
            "SELECT id FROM payments WHERE provider_transaction_id = ?",
            (event.provider_transaction_id,),
        ).fetchone()
        if existing is not None:
            return "processed"

        previous_payment = connection.execute(
            "SELECT 1 FROM payments WHERE user_id = ? LIMIT 1",
            (subscription["user_id"],),
        ).fetchone()

        starts_at, ends_at = _monthly_period(event.occurred_at)
        newer = connection.execute(
            """SELECT 1 FROM payments WHERE user_id = ? AND paid_at > ?
            LIMIT 1""",
            (subscription["user_id"], starts_at),
        ).fetchone()
        period_id = str(uuid4())
        period_status = "replaced" if newer is not None else "active"
        if period_status == "active":
            connection.execute(
                "INSERT OR IGNORE INTO trial_grants(user_id) VALUES (?)",
                (subscription["user_id"],),
            )
            connection.execute(
                """UPDATE usage_periods SET status = 'replaced'
                WHERE user_id = ? AND status = 'active'""",
                (subscription["user_id"],),
            )
        limits = self._product.monthly
        connection.execute(
            """INSERT INTO usage_periods(
                id, user_id, source, plan_code, config_version, starts_at, ends_at,
                status, limit_voice_seconds, limit_voice_turns, limit_writings, limit_videos
            ) VALUES (?, ?, 'monthly', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                period_id,
                subscription["user_id"],
                self._product.plan_code,
                self._product.config_version,
                starts_at,
                ends_at,
                period_status,
                limits.voice_seconds,
                limits.voice_turns,
                limits.writings,
                limits.videos,
            ),
        )
        connection.execute(
            """INSERT INTO payments(
                id, user_id, subscription_id, provider_transaction_id,
                gross_minor, currency, status, paid_at, usage_period_id
            ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)""",
            (
                str(uuid4()),
                subscription["user_id"],
                subscription["id"],
                event.provider_transaction_id,
                event.amount_minor,
                event.currency,
                starts_at,
                period_id,
            ),
        )
        if self._marketing is not None:
            self._marketing.enqueue_purchase(
                connection,
                user_id=str(subscription["user_id"]),
                transaction_id=event.provider_transaction_id,
                amount_minor=event.amount_minor,
                currency=event.currency,
                occurred_at=event.occurred_at,
                first_payment=previous_payment is None,
            )
        if period_status == "active":
            connection.execute(
                """UPDATE subscriptions SET status = 'active', access_ends_at = ?,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?""",
                (ends_at, subscription["id"]),
            )
            connection.execute(
                """UPDATE billing_attempts SET status = 'completed',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?""",
                (subscription["billing_attempt_id"],),
            )
        return "processed"

    def _apply_refund_or_reversal(
        self, connection: Connection, event: BillingEvent
    ) -> str:
        if (
            event.parent_transaction_id is None
            or event.amount_minor is None
            or event.currency is None
        ):
            raise BillingEventRejectedError("invalid_adjustment")
        payment = connection.execute(
            "SELECT * FROM payments WHERE provider_transaction_id = ?",
            (event.parent_transaction_id,),
        ).fetchone()
        if payment is None:
            self._mark_event_uncertain(connection, event.event_id, "unknown_payment")
            return "uncertain"
        if event.currency != payment["currency"]:
            raise BillingEventRejectedError("currency_mismatch")
        refunded_minor = int(payment["refunded_minor"]) + event.amount_minor
        if refunded_minor > int(payment["gross_minor"]):
            raise BillingEventRejectedError("refund_exceeds_payment")
        is_total = refunded_minor == int(payment["gross_minor"])
        status = (
            "reversed"
            if is_total and event.event_type == "PAYMENT.SALE.REVERSED"
            else "refunded"
            if is_total
            else "partially_refunded"
        )
        connection.execute(
            """UPDATE payments SET refunded_minor = ?, status = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?""",
            (refunded_minor, status, payment["id"]),
        )
        if not is_total:
            connection.execute(
                """INSERT OR IGNORE INTO billing_adjustments(
                    id, payment_id, provider_event_id, kind, amount_minor
                ) VALUES (?, ?, ?, 'partial_refund', ?)""",
                (str(uuid4()), payment["id"], event.event_id, event.amount_minor),
            )
            return "processed"
        ended = connection.execute(
            """UPDATE usage_periods SET status = 'ended', ends_at = ?
            WHERE id = ? AND status = 'active'""",
            (event.occurred_at, payment["usage_period_id"]),
        )
        if ended.rowcount == 1:
            connection.execute(
                """UPDATE subscriptions SET access_ends_at = CASE
                    WHEN access_ends_at IS NULL OR access_ends_at > ? THEN ?
                    ELSE access_ends_at END,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?""",
                (event.occurred_at, event.occurred_at, payment["subscription_id"]),
            )
        return "processed"

    @staticmethod
    def _mark_event_uncertain(
        connection: Connection, event_id: str, code: str
    ) -> None:
        connection.execute(
            "UPDATE paypal_events SET status = 'uncertain', error_code = ? WHERE event_id = ?",
            (code, event_id),
        )

    def _set_attempt_status(self, attempt_id: str, status: str) -> None:
        with self._database.transaction(immediate=True) as connection:
            updated = connection.execute(
                """UPDATE billing_attempts SET status = ?,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ? AND status IN ('creating', 'uncertain')""",
                (status, attempt_id),
            )
            if updated.rowcount != 1:
                raise BillingConflictError


def _monthly_period(occurred_at: str) -> tuple[str, str]:
    try:
        start = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BillingEventRejectedError("invalid_event_time") from exc
    if start.tzinfo is None:
        raise BillingEventRejectedError("invalid_event_time")
    start = start.astimezone(UTC)
    year = start.year + (1 if start.month == 12 else 0)
    month = 1 if start.month == 12 else start.month + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    end = start.replace(year=year, month=month, day=day)
    return _iso(start), _iso(end)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _user_id(connection: Connection, clerk_user_id: str) -> str:
    row = connection.execute(
        "SELECT id FROM users WHERE clerk_user_id = ?", (clerk_user_id,)
    ).fetchone()
    if row is None:
        raise BillingNotFoundError
    return str(row["id"])


def _attempt(row: Row) -> BillingAttempt:
    return BillingAttempt(
        id=str(row["id"]),
        provider_request_id=str(row["provider_request_id"]),
        status=str(row["status"]),
        provider_subscription_id=(
            str(row["provider_subscription_id"])
            if row["provider_subscription_id"] is not None
            else None
        ),
        approval_url=str(row["approval_url"]) if row["approval_url"] is not None else None,
    )


def _attempt_dict(row: Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    attempt = _attempt(row)
    return {
        "id": attempt.id,
        "status": attempt.status,
        "approval_url": attempt.approval_url,
    }


def _owned_subscription(row: Row) -> OwnedSubscription:
    status = str(row["status"])
    if status not in {
        "approval_pending",
        "approved",
        "active",
        "suspended",
        "cancelled",
        "expired",
    }:
        raise RuntimeError("Unknown persisted subscription status.")
    return OwnedSubscription(
        id=str(row["id"]),
        provider_subscription_id=str(row["provider_subscription_id"]),
        status=cast(ProviderSubscriptionStatus, status),
        auto_renew=bool(row["auto_renew"]),
        access_ends_at=(
            str(row["access_ends_at"]) if row["access_ends_at"] is not None else None
        ),
    )


def _subscription_dict(row: Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    subscription = _owned_subscription(row)
    return {
        "id": subscription.id,
        "status": subscription.status,
        "auto_renew": subscription.auto_renew,
        "access_ends_at": subscription.access_ends_at,
        "can_cancel": subscription.auto_renew
        and subscription.status in {"approved", "active", "suspended"},
    }
