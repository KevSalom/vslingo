from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app


def test_health_reports_readiness_without_leaking_secrets() -> None:
    settings = Settings(
        _env_file=None,
        environment="test",
        openrouter_api_key=SecretStr("super-secret-openrouter"),
    )
    client = TestClient(create_app(settings))

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "Inglés al Grano API",
        "version": "0.1.0",
        "environment": "test",
        "providers": {
            "openrouter": {"configured": True},
            "edge_tts": {"configured": True},
        },
    }
    assert "super-secret" not in response.text


def test_health_works_without_optional_provider_credentials() -> None:
    client = TestClient(create_app(Settings(_env_file=None, environment="test")))

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["providers"]["openrouter"]["configured"] is False
    assert response.json()["providers"]["edge_tts"]["configured"] is True
