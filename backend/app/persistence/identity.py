"""User and preference repositories whose public keys are authenticated Clerk IDs."""

from collections.abc import Callable
from dataclasses import dataclass
from sqlite3 import Connection, Row
from uuid import uuid4

from app.persistence.database import Database


@dataclass(frozen=True, slots=True)
class UserRecord:
    id: str
    clerk_user_id: str
    created_at: str


@dataclass(frozen=True, slots=True)
class UserPreferences:
    theme: str = "light"
    speech_voice: str = "en-US-AriaNeural"
    version: int = 0


class PreferenceConflictError(RuntimeError):
    """Raised when an outdated client tries to overwrite newer preferences."""


class IdentityRepository:
    """Persist identity without accepting an internal user ID from clients."""

    def __init__(
        self,
        database: Database,
        *,
        on_user_created: Callable[[Connection, str], None] | None = None,
    ) -> None:
        self._database = database
        self._on_user_created = on_user_created

    def ensure_user(self, clerk_user_id: str) -> UserRecord:
        """Create a stable application user once for a verified Clerk subject."""

        if not clerk_user_id or len(clerk_user_id) > 255:
            raise ValueError("Invalid authenticated user identifier.")
        with self._database.transaction(immediate=True) as connection:
            inserted = connection.execute(
                "INSERT OR IGNORE INTO users(id, clerk_user_id) VALUES (?, ?)",
                (str(uuid4()), clerk_user_id),
            )
            row = connection.execute(
                "SELECT id, clerk_user_id, created_at FROM users WHERE clerk_user_id = ?",
                (clerk_user_id,),
            ).fetchone()
            if row is not None and inserted.rowcount == 1 and self._on_user_created:
                self._on_user_created(connection, str(row["id"]))
        if row is None:
            raise RuntimeError("Failed to persist authenticated user.")
        return _user_from_row(row)

    def get_user(self, clerk_user_id: str) -> UserRecord | None:
        row = self._database.query_one(
            "SELECT id, clerk_user_id, created_at FROM users WHERE clerk_user_id = ?",
            (clerk_user_id,),
        )
        return _user_from_row(row) if row is not None else None

    def get_preferences(self, clerk_user_id: str) -> UserPreferences:
        row = self._database.query_one(
            """
            SELECT p.theme, p.speech_voice, p.version
            FROM preferences AS p
            JOIN users AS u ON u.id = p.user_id
            WHERE u.clerk_user_id = ?
            """,
            (clerk_user_id,),
        )
        if row is None:
            return UserPreferences()
        return UserPreferences(
            theme=str(row["theme"]),
            speech_voice=str(row["speech_voice"]),
            version=int(row["version"]),
        )

    def save_preferences(
        self,
        clerk_user_id: str,
        preferences: UserPreferences,
    ) -> UserPreferences:
        if preferences.theme not in {"light", "dark"}:
            raise ValueError("Unsupported theme.")
        with self._database.transaction(immediate=True) as connection:
            user = connection.execute(
                "SELECT id FROM users WHERE clerk_user_id = ?",
                (clerk_user_id,),
            ).fetchone()
            if user is None:
                raise LookupError("Authenticated user has not been persisted.")
            current = connection.execute(
                "SELECT version FROM preferences WHERE user_id = ?",
                (user["id"],),
            ).fetchone()
            current_version = int(current["version"]) if current is not None else 0
            if preferences.version != current_version:
                raise PreferenceConflictError("Preferences changed in another session.")
            next_version = current_version + 1
            connection.execute(
                """
                INSERT INTO preferences(user_id, theme, speech_voice, version)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    theme = excluded.theme,
                    speech_voice = excluded.speech_voice,
                    version = excluded.version,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                """,
                (user["id"], preferences.theme, preferences.speech_voice, next_version),
            )
        return UserPreferences(
            theme=preferences.theme,
            speech_voice=preferences.speech_voice,
            version=next_version,
        )


def _user_from_row(row: Row) -> UserRecord:
    return UserRecord(
        id=str(row["id"]),
        clerk_user_id=str(row["clerk_user_id"]),
        created_at=str(row["created_at"]),
    )
