from pathlib import Path

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.auth import AuthIdentity, ClerkAuthenticator, FakeAuthenticator
from app.core.config import Settings
from app.main import create_app
from app.persistence.database import Database
from app.persistence.identity import IdentityRepository, UserPreferences

AUTH_A = {"Authorization": "Bearer token-a"}
AUTH_B = {"Authorization": "Bearer token-b"}


def _authenticator() -> FakeAuthenticator:
    return FakeAuthenticator(
        {
            "token-a": AuthIdentity(user_id="user_a", session_id="session_a"),
            "token-b": AuthIdentity(user_id="user_b", session_id="session_b"),
        }
    )


def _settings(path: Path) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        database_path=path,
        frontend_origin="http://localhost:4321",
    )


def test_fake_auth_starts_without_secrets_but_is_forbidden_in_production() -> None:
    settings = Settings(_env_file=None, environment="development", auth_mode="fake")

    assert settings.auth_mode == "fake"
    assert settings.clerk_configured is False

    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            environment="production",
            frontend_origin="https://english.example",
            auth_mode="fake",
        )


def test_clerk_mode_requires_networkless_verification_and_revocation_keys() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="test", auth_mode="clerk")

    settings = Settings(
        _env_file=None,
        environment="test",
        auth_mode="clerk",
        clerk_secret_key="sk_test_secret",
        clerk_jwt_key="public-key",
    )

    assert settings.clerk_configured is True
    assert settings.clerk_authorized_parties == ("http://localhost:4321",)


def test_sqlite_migrates_with_required_pragmas_and_persists_users(tmp_path: Path) -> None:
    path = tmp_path / "identity.db"
    first = Database(path)
    first.migrate()
    repository = IdentityRepository(first)
    created = repository.ensure_user("user_a")

    assert first.applied_migrations() == (1,)
    assert first.pragma("foreign_keys") == 1
    assert str(first.pragma("journal_mode")).lower() == "wal"
    assert first.pragma("busy_timeout") == 5_000
    first.close()

    reopened = Database(path)
    reopened.migrate()
    persisted = IdentityRepository(reopened).get_user("user_a")

    assert persisted == created
    reopened.close()


def test_preferences_are_isolated_by_authenticated_user(tmp_path: Path) -> None:
    database = Database(tmp_path / "identity.db")
    database.migrate()
    repository = IdentityRepository(database)
    repository.ensure_user("user_a")
    repository.ensure_user("user_b")

    saved = repository.save_preferences(
        "user_a",
        UserPreferences(theme="dark", speech_voice="en-GB-SoniaNeural", version=0),
    )

    assert saved.version == 1
    assert repository.get_preferences("user_a") == saved
    assert repository.get_preferences("user_b") == UserPreferences()
    database.close()


def test_session_api_blocks_anonymous_and_does_not_accept_client_user_ids(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "identity.db")
    app = create_app(
        _settings(tmp_path / "identity.db"),
        database=database,
        authenticator=_authenticator(),
    )
    client = TestClient(app)

    anonymous = client.get("/api/session")
    authenticated = client.get("/api/session", headers=AUTH_A)
    forged = client.get("/api/session?user_id=user_b", headers=AUTH_A)

    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "authentication_required"
    assert authenticated.status_code == 200
    assert authenticated.json() == {
        "user_id": "user_a",
        "session_id": "session_a",
        "auth_mode": "fake",
    }
    assert forged.json()["user_id"] == "user_a"


def test_preferences_api_keeps_a_separate_from_b(tmp_path: Path) -> None:
    path = tmp_path / "identity.db"
    client = TestClient(
        create_app(_settings(path), database=Database(path), authenticator=_authenticator())
    )

    update = client.put(
        "/api/preferences",
        headers=AUTH_A,
        json={"theme": "dark", "speech_voice": "en-GB-SoniaNeural", "version": 0},
    )
    user_b = client.get("/api/preferences", headers=AUTH_B)

    assert update.status_code == 200
    assert update.json()["version"] == 1
    assert user_b.status_code == 200
    assert user_b.json() == {
        "theme": "light",
        "speech_voice": "en-US-AriaNeural",
        "version": 0,
    }


def test_logout_revokes_fake_session_and_its_outstanding_tickets(tmp_path: Path) -> None:
    path = tmp_path / "identity.db"
    authenticator = _authenticator()
    client = TestClient(
        create_app(_settings(path), database=Database(path), authenticator=authenticator)
    )
    ticket = client.post("/api/session/ws-ticket", headers=AUTH_A).json()["ticket"]

    logout = client.post("/api/session/logout", headers=AUTH_A)

    assert logout.status_code == 204
    assert client.get("/api/session", headers=AUTH_A).status_code == 401
    assert client.app.state.ws_ticket_repository.consume(ticket) is None


@pytest.mark.asyncio
async def test_clerk_adapter_accepts_only_verified_session_claims() -> None:
    observed: dict[str, object] = {}

    class SignedInState:
        is_signed_in = True
        payload = {"sub": "user_clerk", "sid": "session_clerk"}

    def authenticate(request: object, options: object) -> SignedInState:
        observed["request"] = request
        observed["options"] = options
        return SignedInState()

    async def revoke(session_id: str) -> None:
        observed["revoked"] = session_id

    settings = Settings(
        _env_file=None,
        environment="test",
        auth_mode="clerk",
        clerk_secret_key="sk_test_secret",
        clerk_jwt_key="public-key",
    )
    adapter = ClerkAuthenticator(
        settings,
        authenticate_call=authenticate,
        revoke_call=revoke,
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/session",
            "headers": [(b"authorization", b"Bearer clerk-token")],
        }
    )

    identity = await adapter.authenticate(request)
    await adapter.revoke(identity)

    assert identity == AuthIdentity("user_clerk", "session_clerk")
    options = observed["options"]
    assert options.accepts_token == ["session_token"]
    assert options.authorized_parties == ["http://localhost:4321"]
    assert observed["revoked"] == "session_clerk"


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("post", "/api/writing/correct", {"text": "This is correct."}),
        ("post", "/api/video/transcript", {"url": "https://youtu.be/aircAruvnKk"}),
        (
            "post",
            "/api/speech",
            {"text": "Hello", "provider": "edge_tts"},
        ),
    ],
)
def test_provider_operations_reject_anonymous_before_calling_providers(
    tmp_path: Path,
    method: str,
    path: str,
    payload: dict[str, str],
) -> None:
    database_path = tmp_path / "identity.db"
    client = TestClient(
        create_app(
            _settings(database_path),
            database=Database(database_path),
            authenticator=_authenticator(),
        )
    )

    response = getattr(client, method)(path, json=payload)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"
