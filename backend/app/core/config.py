"""Typed application settings with safe local defaults and bounded protections."""

from pydantic import AliasChoices, AnyHttpUrl, Field, SecretStr, model_validator
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
    provider_acquire_timeout_seconds: float = Field(default=1.0, gt=0.0, le=120.0)

    max_http_requests_per_minute: int = Field(default=30, ge=1, le=10_000)
    max_speech_requests_per_minute: int = Field(default=10, ge=1, le=10_000)
    max_ws_connections: int = Field(default=20, ge=1, le=1_000)
    max_ws_connections_per_ip: int = Field(default=2, ge=1, le=100)
    max_voice_session_seconds: int = Field(default=900, ge=1, le=3_600)
    max_voice_turns: int = Field(default=30, ge=1, le=100)
    max_audio_seconds: int = Field(default=60, ge=1, le=60)
    max_audio_bytes: int = Field(default=2_000_044, ge=44, le=2_000_044)
    max_concurrent_stt: int = Field(default=4, ge=1, le=100)
    max_concurrent_llm: int = Field(default=8, ge=1, le=100)
    max_concurrent_tts: int = Field(default=4, ge=1, le=100)
    max_concurrent_video: int = Field(default=4, ge=1, le=100)
    polly_usd_per_million_chars: float = Field(default=16.0, gt=0.0, le=1_000.0)

    @model_validator(mode="after")
    def validate_frontend_origin(self) -> "Settings":
        """Allow exactly one canonical browser origin, never a path, list, or wildcard."""

        origin = self.frontend_origin
        if origin.path not in {"", "/"} or origin.query is not None or origin.fragment is not None:
            raise ValueError("FRONTEND_ORIGIN must be an origin without path, query, or fragment.")
        if origin.host is None or "*" in origin.host or "," in str(origin):
            raise ValueError("FRONTEND_ORIGIN must name exactly one concrete host.")
        if self.provider_acquire_timeout_seconds > self.provider_timeout_seconds:
            raise ValueError("PROVIDER_ACQUIRE_TIMEOUT_SECONDS cannot exceed provider timeout.")
        if self.environment.lower() not in {"development", "test"} and origin.scheme != "https":
            raise ValueError("FRONTEND_ORIGIN must use https outside development and test.")
        return self

    @property
    def normalized_frontend_origin(self) -> str:
        """Return scheme/host/port in the normalization used by browser Origin headers."""

        origin = self.frontend_origin
        host = origin.host.lower() if origin.host else ""
        port = origin.port
        if port is not None and not (
            (origin.scheme == "http" and port == 80)
            or (origin.scheme == "https" and port == 443)
        ):
            host = f"{host}:{port}"
        return f"{origin.scheme}://{host}"

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
