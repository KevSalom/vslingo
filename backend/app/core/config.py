"""Typed application settings with safe local defaults and bounded protections."""

from pathlib import Path
from typing import Literal

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

    auth_mode: Literal["fake", "clerk"] = "fake"
    clerk_secret_key: SecretStr | None = None
    clerk_jwt_key: SecretStr | None = None
    clerk_authorized_parties: tuple[str, ...] = ()
    database_path: Path = Path("data/ingles-al-grano.db")
    sqlite_busy_timeout_ms: int = Field(default=5_000, ge=100, le=60_000)
    ws_ticket_ttl_seconds: int = Field(default=30, ge=5, le=120)

    product_config_version: int = Field(default=1, ge=1)
    product_plan_code: str = Field(default="monthly_v1", min_length=1, max_length=64)
    product_currency: Literal["USD"] = "USD"
    product_price_minor: int = Field(default=299, ge=1)
    trial_voice_seconds: int = Field(default=600, ge=1)
    trial_voice_turns: int = Field(default=30, ge=1)
    trial_writings: int = Field(default=10, ge=1)
    trial_videos: int = Field(default=3, ge=1)
    monthly_voice_seconds: int = Field(default=3_600, ge=1)
    monthly_voice_turns: int = Field(default=180, ge=1)
    monthly_writings: int = Field(default=100, ge=1)
    monthly_videos: int = Field(default=20, ge=1)

    billing_mode: Literal["fake", "paypal_sandbox", "paypal_live"] = "fake"
    paypal_client_id: SecretStr | None = None
    paypal_client_secret: SecretStr | None = None
    paypal_webhook_id: str | None = Field(default=None, min_length=1, max_length=128)
    paypal_plan_id: str | None = Field(default=None, min_length=1, max_length=128)
    paypal_merchant_id: str | None = Field(default=None, min_length=1, max_length=128)
    billing_return_url: AnyHttpUrl = Field(
        default=AnyHttpUrl("http://localhost:4321/app/cuenta?billing=return")
    )
    billing_cancel_url: AnyHttpUrl = Field(
        default=AnyHttpUrl("http://localhost:4321/app/cuenta?billing=cancelled")
    )

    openrouter_api_key: SecretStr | None = None
    openrouter_stt_model: str = "openai/whisper-large-v3-turbo"
    openrouter_llm_model: str = "google/gemini-3.1-flash-lite"
    openrouter_base_url: AnyHttpUrl = Field(
        default=AnyHttpUrl("https://openrouter.ai/api/v1")
    )

    edge_tts_voice: str = "en-US-AriaNeural"
    edge_tts_allowed_voices: tuple[str, ...] = (
        "en-US-AriaNeural",
        "en-US-GuyNeural",
        "en-GB-SoniaNeural",
        "en-GB-RyanNeural",
    )
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

    @model_validator(mode="after")
    def validate_runtime_security(self) -> "Settings":
        """Validate origins, auth modes and provider limits as one runtime contract."""

        origin = self.frontend_origin
        if origin.path not in {"", "/"} or origin.query is not None or origin.fragment is not None:
            raise ValueError("FRONTEND_ORIGIN must be an origin without path, query, or fragment.")
        if origin.host is None or "*" in origin.host or "," in str(origin):
            raise ValueError("FRONTEND_ORIGIN must name exactly one concrete host.")
        if self.provider_acquire_timeout_seconds > self.provider_timeout_seconds:
            raise ValueError("PROVIDER_ACQUIRE_TIMEOUT_SECONDS cannot exceed provider timeout.")
        if not self.edge_tts_allowed_voices or len(set(self.edge_tts_allowed_voices)) != len(
            self.edge_tts_allowed_voices
        ):
            raise ValueError("EDGE_TTS_ALLOWED_VOICES must contain unique voice identifiers.")
        if self.edge_tts_voice not in self.edge_tts_allowed_voices:
            raise ValueError("EDGE_TTS_VOICE must be included in EDGE_TTS_ALLOWED_VOICES.")
        if self.environment.lower() not in {"development", "test"} and origin.scheme != "https":
            raise ValueError("FRONTEND_ORIGIN must use https outside development and test.")
        if self.environment.lower() not in {"development", "test"} and self.auth_mode == "fake":
            raise ValueError("AUTH_MODE=fake is allowed only in development and test.")
        if not self.clerk_authorized_parties:
            self.clerk_authorized_parties = (self.normalized_frontend_origin,)
        if any(
            party != self.normalized_frontend_origin
            for party in self.clerk_authorized_parties
        ):
            raise ValueError(
                "CLERK_AUTHORIZED_PARTIES must contain only the configured frontend origin."
            )
        if self.auth_mode == "clerk" and not self.clerk_configured:
            raise ValueError("Clerk mode requires CLERK_SECRET_KEY and CLERK_JWT_KEY.")
        if self.billing_mode != "fake" and not self.paypal_configured:
            raise ValueError(
                "PayPal billing requires client, webhook, plan and merchant configuration."
            )
        if self.environment.lower() not in {"development", "test"} and self.billing_mode == "fake":
            raise ValueError("BILLING_MODE=fake is allowed only in development and test.")
        frontend_target = (origin.scheme, origin.host, origin.port)
        if any(
            (url.scheme, url.host, url.port) != frontend_target
            for url in (self.billing_return_url, self.billing_cancel_url)
        ):
            raise ValueError("Billing return and cancel URLs must use FRONTEND_ORIGIN.")
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
    def edge_tts_configured(self) -> bool:
        """Return whether the Edge voice identifier is configured."""

        return bool(self.edge_tts_voice.strip())

    @property
    def clerk_configured(self) -> bool:
        """Return whether both verification and revocation credentials are present."""

        return self._secret_is_set(self.clerk_secret_key) and self._secret_is_set(
            self.clerk_jwt_key
        )

    @property
    def paypal_configured(self) -> bool:
        """Return whether the selected PayPal environment has its complete binding."""

        return (
            self._secret_is_set(self.paypal_client_id)
            and self._secret_is_set(self.paypal_client_secret)
            and bool(self.paypal_webhook_id and self.paypal_webhook_id.strip())
            and bool(self.paypal_plan_id and self.paypal_plan_id.strip())
            and bool(self.paypal_merchant_id and self.paypal_merchant_id.strip())
        )

    @staticmethod
    def _secret_is_set(secret: SecretStr | None) -> bool:
        return secret is not None and bool(secret.get_secret_value().strip())
