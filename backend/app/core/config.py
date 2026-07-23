"""Typed application settings with safe local defaults."""

from pydantic import AliasChoices, AnyHttpUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables or ``.env``."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )

    environment: str = Field(
        default="development",
        validation_alias=AliasChoices("APP_ENV", "environment"),
    )
    frontend_origin: AnyHttpUrl = Field(default=AnyHttpUrl("http://localhost:4321"))

    openrouter_api_key: SecretStr | None = None
    openrouter_stt_model: str = "openai/whisper-large-v3-turbo"
    openrouter_llm_model: str = ""
    openrouter_base_url: AnyHttpUrl = Field(
        default=AnyHttpUrl("https://openrouter.ai/api/v1")
    )

    aws_access_key_id: SecretStr | None = None
    aws_secret_access_key: SecretStr | None = None
    aws_region: str = "us-east-1"
    aws_polly_voice_id: str = "Matthew"

    edge_tts_voice: str = "en-US-GuyNeural"
    provider_timeout_seconds: float = Field(default=30.0, gt=0.0, le=120.0)

    @property
    def openrouter_configured(self) -> bool:
        """Return whether an OpenRouter API key is available."""

        return self._secret_is_set(self.openrouter_api_key)

    @property
    def aws_polly_configured(self) -> bool:
        """Return whether both AWS credentials required by Polly are available."""

        return self._secret_is_set(self.aws_access_key_id) and self._secret_is_set(
            self.aws_secret_access_key
        )

    @property
    def edge_tts_configured(self) -> bool:
        """Return whether the Edge voice identifier is configured."""

        return bool(self.edge_tts_voice.strip())

    @staticmethod
    def _secret_is_set(secret: SecretStr | None) -> bool:
        return secret is not None and bool(secret.get_secret_value().strip())
