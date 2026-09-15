"""Small transactional SQLite runner with bundled, monotonic migrations."""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from importlib.resources import files
from pathlib import Path
from threading import RLock
from typing import Any, cast


class Database:
    """Own one process-local SQLite connection and serialize its transactions."""

    def __init__(self, path: str | Path, *, busy_timeout_ms: int = 5_000) -> None:
        self.path = Path(path) if str(path) != ":memory:" else Path(":memory:")
        self._busy_timeout_ms = busy_timeout_ms
        self._connection: sqlite3.Connection | None = None
        self._lock = RLock()
        self._migrated = False

    def migrate(self) -> None:
        """Apply each bundled migration exactly once in an immediate transaction."""

        with self._lock:
            connection = self._connect()
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    )
                )
                """
            )
            applied = {
                int(row[0])
                for row in connection.execute("SELECT version FROM schema_migrations")
            }
            migration_root = files("app.migrations")
            migration_names = sorted(
                item.name
                for item in migration_root.iterdir()
                if item.name.endswith(".sql") and item.name[:4].isdigit()
            )
            for name in migration_names:
                version = int(name[:4])
                if version in applied:
                    continue
                sql = migration_root.joinpath(name).read_text(encoding="utf-8")
                try:
                    connection.executescript(
                        f"BEGIN IMMEDIATE;\n{sql}\n"
                        f"INSERT INTO schema_migrations(version) VALUES ({version});\nCOMMIT;"
                    )
                except Exception:
                    if connection.in_transaction:
                        connection.rollback()
                    raise
            self._migrated = True

    @contextmanager
    def transaction(self, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        """Yield the configured connection inside one serialized transaction."""

        self._ensure_migrated()
        with self._lock:
            connection = self._connect()
            connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
            try:
                yield connection
            except Exception:
                connection.rollback()
                raise
            else:
                connection.commit()

    def query_one(self, sql: str, parameters: tuple[Any, ...] = ()) -> sqlite3.Row | None:
        """Return one row outside a caller-managed transaction."""

        self._ensure_migrated()
        with self._lock:
            return cast(sqlite3.Row | None, self._connect().execute(sql, parameters).fetchone())

    def query_all(self, sql: str, parameters: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        """Return rows under the connection lock without exposing the connection."""

        self._ensure_migrated()
        with self._lock:
            rows = self._connect().execute(sql, parameters).fetchall()
            return cast(list[sqlite3.Row], rows)

    def applied_migrations(self) -> tuple[int, ...]:
        """Return applied versions in stable order."""

        self._ensure_migrated()
        with self._lock:
            rows = self._connect().execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            )
            return tuple(int(row[0]) for row in rows)

    def pragma(self, name: str) -> Any:
        """Read one allowlisted SQLite pragma for diagnostics and tests."""

        if name not in {"foreign_keys", "journal_mode", "busy_timeout"}:
            raise ValueError("Unsupported pragma.")
        with self._lock:
            row = self._connect().execute(f"PRAGMA {name}").fetchone()
            return row[0] if row is not None else None

    def dump_table(self, name: str) -> str:
        """Return a test-only JSON representation without interpolating arbitrary tables."""

        if name not in {"users", "preferences", "trial_grants", "ws_tickets"}:
            raise ValueError("Unsupported table.")
        self._ensure_migrated()
        with self._lock:
            rows = self._connect().execute(f"SELECT * FROM {name}").fetchall()
            return json.dumps([dict(row) for row in rows], sort_keys=True)

    def close(self) -> None:
        """Close the owned connection idempotently."""

        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None
                self._migrated = False

    def _ensure_migrated(self) -> None:
        if not self._migrated:
            self.migrate()

    def _connect(self) -> sqlite3.Connection:
        if self._connection is not None:
            return self._connection
        if self.path != Path(":memory:"):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(
            str(self.path),
            timeout=self._busy_timeout_ms / 1_000,
            isolation_level=None,
            check_same_thread=False,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(f"PRAGMA busy_timeout = {self._busy_timeout_ms}")
        if self.path != Path(":memory:"):
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = NORMAL")
        self._connection = connection
        return connection
