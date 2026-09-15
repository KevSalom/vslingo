from pydantic import SecretStr

from app.core.config import Settings


def test_settings_have_safe_local_defaults() -> None:
    settings = Settings(_env_file=None)

    assert settings.environment == "development"
    assert str(settings.frontend_origin) == "http://localhost:4321/"
    assert settings.openrouter_stt_model == "openai/whisper-large-v3-turbo"
    assert settings.openrouter_configured is False
    assert settings.edge_tts_configured is True
    assert settings.openrouter_llm_model == "google/gemini-3.1-flash-lite"
    assert settings.edge_tts_voice in settings.edge_tts_allowed_voices


def test_provider_readiness_only_depends_on_openrouter_credentials() -> None:
    settings = Settings(
        _env_file=None,
        openrouter_api_key=SecretStr("openrouter-secret"),
    )

    assert settings.openrouter_configured is True
    assert not hasattr(settings, "aws_polly_configured")
