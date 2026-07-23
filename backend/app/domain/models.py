"""Small immutable values exchanged through provider ports."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class Transcription:
    """Normalized speech-to-text result."""

    text: str
    duration_seconds: float | None = None
    cost_usd: float | None = None


@dataclass(frozen=True, slots=True)
class ChatMessage:
    """Provider-neutral chat message."""

    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True, slots=True)
class SynthesizedSpeech:
    """Normalized synthesized audio returned by a TTS provider."""

    audio: bytes
    media_type: Literal["audio/mpeg"] = "audio/mpeg"
