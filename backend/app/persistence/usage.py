"""Atomic usage reservations, settlement, deduplication, and crash recovery."""

import json
from dataclasses import dataclass
from sqlite3 import Connection, Row
from typing import Any, Literal, cast
from uuid import uuid4

from app.core.product import ProductConfig
from app.persistence.database import Database

UsageKind = Literal["writing", "video", "voice"]


class QuotaExhaustedError(RuntimeError):
    def __init__(self, snapshot: dict[str, Any]) -> None:
        super().__init__("The active usage period has no capacity for this operation.")
        self.snapshot = snapshot


class UsageOperationInProgressError(RuntimeError):
    pass


class UsageOperationUncertainError(RuntimeError):
    pass


class UsageOperationReleasedError(RuntimeError):
    pass


class UsageAccessExpiredError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class UsageReservation:
    operation_id: str
    kind: UsageKind
    status: str
    result: dict[str, Any] | None


_COUNTERS: dict[UsageKind, tuple[str, str, str, str]] = {
    "writing": ("limit_writings", "used_writings", "reserved_writings", ""),
    "video": ("limit_videos", "used_videos", "reserved_videos", ""),
    "voice": (
        "limit_voice_seconds",
        "used_voice_seconds",
        "reserved_voice_seconds",
        "voice_turns",
    ),
}


class UsageRepository:
    def __init__(self, database: Database, config: ProductConfig) -> None:
        self._database = database
        self._config = config

    def reserve(
        self,
        clerk_user_id: str,
        operation_id: str,
        kind: UsageKind,
        *,
        primary: float = 1,
        secondary: float = 0,
        resource_key: str | None = None,
    ) -> UsageReservation:
        if not operation_id or len(operation_id) > 128 or primary <= 0 or secondary < 0:
            raise ValueError("Invalid usage reservation.")
        if kind != "voice" and (primary != 1 or secondary != 0):
            raise ValueError("Writing and video reservations consume exactly one unit.")
        if kind == "voice" and secondary != 1:
            raise ValueError("A voice reservation must include exactly one turn.")
        if (kind == "video") != (resource_key is not None):
            raise ValueError("Only video reservations require a resource key.")

        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            existing = connection.execute(
                """SELECT o.*, r.result_json FROM usage_operations AS o
                LEFT JOIN usage_operation_results AS r ON r.operation_id = o.id
                WHERE o.user_id = ? AND o.operation_id = ?""",
                (user_id, operation_id),
            ).fetchone()
            if existing is not None:
                return _replay(existing, kind)

            if resource_key is not None:
                claim = connection.execute(
                    """SELECT operation_id, status FROM usage_resource_claims
                    WHERE user_id = ? AND kind = ? AND resource_key = ?""",
                    (user_id, kind, resource_key),
                ).fetchone()
                if claim is not None and claim["status"] != "released":
                    claimed = connection.execute(
                        """SELECT o.*, r.result_json FROM usage_operations AS o
                        LEFT JOIN usage_operation_results AS r ON r.operation_id = o.id
                        WHERE o.user_id = ? AND o.operation_id = ?""",
                        (user_id, claim["operation_id"]),
                    ).fetchone()
                    if claimed is not None:
                        return _replay(claimed, kind)

            period = self._ensure_period(connection, user_id)
            if not _has_capacity(period, kind, primary, secondary):
                raise QuotaExhaustedError(_snapshot(period))

            internal_id = str(uuid4())
            connection.execute(
                """INSERT INTO usage_operations(
                    id, user_id, period_id, operation_id, kind, resource_key, status,
                    reserved_primary, reserved_secondary
                ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)""",
                (
                    internal_id,
                    user_id,
                    period["id"],
                    operation_id,
                    kind,
                    resource_key,
                    primary,
                    secondary,
                ),
            )
            _change_reserved(connection, str(period["id"]), kind, primary, secondary)
            if resource_key is not None:
                connection.execute(
                    """INSERT INTO usage_resource_claims(
                        user_id, kind, resource_key, operation_id, status
                    ) VALUES (?, ?, ?, ?, 'pending')
                    ON CONFLICT(user_id, kind, resource_key) DO UPDATE SET
                        operation_id = excluded.operation_id,
                        status = 'pending',
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE usage_resource_claims.status = 'released'""",
                    (user_id, kind, resource_key, operation_id),
                )
        return UsageReservation(operation_id, kind, "reserved", None)

    def mark_provider_started(self, clerk_user_id: str, operation_id: str) -> None:
        self._transition(
            clerk_user_id,
            operation_id,
            from_statuses=("reserved",),
            to_status="provider_started",
            provider_started=True,
        )

    def persist_result(
        self,
        clerk_user_id: str,
        operation_id: str,
        result: dict[str, Any],
        *,
        actual_primary: float,
        actual_secondary: float = 0,
    ) -> None:
        with self._database.transaction(immediate=True) as connection:
            operation = _owned_operation(connection, clerk_user_id, operation_id)
            if operation["status"] in {"result_persisted", "succeeded"}:
                return
            if operation["status"] not in {"reserved", "provider_started"}:
                raise UsageOperationUncertainError
            if (
                actual_primary < 0
                or actual_secondary < 0
                or actual_primary > float(operation["reserved_primary"])
                or actual_secondary > float(operation["reserved_secondary"])
            ):
                raise ValueError("Actual usage exceeds the reservation.")
            connection.execute(
                """INSERT INTO usage_operation_results(operation_id, result_json)
                VALUES (?, ?)""",
                (operation["id"], json.dumps(result, ensure_ascii=False)),
            )
            connection.execute(
                """UPDATE usage_operations SET status = 'result_persisted',
                    used_primary = ?, used_secondary = ?,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?""",
                (actual_primary, actual_secondary, operation["id"]),
            )

    def settle(self, clerk_user_id: str, operation_id: str) -> UsageReservation:
        with self._database.transaction(immediate=True) as connection:
            operation = _owned_operation(connection, clerk_user_id, operation_id)
            if operation["status"] == "succeeded":
                return _reservation(operation)
            if operation["status"] != "result_persisted" or operation["result_json"] is None:
                raise UsageOperationUncertainError
            kind = _kind(operation)
            _settle_counters(connection, operation, kind)
            connection.execute(
                """UPDATE usage_operations SET status = 'succeeded',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?""",
                (operation["id"],),
            )
            if operation["resource_key"] is not None:
                connection.execute(
                    """UPDATE usage_resource_claims SET status = 'succeeded',
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE user_id = ? AND operation_id = ?""",
                    (operation["user_id"], operation_id),
                )
            updated = connection.execute(
                """SELECT o.*, r.result_json FROM usage_operations AS o
                LEFT JOIN usage_operation_results AS r ON r.operation_id = o.id
                WHERE o.id = ?""",
                (operation["id"],),
            ).fetchone()
        assert updated is not None
        return _reservation(updated)

    def release(self, clerk_user_id: str, operation_id: str) -> None:
        with self._database.transaction(immediate=True) as connection:
            operation = _owned_operation(connection, clerk_user_id, operation_id)
            if operation["status"] in {"released", "succeeded"}:
                return
            if operation["status"] == "result_persisted":
                raise UsageOperationUncertainError
            kind = _kind(operation)
            _release_counters(connection, operation, kind)
            connection.execute(
                """UPDATE usage_operations SET status = 'released',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?""",
                (operation["id"],),
            )
            if operation["resource_key"] is not None:
                connection.execute(
                    """UPDATE usage_resource_claims SET status = 'released',
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE user_id = ? AND operation_id = ?""",
                    (operation["user_id"], operation_id),
                )

    def add_cost_usd(self, clerk_user_id: str, operation_id: str, cost_usd: float) -> None:
        if cost_usd <= 0:
            return
        cost_micro_usd = max(0, round(cost_usd * 1_000_000))
        with self._database.transaction(immediate=True) as connection:
            operation = _owned_operation(connection, clerk_user_id, operation_id)
            connection.execute(
                "UPDATE usage_operations SET cost_micro_usd = cost_micro_usd + ? WHERE id = ?",
                (cost_micro_usd, operation["id"]),
            )

    def quota(self, clerk_user_id: str) -> dict[str, Any]:
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            period = self._ensure_period(connection, user_id)
            return _snapshot(period)

    def reserved_primary(self, clerk_user_id: str, operation_id: str) -> float:
        with self._database.transaction() as connection:
            operation = _owned_operation(connection, clerk_user_id, operation_id)
            return float(operation["reserved_primary"])

    def reconcile_after_restart(self) -> dict[str, int]:
        """Settle persisted results, release never-started calls, quarantine uncertain calls."""

        with self._database.transaction(immediate=True) as connection:
            completed_voice = connection.execute(
                """SELECT o.id, t.user_text, t.assistant_text
                FROM usage_operations AS o
                JOIN voice_turns AS t
                    ON t.user_id = o.user_id AND t.operation_id = o.operation_id
                WHERE o.kind = 'voice' AND o.status = 'provider_started'"""
            ).fetchall()
            for operation in completed_voice:
                connection.execute(
                    """INSERT OR IGNORE INTO usage_operation_results(operation_id, result_json)
                    VALUES (?, ?)""",
                    (
                        operation["id"],
                        json.dumps(
                            {
                                "user_text": operation["user_text"],
                                "assistant_text": operation["assistant_text"],
                            },
                            ensure_ascii=False,
                        ),
                    ),
                )
                connection.execute(
                    """UPDATE usage_operations SET status = 'result_persisted',
                        used_primary = reserved_primary,
                        used_secondary = reserved_secondary,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE id = ?""",
                    (operation["id"],),
                )

        persisted = self._database.query_all(
            """SELECT u.clerk_user_id, o.operation_id
            FROM usage_operations AS o JOIN users AS u ON u.id = o.user_id
            WHERE o.status = 'result_persisted'"""
        )
        settled = 0
        for row in persisted:
            self.settle(str(row["clerk_user_id"]), str(row["operation_id"]))
            settled += 1

        with self._database.transaction(immediate=True) as connection:
            abandoned = connection.execute(
                "SELECT * FROM usage_operations WHERE status = 'reserved'"
            ).fetchall()
            for operation in abandoned:
                _release_counters(connection, operation, _kind(operation))
                connection.execute(
                    "UPDATE usage_operations SET status = 'released' WHERE id = ?",
                    (operation["id"],),
                )
                if operation["resource_key"] is not None:
                    connection.execute(
                        """UPDATE usage_resource_claims SET status = 'released'
                        WHERE user_id = ? AND operation_id = ?""",
                        (operation["user_id"], operation["operation_id"]),
                    )
            uncertain = connection.execute(
                "SELECT * FROM usage_operations WHERE status = 'provider_started'"
            ).fetchall()
            for operation in uncertain:
                connection.execute(
                    "UPDATE usage_operations SET status = 'uncertain' WHERE id = ?",
                    (operation["id"],),
                )
                if operation["resource_key"] is not None:
                    connection.execute(
                        """UPDATE usage_resource_claims SET status = 'uncertain'
                        WHERE user_id = ? AND operation_id = ?""",
                        (operation["user_id"], operation["operation_id"]),
                    )
        return {
            "settled": settled,
            "released": len(abandoned),
            "uncertain": len(uncertain),
        }

    def _transition(
        self,
        clerk_user_id: str,
        operation_id: str,
        *,
        from_statuses: tuple[str, ...],
        to_status: str,
        provider_started: bool = False,
    ) -> None:
        with self._database.transaction(immediate=True) as connection:
            operation = _owned_operation(connection, clerk_user_id, operation_id)
            if operation["status"] == to_status:
                return
            if operation["status"] not in from_statuses:
                raise UsageOperationUncertainError
            connection.execute(
                """UPDATE usage_operations SET status = ?, provider_started_at = CASE
                    WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    ELSE provider_started_at END,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?""",
                (to_status, int(provider_started), operation["id"]),
            )

    def _ensure_period(self, connection: Connection, user_id: str) -> Row:
        period = connection.execute(
            "SELECT * FROM usage_periods WHERE user_id = ? AND status = 'active'",
            (user_id,),
        ).fetchone()
        if period is not None:
            return cast(Row, period)
        existing_grant = connection.execute(
            "SELECT 1 FROM trial_grants WHERE user_id = ?", (user_id,)
        ).fetchone()
        if existing_grant is not None:
            raise UsageAccessExpiredError
        connection.execute(
            "INSERT OR IGNORE INTO trial_grants(user_id) VALUES (?)", (user_id,)
        )
        limits = self._config.trial
        connection.execute(
            """INSERT INTO usage_periods(
                id, user_id, source, plan_code, config_version,
                limit_voice_seconds, limit_voice_turns, limit_writings, limit_videos
            ) VALUES (?, ?, 'trial', ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid4()),
                user_id,
                self._config.plan_code,
                self._config.config_version,
                limits.voice_seconds,
                limits.voice_turns,
                limits.writings,
                limits.videos,
            ),
        )
        created = connection.execute(
            "SELECT * FROM usage_periods WHERE user_id = ? AND status = 'active'",
            (user_id,),
        ).fetchone()
        assert created is not None
        return cast(Row, created)


def _replay(row: Row, expected_kind: UsageKind) -> UsageReservation:
    if row["kind"] != expected_kind:
        raise ValueError("Operation ID was already used for another resource.")
    status = str(row["status"])
    if status in {"reserved", "provider_started", "result_persisted"}:
        raise UsageOperationInProgressError
    if status == "uncertain":
        raise UsageOperationUncertainError
    if status == "released":
        raise UsageOperationReleasedError
    return _reservation(row)


def _reservation(row: Row) -> UsageReservation:
    raw_result = row["result_json"]
    return UsageReservation(
        operation_id=str(row["operation_id"]),
        kind=_kind(row),
        status=str(row["status"]),
        result=json.loads(raw_result) if raw_result else None,
    )


def _kind(row: Row) -> UsageKind:
    value = str(row["kind"])
    if value not in {"writing", "video", "voice"}:
        raise RuntimeError("Unknown persisted usage kind.")
    return value  # type: ignore[return-value]


def _user_id(connection: Connection, clerk_user_id: str) -> str:
    user = connection.execute(
        "SELECT id FROM users WHERE clerk_user_id = ?", (clerk_user_id,)
    ).fetchone()
    if user is None:
        raise LookupError("Authenticated user has not been persisted.")
    return str(user["id"])


def _has_capacity(
    period: Row, kind: UsageKind, primary: float, secondary: float
) -> bool:
    limit_column, used_column, reserved_column, secondary_prefix = _COUNTERS[kind]
    primary_remaining = (
        float(period[limit_column])
        - float(period[used_column])
        - float(period[reserved_column])
    )
    if primary_remaining < primary:
        return False
    if not secondary_prefix:
        return True
    return (
        float(period["limit_voice_turns"])
        - float(period["used_voice_turns"])
        - float(period["reserved_voice_turns"])
        >= secondary
    )


def _change_reserved(
    connection: Connection,
    period_id: str,
    kind: UsageKind,
    primary: float,
    secondary: float,
) -> None:
    _, _, reserved_column, secondary_prefix = _COUNTERS[kind]
    if secondary_prefix:
        connection.execute(
            f"""UPDATE usage_periods SET {reserved_column} = {reserved_column} + ?,
                reserved_voice_turns = reserved_voice_turns + ? WHERE id = ?""",
            (primary, secondary, period_id),
        )
    else:
        connection.execute(
            f"UPDATE usage_periods SET {reserved_column} = {reserved_column} + ? WHERE id = ?",
            (primary, period_id),
        )


def _release_counters(connection: Connection, operation: Row, kind: UsageKind) -> None:
    _, _, reserved_column, secondary_prefix = _COUNTERS[kind]
    if secondary_prefix:
        connection.execute(
            f"""UPDATE usage_periods SET {reserved_column} = {reserved_column} - ?,
                reserved_voice_turns = reserved_voice_turns - ? WHERE id = ?""",
            (
                operation["reserved_primary"],
                operation["reserved_secondary"],
                operation["period_id"],
            ),
        )
    else:
        connection.execute(
            f"UPDATE usage_periods SET {reserved_column} = {reserved_column} - ? WHERE id = ?",
            (operation["reserved_primary"], operation["period_id"]),
        )


def _settle_counters(connection: Connection, operation: Row, kind: UsageKind) -> None:
    _, used_column, reserved_column, secondary_prefix = _COUNTERS[kind]
    if secondary_prefix:
        connection.execute(
            f"""UPDATE usage_periods SET
                {reserved_column} = {reserved_column} - ?, {used_column} = {used_column} + ?,
                reserved_voice_turns = reserved_voice_turns - ?,
                used_voice_turns = used_voice_turns + ? WHERE id = ?""",
            (
                operation["reserved_primary"],
                operation["used_primary"],
                operation["reserved_secondary"],
                operation["used_secondary"],
                operation["period_id"],
            ),
        )
    else:
        connection.execute(
            f"""UPDATE usage_periods SET
                {reserved_column} = {reserved_column} - ?, {used_column} = {used_column} + ?
                WHERE id = ?""",
            (
                operation["reserved_primary"],
                operation["used_primary"],
                operation["period_id"],
            ),
        )


def _owned_operation(connection: Connection, clerk_user_id: str, operation_id: str) -> Row:
    operation = connection.execute(
        """SELECT o.*, r.result_json FROM usage_operations AS o
        JOIN users AS u ON u.id = o.user_id
        LEFT JOIN usage_operation_results AS r ON r.operation_id = o.id
        WHERE u.clerk_user_id = ? AND o.operation_id = ?""",
        (clerk_user_id, operation_id),
    ).fetchone()
    if operation is None:
        raise LookupError("Usage operation not found.")
    return cast(Row, operation)


def _snapshot(period: Row) -> dict[str, Any]:
    limits = {
        "voice_seconds": float(period["limit_voice_seconds"]),
        "voice_turns": int(period["limit_voice_turns"]),
        "writings": int(period["limit_writings"]),
        "videos": int(period["limit_videos"]),
    }
    used = {
        "voice_seconds": float(period["used_voice_seconds"]),
        "voice_turns": int(period["used_voice_turns"]),
        "writings": int(period["used_writings"]),
        "videos": int(period["used_videos"]),
    }
    reserved = {
        "voice_seconds": float(period["reserved_voice_seconds"]),
        "voice_turns": int(period["reserved_voice_turns"]),
        "writings": int(period["reserved_writings"]),
        "videos": int(period["reserved_videos"]),
    }
    remaining = {
        key: max(0, limits[key] - used[key] - reserved[key]) for key in limits
    }
    return {
        "period_id": str(period["id"]),
        "source": str(period["source"]),
        "plan_code": str(period["plan_code"]),
        "config_version": int(period["config_version"]),
        "starts_at": str(period["starts_at"]),
        "ends_at": str(period["ends_at"]) if period["ends_at"] is not None else None,
        "limits": limits,
        "used": used,
        "reserved": reserved,
        "remaining": remaining,
    }
