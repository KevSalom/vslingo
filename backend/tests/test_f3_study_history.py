import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.auth import AuthIdentity, FakeAuthenticator
from app.core.config import Settings
from app.main import create_app
from app.persistence.database import Database

AUTH_A = {"Authorization": "Bearer token-a"}
AUTH_B = {"Authorization": "Bearer token-b"}


def _client(tmp_path: Path) -> TestClient:
    path = tmp_path / "history.db"
    return TestClient(
        create_app(
            Settings(_env_file=None, environment="test", database_path=path),
            database=Database(path),
            authenticator=FakeAuthenticator(
                {
                    "token-a": AuthIdentity("user_a", "session_a"),
                    "token-b": AuthIdentity("user_b", "session_b"),
                }
            ),
        )
    )


def test_history_schema_contains_no_audio_payload_columns(tmp_path: Path) -> None:
    database = Database(tmp_path / "history.db")
    database.migrate()

    assert database.applied_migrations() == (1, 2, 3, 4, 5)
    schema = database.query_one(
        "SELECT group_concat(sql, ' ') AS sql FROM sqlite_master WHERE type = 'table'"
    )
    assert schema is not None
    normalized = str(schema["sql"]).lower()
    assert "wav" not in normalized
    assert "mp3" not in normalized
    assert "audio_blob" not in normalized


def test_writing_history_reopens_only_for_its_owner_and_deletes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    payload = {
        "operation_id": "op-writing-a",
        "original_text": "She go yesterday.",
        "corrected_text": "She went yesterday.",
        "has_corrections": True,
        "corrections": [
            {
                "original": "go",
                "corrected": "went",
                "explanation": "Pasado simple.",
                "category": "grammar",
            }
        ],
        "general_feedback": "Buen intento.",
    }

    created = client.post("/api/history/writings", headers=AUTH_A, json=payload)
    assert created.status_code == 201
    entry_id = created.json()["id"]

    own = client.get("/api/history/writings", headers=AUTH_A)
    other = client.get("/api/history/writings", headers=AUTH_B)
    assert [item["id"] for item in own.json()["items"]] == [entry_id]
    assert other.json()["items"] == []
    assert client.get(f"/api/history/writings/{entry_id}", headers=AUTH_B).status_code == 404

    assert client.delete(f"/api/history/writings/{entry_id}", headers=AUTH_A).status_code == 204
    assert client.get(f"/api/history/writings/{entry_id}", headers=AUTH_A).status_code == 404


def test_video_and_note_are_reopened_without_charging_or_refetching(tmp_path: Path) -> None:
    client = _client(tmp_path)
    video = client.post(
        "/api/history/videos",
        headers=AUTH_A,
        json={
            "video_id": "aircAruvnKk",
            "source": "youtube",
            "title": "Neural networks",
            "url": "https://www.youtube.com/watch?v=aircAruvnKk",
            "segments": [{"text": "Patterns.", "start": 0, "duration": 2.5}],
        },
    )
    assert video.status_code == 201
    saved_video_id = video.json()["id"]

    note = client.post(
        "/api/history/notes",
        headers=AUTH_A,
        json={
            "video_id": saved_video_id,
            "title": "Idea",
            "text": "Layers transform patterns.",
            "timestamp": 1.25,
        },
    )
    assert note.status_code == 201

    reopened = client.get(f"/api/history/videos/{saved_video_id}", headers=AUTH_A)
    assert reopened.status_code == 200
    assert reopened.json()["segments"][0]["text"] == "Patterns."
    notes = client.get(
        "/api/history/notes",
        headers=AUTH_A,
        params={"video_id": saved_video_id},
    )
    assert notes.json()["items"][0]["text"] == "Layers transform patterns."
    assert client.get(f"/api/history/videos/{saved_video_id}", headers=AUTH_B).status_code == 404
    assert client.post(
        "/api/history/notes",
        headers=AUTH_B,
        json={"video_id": saved_video_id, "title": "Intrusion", "text": "No", "timestamp": 0},
    ).status_code == 404


def test_note_conflict_preserves_submitted_version_for_recovery(tmp_path: Path) -> None:
    client = _client(tmp_path)
    created = client.post(
        "/api/history/notes",
        headers=AUTH_A,
        json={
            "client_id": "note-client-a",
            "title": "Draft",
            "text": "First",
            "timestamp": None,
        },
    ).json()
    note_id = created["id"]
    assert note_id == "note-client-a"

    accepted = client.put(
        f"/api/history/notes/{note_id}",
        headers=AUTH_A,
        json={"title": "Draft", "text": "Second", "timestamp": None, "version": 0},
    )
    assert accepted.status_code == 200
    conflict = client.put(
        f"/api/history/notes/{note_id}",
        headers=AUTH_A,
        json={"title": "Draft elsewhere", "text": "Alternate", "timestamp": None, "version": 0},
    )

    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "note_conflict"
    conflict_rows = client.app.state.database.query_one(
        "SELECT submitted_json FROM note_conflicts WHERE note_id = ?", (note_id,)
    )
    assert conflict_rows is not None
    assert json.loads(conflict_rows["submitted_json"])["text"] == "Alternate"


def test_late_voice_feedback_cannot_recreate_a_deleted_conversation(tmp_path: Path) -> None:
    client = _client(tmp_path)
    conversation = client.post(
        "/api/history/conversations",
        headers=AUTH_A,
        json={"scenario": "free"},
    )
    assert conversation.status_code == 201
    conversation_id = conversation.json()["id"]
    turn = client.post(
        f"/api/history/conversations/{conversation_id}/turns",
        headers=AUTH_A,
        json={
            "operation_id": "voice-op-a",
            "user_text": "I deployed it.",
            "assistant_text": "That sounds great.",
        },
    )
    assert turn.status_code == 201
    turn_id = turn.json()["id"]
    reopened = client.get(
        f"/api/history/conversations/{conversation_id}", headers=AUTH_A
    )
    assert reopened.json()["turns"][0]["assistant_text"] == "That sounds great."
    assert client.get(
        f"/api/history/conversations/{conversation_id}", headers=AUTH_B
    ).status_code == 404

    assert client.delete(
        f"/api/history/conversations/{conversation_id}", headers=AUTH_A
    ).status_code == 204
    late = client.patch(
        f"/api/history/turns/{turn_id}/feedback",
        headers=AUTH_A,
        json={
            "feedback": {
                "summary_es": "Feedback tardío.",
                "strengths": [],
                "corrections": [],
                "vocabulary": [],
            }
        },
    )
    assert late.status_code == 404
    assert client.get("/api/history/conversations", headers=AUTH_A).json()["items"] == []


def test_history_validation_uses_its_own_public_error(tmp_path: Path) -> None:
    response = _client(tmp_path).post(
        "/api/history/conversations",
        headers=AUTH_A,
        json={"scenario": "not-an-approved-scenario"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_history_request"


def test_voice_resume_uses_ticket_owner_not_a_client_conversation_id(tmp_path: Path) -> None:
    client = _client(tmp_path)
    conversation_id = client.post(
        "/api/history/conversations",
        headers=AUTH_A,
        json={"scenario": "free"},
    ).json()["id"]
    ticket_b = client.post("/api/session/ws-ticket", headers=AUTH_B).json()["ticket"]

    with client.websocket_connect(
        f"/api/voice/ws?ticket={ticket_b}",
        headers={"origin": "http://localhost:4321"},
    ) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "protocol_version": 2,
                "conversation_id": conversation_id,
            }
        )
        denied = websocket.receive_json()

    assert denied["type"] == "error"
    assert denied["code"] == "history_not_found"
    assert denied["fatal"] is True
