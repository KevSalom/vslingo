"""Single typed source of truth for the commercial offer and usage limits."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.core.config import Settings


class UsageLimits(BaseModel):
    model_config = ConfigDict(frozen=True)

    voice_seconds: int
    voice_turns: int
    writings: int
    videos: int


class ContentLimits(BaseModel):
    model_config = ConfigDict(frozen=True)

    writing_max_chars: int = 1_000
    note_max_chars: int = 2_000
    voice_max_input_seconds: int = 60
    voice_context_pairs: int = 6
    voice_context_max_chars: int = 12_000
    voice_max_reply_chars: int = 600
    voice_max_session_seconds: int = 900
    voice_max_session_turns: int = 30


class ProductConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    config_version: int
    plan_code: str
    currency: Literal["USD"]
    price_minor: int
    trial: UsageLimits
    monthly: UsageLimits
    content: ContentLimits

    @classmethod
    def from_settings(cls, settings: Settings) -> "ProductConfig":
        return cls(
            config_version=settings.product_config_version,
            plan_code=settings.product_plan_code,
            currency=settings.product_currency,
            price_minor=settings.product_price_minor,
            trial=UsageLimits(
                voice_seconds=settings.trial_voice_seconds,
                voice_turns=settings.trial_voice_turns,
                writings=settings.trial_writings,
                videos=settings.trial_videos,
            ),
            monthly=UsageLimits(
                voice_seconds=settings.monthly_voice_seconds,
                voice_turns=settings.monthly_voice_turns,
                writings=settings.monthly_writings,
                videos=settings.monthly_videos,
            ),
            content=ContentLimits(
                voice_max_input_seconds=settings.max_audio_seconds,
                voice_max_session_seconds=settings.max_voice_session_seconds,
                voice_max_session_turns=settings.max_voice_turns,
            ),
        )
