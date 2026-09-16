"""Consistent SQLite backup and isolated restore verification commands."""

import argparse
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from app.core.config import Settings


def create_backup(source: Path, output: Path) -> dict[str, object]:
    source = source.resolve()
    output = output.resolve()
    if not source.is_file():
        raise FileNotFoundError("The configured database does not exist.")
    if output.exists():
        raise FileExistsError("Backup output already exists.")
    if source == output:
        raise ValueError("Backup output must differ from the live database.")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{uuid4().hex}.tmp")
    try:
        with closing(sqlite3.connect(source)) as live, closing(
            sqlite3.connect(temporary)
        ) as destination:
            live.backup(destination)
        os.chmod(temporary, 0o600)
        summary = verify_database(temporary)
        temporary.replace(output)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return {"status": "created", "path": str(output), **summary}


def restore_and_verify(backup: Path, target: Path) -> dict[str, object]:
    backup = backup.resolve()
    target = target.resolve()
    if not backup.is_file():
        raise FileNotFoundError("Backup file does not exist.")
    if target.exists():
        raise FileExistsError("Restore target already exists.")
    if backup == target:
        raise ValueError("Restore target must differ from the backup.")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with closing(sqlite3.connect(backup)) as source, closing(
            sqlite3.connect(target)
        ) as destination:
            source.backup(destination)
        os.chmod(target, 0o600)
        summary = verify_database(target)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return {"status": "restored_verified", "path": str(target), **summary}


def verify_database(path: Path) -> dict[str, object]:
    with closing(sqlite3.connect(path)) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        migrations = connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        ).fetchall()
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    if integrity is None or integrity[0] != "ok":
        raise RuntimeError("SQLite integrity check failed.")
    if foreign_key_errors:
        raise RuntimeError("SQLite foreign key check failed.")
    required = {"users", "usage_periods", "payments", "marketing_outbox"}
    if not required.issubset(tables):
        raise RuntimeError("Backup does not contain the commercial schema.")
    return {
        "integrity": "ok",
        "migration_versions": [int(row[0]) for row in migrations],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    backup_parser = subparsers.add_parser("backup")
    backup_parser.add_argument("--output", type=Path, required=True)
    restore_parser = subparsers.add_parser("restore-verify")
    restore_parser.add_argument("--backup", type=Path, required=True)
    restore_parser.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    settings = Settings()
    result = (
        create_backup(settings.database_path, args.output)
        if args.command == "backup"
        else restore_and_verify(args.backup, args.target)
    )
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
