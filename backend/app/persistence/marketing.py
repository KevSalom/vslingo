"""Consent records, allowlisted marketing outbox, and aggregate operator metrics."""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from sqlite3 import Connection, Row
from typing import Any, cast
from uuid import UUID, uuid4

from app.marketing.gateway import MarketingEvent
from app.persistence.database import Database

ALLOWED_PAGE_ROUTES = frozenset(
    {"/", "/demo", "/app", "/app/hablar", "/app/escribir", "/app/videos", "/app/cuenta"}
)


@dataclass(frozen=True, slots=True)
class OutboxItem:
    id: str
    event: MarketingEvent
    attempts: int


class MarketingRepository:
    def __init__(self, database: Database, *, policy_version: str, frontend_origin: str) -> None:
        self._database = database
        self._policy_version = policy_version
        self._frontend_origin = frontend_origin.rstrip("/")

    def enqueue_lead(self, connection: Connection, user_id: str) -> None:
        self._insert_event(
            connection,
            user_id=user_id,
            visitor_id=None,
            event_name="Lead",
            event_id=f"lead:{user_id}",
            action_source="website",
            payload={
                "event_time": _unix_now(),
                "event_source_url": f"{self._frontend_origin}/app",
                "user_data": {"external_id": [_hash_identifier(user_id)]},
            },
        )

    def enqueue_purchase(
        self,
        connection: Connection,
        *,
        user_id: str,
        transaction_id: str,
        amount_minor: int,
        currency: str,
        occurred_at: str,
        first_payment: bool,
    ) -> None:
        self._insert_event(
            connection,
            user_id=user_id,
            visitor_id=None,
            event_name="Purchase",
            event_id=f"purchase:{transaction_id}",
            action_source="website" if first_payment else "system_generated",
            payload={
                "event_time": _unix_time(occurred_at),
                "event_source_url": f"{self._frontend_origin}/app/cuenta",
                "user_data": {"external_id": [_hash_identifier(user_id)]},
                "custom_data": {
                    "currency": currency,
                    "value": amount_minor / 100,
                    "payment_kind": "first_payment" if first_payment else "renewal",
                },
            },
        )

    def consent(self, clerk_user_id: str) -> dict[str, Any]:
        row = self._database.query_one(
            """SELECT c.analytics_allowed, c.policy_version, c.revision, c.updated_at
            FROM marketing_consents c JOIN users u ON u.id = c.user_id
            WHERE u.clerk_user_id = ?""",
            (clerk_user_id,),
        )
        if row is None:
            return {
                "status": "pending",
                "analytics_allowed": None,
                "policy_version": self._policy_version,
                "revision": 0,
                "updated_at": None,
            }
        allowed = bool(row["analytics_allowed"])
        current = str(row["policy_version"]) == self._policy_version
        return {
            "status": ("accepted" if allowed else "rejected") if current else "pending",
            "analytics_allowed": allowed if current else None,
            "policy_version": self._policy_version,
            "revision": int(row["revision"]),
            "updated_at": str(row["updated_at"]),
        }

    def save_consent(self, clerk_user_id: str, analytics_allowed: bool) -> dict[str, Any]:
        with self._database.transaction(immediate=True) as connection:
            user = connection.execute(
                "SELECT id FROM users WHERE clerk_user_id = ?", (clerk_user_id,)
            ).fetchone()
            if user is None:
                raise LookupError("Authenticated user has not been persisted.")
            connection.execute(
                """INSERT INTO marketing_consents(
                    user_id, analytics_allowed, policy_version, revision
                ) VALUES (?, ?, ?, 1)
                ON CONFLICT(user_id) DO UPDATE SET
                    analytics_allowed = excluded.analytics_allowed,
                    policy_version = excluded.policy_version,
                    revision = marketing_consents.revision + 1,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')""",
                (user["id"], int(analytics_allowed), self._policy_version),
            )
        return self.consent(clerk_user_id)

    def save_visitor_consent(self, visitor_id: str, analytics_allowed: bool) -> None:
        _validate_uuid(visitor_id)
        with self._database.transaction(immediate=True) as connection:
            connection.execute(
                """INSERT INTO marketing_visitors(
                    visitor_id, analytics_allowed, policy_version
                ) VALUES (?, ?, ?)
                ON CONFLICT(visitor_id) DO UPDATE SET
                    analytics_allowed = excluded.analytics_allowed,
                    policy_version = excluded.policy_version,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')""",
                (visitor_id, int(analytics_allowed), self._policy_version),
            )

    def enqueue_page_view(
        self,
        *,
        visitor_id: str,
        event_id: str,
        route: str,
        client_ip_address: str | None,
        client_user_agent: str | None,
    ) -> bool:
        _validate_uuid(visitor_id)
        _validate_uuid(event_id)
        if route not in ALLOWED_PAGE_ROUTES:
            raise ValueError("Unsupported page route.")
        with self._database.transaction(immediate=True) as connection:
            visitor = connection.execute(
                """SELECT analytics_allowed, policy_version FROM marketing_visitors
                WHERE visitor_id = ?""",
                (visitor_id,),
            ).fetchone()
            if (
                visitor is None
                or not bool(visitor["analytics_allowed"])
                or visitor["policy_version"] != self._policy_version
            ):
                return False
            user_data: dict[str, Any] = {
                "external_id": [_hash_identifier(visitor_id)]
            }
            if client_ip_address:
                user_data["client_ip_address"] = client_ip_address[:64]
            if client_user_agent:
                user_data["client_user_agent"] = client_user_agent[:512]
            self._insert_event(
                connection,
                user_id=None,
                visitor_id=visitor_id,
                event_name="PageView",
                event_id=f"page:{event_id}",
                action_source="website",
                payload={
                    "event_time": _unix_now(),
                    "event_source_url": f"{self._frontend_origin}{route}",
                    "user_data": user_data,
                },
            )
        return True

    def dispatchable(self, *, limit: int = 50) -> list[OutboxItem]:
        rows = self._database.query_all(
            """SELECT o.* FROM marketing_outbox o
            WHERE o.status IN ('pending', 'retry')
            AND (o.next_attempt_at IS NULL OR o.next_attempt_at <=
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            AND (
                (o.user_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM marketing_consents c WHERE c.user_id = o.user_id
                    AND c.analytics_allowed = 1 AND c.policy_version = ?
                )) OR
                (o.visitor_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM marketing_visitors v WHERE v.visitor_id = o.visitor_id
                    AND v.analytics_allowed = 1 AND v.policy_version = ?
                ))
            )
            ORDER BY o.created_at, o.id LIMIT ?""",
            (self._policy_version, self._policy_version, limit),
        )
        return [_outbox_item(row) for row in rows]

    def mark_sent(self, item_id: str) -> None:
        with self._database.transaction(immediate=True) as connection:
            connection.execute(
                """UPDATE marketing_outbox SET status = 'sent', attempts = attempts + 1,
                    last_error_code = NULL, sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ? AND status IN ('pending', 'retry')""",
                (item_id,),
            )

    def mark_retry(self, item_id: str, *, attempts: int, error_code: str) -> None:
        delay_minutes = min(360, 2 ** min(attempts, 8))
        next_attempt = datetime.now(UTC) + timedelta(minutes=delay_minutes)
        with self._database.transaction(immediate=True) as connection:
            connection.execute(
                """UPDATE marketing_outbox SET status = 'retry', attempts = attempts + 1,
                    next_attempt_at = ?, last_error_code = ?
                WHERE id = ? AND status IN ('pending', 'retry')""",
                (_iso(next_attempt), error_code[:64], item_id),
            )

    def operator_summary(self) -> dict[str, Any]:
        revenue = self._database.query_one(
            """SELECT COUNT(*) AS payments,
                COALESCE(SUM(gross_minor), 0) AS gross_minor,
                COALESCE(SUM(refunded_minor), 0) AS refunded_minor
            FROM payments"""
        )
        costs = self._database.query_one(
            """SELECT COUNT(*) AS operations,
                COALESCE(SUM(cost_micro_usd), 0) AS cost_micro_usd
            FROM usage_operations"""
        )
        outbox = self._database.query_all(
            "SELECT status, COUNT(*) AS count FROM marketing_outbox GROUP BY status"
        )
        adjustments = self._database.query_one(
            """SELECT COUNT(*) AS count FROM billing_adjustments
            WHERE status = 'needs_manual_review'"""
        )
        return {
            "payments": int(revenue["payments"]) if revenue else 0,
            "gross_minor": int(revenue["gross_minor"]) if revenue else 0,
            "refunded_minor": int(revenue["refunded_minor"]) if revenue else 0,
            "operations": int(costs["operations"]) if costs else 0,
            "cost_micro_usd": int(costs["cost_micro_usd"]) if costs else 0,
            "marketing_outbox": {str(row["status"]): int(row["count"]) for row in outbox},
            "manual_adjustments": int(adjustments["count"]) if adjustments else 0,
        }

    @staticmethod
    def _insert_event(
        connection: Connection,
        *,
        user_id: str | None,
        visitor_id: str | None,
        event_name: str,
        event_id: str,
        action_source: str,
        payload: dict[str, Any],
    ) -> None:
        connection.execute(
            """INSERT OR IGNORE INTO marketing_outbox(
                id, user_id, visitor_id, event_name, event_id, action_source, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid4()),
                user_id,
                visitor_id,
                event_name,
                event_id,
                action_source,
                json.dumps(payload, separators=(",", ":"), sort_keys=True),
            ),
        )


def _outbox_item(row: Row) -> OutboxItem:
    event_name = str(row["event_name"])
    action_source = str(row["action_source"])
    if event_name not in {"PageView", "Lead", "Purchase"}:
        raise RuntimeError("Unknown marketing event.")
    if action_source not in {"website", "system_generated"}:
        raise RuntimeError("Unknown action source.")
    payload = json.loads(str(row["payload_json"]))
    if not isinstance(payload, dict):
        raise RuntimeError("Invalid marketing payload.")
    return OutboxItem(
        id=str(row["id"]),
        event=MarketingEvent(
            event_name=cast(Any, event_name),
            event_id=str(row["event_id"]),
            action_source=cast(Any, action_source),
            payload=cast(dict[str, Any], payload),
        ),
        attempts=int(row["attempts"]),
    )


def _hash_identifier(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _validate_uuid(value: str) -> None:
    try:
        parsed = UUID(value)
    except ValueError as exc:
        raise ValueError("Invalid event identifier.") from exc
    if str(parsed) != value.lower():
        raise ValueError("Invalid event identifier.")


def _unix_now() -> int:
    return int(datetime.now(UTC).timestamp())


def _unix_time(value: str) -> int:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Invalid event timestamp.") from exc
    if parsed.tzinfo is None:
        raise ValueError("Invalid event timestamp.")
    return int(parsed.timestamp())


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
