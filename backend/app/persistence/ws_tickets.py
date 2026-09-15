"""Opaque, short-lived, single-use WebSocket admission tickets."""

from collections.abc import Callable
from dataclasses import dataclass
from hashlib import sha256
from secrets import token_urlsafe
from time import time

from app.persistence.database import Database


@dataclass(frozen=True, slots=True)
class IssuedWebSocketTicket:
    ticket: str
    expires_in_seconds: int


@dataclass(frozen=True, slots=True)
class ConsumedWebSocketTicket:
    user_id: str
    session_id: str


class WebSocketTicketRepository:
    """Store only ticket hashes and consume them under an immediate write lock."""

    def __init__(
        self,
        database: Database,
        *,
        ttl_seconds: int,
        clock: Callable[[], float] = time,
    ) -> None:
        self._database = database
        self._ttl_seconds = ttl_seconds
        self._clock = clock

    def issue(self, clerk_user_id: str, session_id: str) -> IssuedWebSocketTicket:
        now = int(self._clock())
        raw_ticket = token_urlsafe(32)
        token_hash = _hash(raw_ticket)
        with self._database.transaction(immediate=True) as connection:
            user = connection.execute(
                "SELECT id FROM users WHERE clerk_user_id = ?",
                (clerk_user_id,),
            ).fetchone()
            if user is None:
                raise LookupError("Authenticated user has not been persisted.")
            connection.execute(
                """
                INSERT INTO ws_tickets(
                    token_hash, user_id, session_id, expires_at, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (token_hash, user["id"], session_id, now + self._ttl_seconds, now),
            )
        return IssuedWebSocketTicket(raw_ticket, self._ttl_seconds)

    def consume(self, raw_ticket: str) -> ConsumedWebSocketTicket | None:
        if not raw_ticket or len(raw_ticket) > 512:
            return None
        now = int(self._clock())
        with self._database.transaction(immediate=True) as connection:
            row = connection.execute(
                """
                SELECT u.clerk_user_id, t.session_id
                FROM ws_tickets AS t
                JOIN users AS u ON u.id = t.user_id
                WHERE t.token_hash = ?
                  AND t.consumed_at IS NULL
                  AND t.expires_at > ?
                """,
                (_hash(raw_ticket), now),
            ).fetchone()
            if row is None:
                return None
            updated = connection.execute(
                """
                UPDATE ws_tickets SET consumed_at = ?
                WHERE token_hash = ? AND consumed_at IS NULL
                """,
                (now, _hash(raw_ticket)),
            )
            if updated.rowcount != 1:
                return None
        return ConsumedWebSocketTicket(
            user_id=str(row["clerk_user_id"]),
            session_id=str(row["session_id"]),
        )

    def revoke_session(self, session_id: str) -> None:
        now = int(self._clock())
        with self._database.transaction(immediate=True) as connection:
            connection.execute(
                """
                UPDATE ws_tickets SET consumed_at = ?
                WHERE session_id = ? AND consumed_at IS NULL
                """,
                (now, session_id),
            )


def _hash(raw_ticket: str) -> str:
    return sha256(raw_ticket.encode("utf-8")).hexdigest()
