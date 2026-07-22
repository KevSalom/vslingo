from pydantic import SecretStr

from app.core.config import Settings


def test_settings_have_safe_local_defaults() -> None:
    settings = Settings(_env_file=None)

    assert settings.environment == "development"
    assert str(settings.frontend_origin) == "http://localhost:4321/"
    assert settings.openrouter_stt_model == "openai/whisper-large-v3-turbo"
    assert settings.openrouter_configured is False
    assert settings.aws_polly_configured is False
    assert settings.edge_tts_configured is True


def test_provider_readiness_only_depends_on_complete_credentials() -> None:
    settings = Settings(
        _env_file=None,
        openrouter_api_key=SecretStr("openrouter-secret"),
        aws_access_key_id=SecretStr("aws-key"),
        aws_secret_access_key=SecretStr("aws-secret"),
    )

    assert settings.openrouter_configured is True
    assert settings.aws_polly_configured is True
