"""Explicit asynchronous boundaries for external AI and speech providers."""

from collections.abc import AsyncIterator, Sequence
from typing import Protocol, runtime_checkable

from app.domain.models import ChatMessage, SynthesizedSpeech, Transcription
from app.domain.video import TranscriptResult
from app.domain.writing import CorrectionResult


@runtime_checkable
class SpeechToTextPort(Protocol):
    """Transcribe one complete audio segment."""

    async def transcribe(self, audio: bytes, *, media_type: str) -> Transcription:
        """Return normalized text for ``audio``."""


@runtime_checkable
class CorrectionProviderPort(Protocol):
    """Return one structured correction for an English text."""

    async def correct(self, text: str) -> CorrectionResult:
        """Return a provider-neutral structured correction."""


@runtime_checkable
class TranscriptProviderPort(Protocol):
    """Return normalized timed captions for one YouTube video ID."""

    async def fetch(self, video_id: str) -> TranscriptResult:
        """Return a provider-neutral transcript."""


@runtime_checkable
class LanguageModelPort(Protocol):
    """Stream conversational text from a provider-neutral message list."""

    def stream_chat(self, messages: Sequence[ChatMessage]) -> AsyncIterator[str]:
        """Yield normalized text fragments in provider order."""


@runtime_checkable
class SpeechSynthesizerPort(Protocol):
    """Synthesize one text segment as MP3 without implicit fallback."""

    async def synthesize(self, text: str, *, voice: str | None = None) -> SynthesizedSpeech:
        """Return MP3 bytes for ``text``."""
