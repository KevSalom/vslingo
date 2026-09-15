from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketDenialResponse

from app.core.auth import AuthIdentity, FakeAuthenticator
from app.core.config import Settings
from app.main import create_app
from app.persistence.database import Database
from app.persistence.identity import IdentityRepository
from app.persistence.ws_tickets import WebSocketTicketRepository
from app.providers.fakes import FakeLanguageModel, FakeSpeechToText, FakeVoiceFeedback


def test_ticket_is_opaque_hashed_short_lived_and_single_use(tmp_path: Path) -> None:
    now = [1_700_000_000]
    database = Database(tmp_path / "tickets.db")
    database.migrate()
    users = IdentityRepository(database)
    users.ensure_user("user_a")
    tickets = WebSocketTicketRepository(database, ttl_seconds=30, clock=lambda: now[0])

    issued = tickets.issue("user_a", "session_a")

    assert issued.ticket not in database.dump_table("ws_tickets")
    assert issued.expires_in_seconds == 30
    assert tickets.consume(issued.ticket) is not None
    assert tickets.consume(issued.ticket) is None


def test_expired_ticket_cannot_be_consumed(tmp_path: Path) -> None:
    now = [1_700_000_000]
    database = Database(tmp_path / "tickets.db")
    database.migrate()
    IdentityRepository(database).ensure_user("user_a")
    tickets = WebSocketTicketRepository(database, ttl_seconds=10, clock=lambda: now[0])
    issued = tickets.issue("user_a", "session_a")

    now[0] += 10

    assert tickets.consume(issued.ticket) is None


def test_voice_websocket_requires_and_consumes_rest_ticket_once(tmp_path: Path) -> None:
    path = tmp_path / "tickets.db"
    authenticator = FakeAuthenticator(
        {"token-a": AuthIdentity(user_id="user_a", session_id="session_a")}
    )
    client = TestClient(
        create_app(
            Settings(
                _env_file=None,
                environment="test",
                database_path=path,
                frontend_origin="http://localhost:4321",
            ),
            database=Database(path),
            authenticator=authenticator,
            stt_provider=FakeSpeechToText(),
            llm_provider=FakeLanguageModel(),
            feedback_provider=FakeVoiceFeedback(),
        ),
        headers={"Authorization": "Bearer token-a"},
    )
    issued = client.post("/api/session/ws-ticket")
    ticket = issued.json()["ticket"]
    path_with_ticket = f"/api/voice/ws?ticket={ticket}"

    with client.websocket_connect(
        path_with_ticket,
        headers={"origin": "http://localhost:4321"},
    ) as websocket:
        websocket.send_json({"type": "session.start", "protocol_version": 2})
        assert websocket.receive_json()["type"] == "session.ready"

    with (
        pytest.raises(WebSocketDenialResponse) as denied,
        client.websocket_connect(
            path_with_ticket,
            headers={"origin": "http://localhost:4321"},
        ),
    ):
        pass
    assert denied.value.status_code == 403
