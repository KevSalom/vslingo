"""Normalized, secret-free readiness information for provider integrations."""

from dataclasses import dataclass

from app.core.config import Settings


@dataclass(frozen=True, slots=True)
class ProviderReadiness:
    """Public readiness state for one external provider."""

    name: str
    configured: bool


def get_provider_readiness(settings: Settings) -> tuple[ProviderReadiness, ...]:
    """Return stable provider readiness without exposing credential values."""

    return (
        ProviderReadiness("openrouter", settings.openrouter_configured),
        ProviderReadiness("aws_polly", settings.aws_polly_configured),
        ProviderReadiness("edge_tts", settings.edge_tts_configured),
    )
