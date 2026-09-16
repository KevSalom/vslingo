from pathlib import Path

import pytest

from app.operations.backups import create_backup, restore_and_verify
from app.persistence.database import Database
from app.persistence.identity import IdentityRepository


def test_online_sqlite_backup_and_isolated_restore_are_consistent(tmp_path: Path) -> None:
    live_path = tmp_path / "live.db"
    backup_path = tmp_path / "protected" / "backup.db"
    restored_path = tmp_path / "isolated" / "restored.db"
    database = Database(live_path)
    database.migrate()
    IdentityRepository(database).ensure_user("user_during_wal")

    backup = create_backup(live_path, backup_path)
    restored = restore_and_verify(backup_path, restored_path)
    restored_database = Database(restored_path)

    assert backup["integrity"] == restored["integrity"] == "ok"
    assert backup["migration_versions"] == [1, 2, 3, 4, 5]
    assert IdentityRepository(restored_database).get_user("user_during_wal") is not None
    assert not Path(f"{backup_path}-wal").exists()


def test_backup_and_restore_refuse_overwrite(tmp_path: Path) -> None:
    live_path = tmp_path / "live.db"
    backup_path = tmp_path / "backup.db"
    target_path = tmp_path / "target.db"
    Database(live_path).migrate()
    create_backup(live_path, backup_path)
    target_path.touch()

    with pytest.raises(FileExistsError):
        create_backup(live_path, backup_path)
    with pytest.raises(FileExistsError):
        restore_and_verify(backup_path, target_path)
