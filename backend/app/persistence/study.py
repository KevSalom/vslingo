"""User-scoped study history with idempotency and optimistic note recovery."""

import json
from sqlite3 import IntegrityError, Row
from typing import Any, cast
from uuid import uuid4

from app.domain.voice_protocol import ScenarioType
from app.persistence.database import Database


class StudyNotFoundError(LookupError):
    """The requested item does not belong to the authenticated user."""


class NoteConflictError(RuntimeError):
    """A submitted note was based on an outdated version and was preserved."""

    def __init__(self, current: dict[str, Any]) -> None:
        super().__init__("Note changed in another session.")
        self.current = current


class StudyRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def create_writing(self, clerk_user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            entry_id = str(uuid4())
            connection.execute(
                """
                INSERT INTO writing_entries(
                    id, user_id, operation_id, original_text, corrected_text,
                    has_corrections, corrections_json, general_feedback
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, operation_id) DO NOTHING
                """,
                (
                    entry_id,
                    user_id,
                    payload["operation_id"],
                    payload["original_text"],
                    payload["corrected_text"],
                    int(payload["has_corrections"]),
                    json.dumps(payload["corrections"], ensure_ascii=False),
                    payload["general_feedback"],
                ),
            )
            row = connection.execute(
                """
                SELECT * FROM writing_entries
                WHERE user_id = ? AND operation_id = ?
                """,
                (user_id, payload["operation_id"]),
            ).fetchone()
        assert row is not None
        return _writing(row)

    def list_writings(self, clerk_user_id: str, limit: int) -> list[dict[str, Any]]:
        return self._list(
            """
            SELECT w.* FROM writing_entries AS w JOIN users AS u ON u.id = w.user_id
            WHERE u.clerk_user_id = ? ORDER BY w.created_at DESC, w.id DESC LIMIT ?
            """,
            clerk_user_id,
            limit,
            _writing,
        )

    def get_writing(self, clerk_user_id: str, entry_id: str) -> dict[str, Any]:
        row = self._database.query_one(
            """
            SELECT w.* FROM writing_entries AS w JOIN users AS u ON u.id = w.user_id
            WHERE u.clerk_user_id = ? AND w.id = ?
            """,
            (clerk_user_id, entry_id),
        )
        if row is None:
            raise StudyNotFoundError
        return _writing(row)

    def delete_writing(self, clerk_user_id: str, entry_id: str) -> None:
        self._delete_owned("writing_entries", clerk_user_id, entry_id)

    def save_video(self, clerk_user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            connection.execute(
                """
                INSERT INTO saved_videos(id, user_id, source, video_id, title, url, segments_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, source, video_id) DO UPDATE SET
                    title = excluded.title,
                    url = excluded.url,
                    segments_json = excluded.segments_json,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                """,
                (
                    str(uuid4()),
                    user_id,
                    payload["source"],
                    payload["video_id"],
                    payload["title"],
                    payload["url"],
                    json.dumps(payload["segments"], ensure_ascii=False),
                ),
            )
            row = connection.execute(
                """SELECT * FROM saved_videos
                WHERE user_id = ? AND source = ? AND video_id = ?""",
                (user_id, payload["source"], payload["video_id"]),
            ).fetchone()
        assert row is not None
        return _video(row)

    def list_videos(self, clerk_user_id: str, limit: int) -> list[dict[str, Any]]:
        return self._list(
            """
            SELECT v.* FROM saved_videos AS v JOIN users AS u ON u.id = v.user_id
            WHERE u.clerk_user_id = ? ORDER BY v.updated_at DESC, v.id DESC LIMIT ?
            """,
            clerk_user_id,
            limit,
            _video,
        )

    def get_video(self, clerk_user_id: str, video_id: str) -> dict[str, Any]:
        row = self._database.query_one(
            """
            SELECT v.* FROM saved_videos AS v JOIN users AS u ON u.id = v.user_id
            WHERE u.clerk_user_id = ? AND v.id = ?
            """,
            (clerk_user_id, video_id),
        )
        if row is None:
            raise StudyNotFoundError
        return _video(row)

    def delete_video(self, clerk_user_id: str, video_id: str) -> None:
        self._delete_owned("saved_videos", clerk_user_id, video_id)

    def create_note(self, clerk_user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            note_id = payload.get("client_id") or str(uuid4())
            try:
                connection.execute(
                    """
                    INSERT INTO notes(id, user_id, video_id, title, text, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        note_id,
                        user_id,
                        payload.get("video_id"),
                        payload["title"],
                        payload["text"],
                        payload.get("timestamp"),
                    ),
                )
            except IntegrityError as exc:
                existing = connection.execute(
                    "SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)
                ).fetchone()
                if existing is None:
                    raise StudyNotFoundError from exc
                return _note(existing)
            row = connection.execute(
                "SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)
            ).fetchone()
        assert row is not None
        return _note(row)

    def list_notes(
        self, clerk_user_id: str, limit: int, video_id: str | None
    ) -> list[dict[str, Any]]:
        sql = """
            SELECT n.* FROM notes AS n JOIN users AS u ON u.id = n.user_id
            WHERE u.clerk_user_id = ?
        """
        parameters: tuple[Any, ...]
        if video_id is None:
            sql += " ORDER BY n.updated_at DESC, n.id DESC LIMIT ?"
            parameters = (clerk_user_id, limit)
        else:
            sql += " AND n.video_id = ? ORDER BY n.updated_at DESC, n.id DESC LIMIT ?"
            parameters = (clerk_user_id, video_id, limit)
        rows = self._database.query_all(sql, parameters)
        return [_note(row) for row in rows]

    def update_note(
        self, clerk_user_id: str, note_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        conflict: dict[str, Any] | None = None
        updated: Row | None = None
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            row = connection.execute(
                "SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)
            ).fetchone()
            if row is None:
                raise StudyNotFoundError
            if int(row["version"]) != payload["version"]:
                connection.execute(
                    """
                    INSERT INTO note_conflicts(id, note_id, user_id, base_version, submitted_json)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid4()),
                        note_id,
                        user_id,
                        payload["version"],
                        json.dumps(payload, ensure_ascii=False),
                    ),
                )
                conflict = _note(row)
            else:
                connection.execute(
                    """
                    UPDATE notes SET title = ?, text = ?, timestamp = ?, version = version + 1,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE id = ? AND user_id = ?
                    """,
                    (
                        payload["title"],
                        payload["text"],
                        payload.get("timestamp"),
                        note_id,
                        user_id,
                    ),
                )
                updated = connection.execute(
                    "SELECT * FROM notes WHERE id = ?", (note_id,)
                ).fetchone()
        if conflict is not None:
            raise NoteConflictError(conflict)
        assert updated is not None
        return _note(updated)

    def delete_note(self, clerk_user_id: str, note_id: str) -> None:
        self._delete_owned("notes", clerk_user_id, note_id)

    def create_conversation(self, clerk_user_id: str, scenario: str) -> dict[str, Any]:
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            conversation_id = str(uuid4())
            title = scenario.replace("_", " ").strip().capitalize() or "Conversación"
            connection.execute(
                """INSERT INTO voice_conversations(id, user_id, scenario, title)
                VALUES (?, ?, ?, ?)""",
                (conversation_id, user_id, scenario, title),
            )
            row = connection.execute(
                "SELECT * FROM voice_conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
        assert row is not None
        return _conversation(row)

    def list_conversations(self, clerk_user_id: str, limit: int) -> list[dict[str, Any]]:
        return self._list(
            """
            SELECT c.* FROM voice_conversations AS c JOIN users AS u ON u.id = c.user_id
            WHERE u.clerk_user_id = ? ORDER BY c.updated_at DESC, c.id DESC LIMIT ?
            """,
            clerk_user_id,
            limit,
            _conversation,
        )

    def get_conversation(self, clerk_user_id: str, conversation_id: str) -> dict[str, Any]:
        row = self._database.query_one(
            """
            SELECT c.* FROM voice_conversations AS c JOIN users AS u ON u.id = c.user_id
            WHERE u.clerk_user_id = ? AND c.id = ?
            """,
            (clerk_user_id, conversation_id),
        )
        if row is None:
            raise StudyNotFoundError
        conversation = _conversation(row)
        turns = self._database.query_all(
            "SELECT * FROM voice_turns WHERE conversation_id = ? ORDER BY sequence",
            (conversation_id,),
        )
        conversation["turns"] = [_turn(turn) for turn in turns]
        return conversation

    def load_voice_context(
        self, clerk_user_id: str, conversation_id: str
    ) -> tuple[ScenarioType, list[tuple[str, str]]]:
        conversation = self.get_conversation(clerk_user_id, conversation_id)
        turns = conversation["turns"]
        assert isinstance(turns, list)
        return (
            cast(ScenarioType, conversation["scenario"]),
            [
                (str(turn["user_text"]), str(turn["assistant_text"]))
                for turn in turns[-6:]
            ],
        )

    def add_turn(
        self, clerk_user_id: str, conversation_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            owner = connection.execute(
                "SELECT id FROM voice_conversations WHERE id = ? AND user_id = ?",
                (conversation_id, user_id),
            ).fetchone()
            if owner is None:
                raise StudyNotFoundError
            existing = connection.execute(
                "SELECT * FROM voice_turns WHERE user_id = ? AND operation_id = ?",
                (user_id, payload["operation_id"]),
            ).fetchone()
            if existing is not None:
                return _turn(existing)
            sequence = int(
                connection.execute(
                    """SELECT coalesce(max(sequence), 0) + 1
                    FROM voice_turns WHERE conversation_id = ?""",
                    (conversation_id,),
                ).fetchone()[0]
            )
            turn_id = str(uuid4())
            connection.execute(
                """
                INSERT INTO voice_turns(
                    id, conversation_id, user_id, sequence, operation_id,
                    user_text, assistant_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    turn_id,
                    conversation_id,
                    user_id,
                    sequence,
                    payload["operation_id"],
                    payload["user_text"],
                    payload["assistant_text"],
                ),
            )
            connection.execute(
                """UPDATE voice_conversations
                SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?""",
                (conversation_id,),
            )
            row = connection.execute(
                "SELECT * FROM voice_turns WHERE id = ?", (turn_id,)
            ).fetchone()
        assert row is not None
        return _turn(row)

    def update_feedback(
        self, clerk_user_id: str, turn_id: str, feedback: dict[str, Any]
    ) -> dict[str, Any]:
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            updated = connection.execute(
                """UPDATE voice_turns SET feedback_json = ?
                WHERE id = ? AND user_id = ?""",
                (json.dumps(feedback, ensure_ascii=False), turn_id, user_id),
            )
            if updated.rowcount != 1:
                raise StudyNotFoundError
            row = connection.execute(
                "SELECT * FROM voice_turns WHERE id = ?", (turn_id,)
            ).fetchone()
        assert row is not None
        return _turn(row)

    def delete_conversation(self, clerk_user_id: str, conversation_id: str) -> None:
        self._delete_owned("voice_conversations", clerk_user_id, conversation_id)

    def _delete_owned(self, table: str, clerk_user_id: str, item_id: str) -> None:
        if table not in {"writing_entries", "saved_videos", "notes", "voice_conversations"}:
            raise ValueError("Unsupported table.")
        with self._database.transaction(immediate=True) as connection:
            user_id = _user_id(connection, clerk_user_id)
            deleted = connection.execute(
                f"DELETE FROM {table} WHERE id = ? AND user_id = ?", (item_id, user_id)
            )
            if deleted.rowcount != 1:
                raise StudyNotFoundError

    def _list(
        self,
        sql: str,
        clerk_user_id: str,
        limit: int,
        mapper: Any,
    ) -> list[dict[str, Any]]:
        rows = self._database.query_all(sql, (clerk_user_id, limit))
        return [mapper(row) for row in rows]


def _user_id(connection: Any, clerk_user_id: str) -> str:
    row = connection.execute(
        "SELECT id FROM users WHERE clerk_user_id = ?", (clerk_user_id,)
    ).fetchone()
    if row is None:
        raise StudyNotFoundError
    return str(row["id"])


def _writing(row: Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "operation_id": str(row["operation_id"]),
        "original_text": str(row["original_text"]),
        "corrected_text": str(row["corrected_text"]),
        "has_corrections": bool(row["has_corrections"]),
        "corrections": json.loads(row["corrections_json"]),
        "general_feedback": str(row["general_feedback"]),
        "created_at": str(row["created_at"]),
    }


def _video(row: Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "video_id": str(row["video_id"]),
        "source": str(row["source"]),
        "title": str(row["title"]),
        "url": str(row["url"]),
        "segments": json.loads(row["segments_json"]),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def _note(row: Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "video_id": str(row["video_id"]) if row["video_id"] is not None else None,
        "title": str(row["title"]),
        "text": str(row["text"]),
        "timestamp": float(row["timestamp"]) if row["timestamp"] is not None else None,
        "version": int(row["version"]),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def _conversation(row: Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "scenario": str(row["scenario"]),
        "title": str(row["title"]),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def _turn(row: Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "conversation_id": str(row["conversation_id"]),
        "sequence": int(row["sequence"]),
        "operation_id": str(row["operation_id"]),
        "user_text": str(row["user_text"]),
        "assistant_text": str(row["assistant_text"]),
        "feedback": json.loads(row["feedback_json"]) if row["feedback_json"] else None,
        "created_at": str(row["created_at"]),
    }
