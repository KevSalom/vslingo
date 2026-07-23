"""Deterministic provider adapters used by normal tests and local demos."""

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field

from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.feedback import CorrectionItem, VocabularyItem, VoiceFeedback
from app.domain.models import ChatMessage, SynthesizedSpeech, Transcription
from app.domain.video import (
    TranscriptResult,
    TranscriptSegment,
    TranscriptSource,
    VideoProviderError,
)
from app.domain.writing import CorrectionResult


@dataclass(slots=True)
class FakeSpeechToText:
    """Return a preconfigured transcript without network access."""

    result: Transcription = field(
        default_factory=lambda: Transcription(text="This is a deterministic transcript.")
    )

    async def transcribe(self, audio: bytes, *, media_type: str) -> Transcription:
        if not audio:
            raise IntegrationError(
                "fake_stt",
                IntegrationErrorCode.INVALID_REQUEST,
                "Audio must not be empty.",
            )
        if not media_type.startswith("audio/"):
            raise IntegrationError(
                "fake_stt",
                IntegrationErrorCode.INVALID_REQUEST,
                "An audio media type is required.",
            )
        return self.result


@dataclass(slots=True)
class FakeLanguageModel:
    """Stream fixed chunks so orchestration can be exercised deterministically."""

    chunks: tuple[str, ...] = ("Your explanation ", "is clear.")

    async def stream_chat(self, messages: Sequence[ChatMessage]) -> AsyncIterator[str]:
        if not messages:
            raise IntegrationError(
                "fake_llm",
                IntegrationErrorCode.INVALID_REQUEST,
                "At least one chat message is required.",
            )
        for chunk in self.chunks:
            yield chunk


@dataclass(slots=True)
class FakeCorrectionProvider:
    """Return a configured correction or echo a valid unchanged result."""

    result: CorrectionResult | None = None
    error: IntegrationError | None = None

    async def correct(self, text: str) -> CorrectionResult:
        if self.error is not None:
            raise self.error
        if self.result is not None:
            return self.result
        return CorrectionResult(
            original_text=text,
            corrected_text=text,
            has_corrections=False,
            corrections=(),
            general_feedback="El texto es correcto y natural.",
        )


@dataclass(slots=True)
class FakeTranscriptProvider:
    """Return one scripted transcript without contacting YouTube."""

    result: TranscriptResult = field(
        default_factory=lambda: TranscriptResult(
            video_id="aircAruvnKk",
            source=TranscriptSource.FIXTURE,
            segments=(
                TranscriptSegment(
                    text="A deterministic technical transcript.",
                    start=0.0,
                    duration=3.0,
                ),
            ),
        )
    )
    error: VideoProviderError | None = None
    calls: list[str] = field(default_factory=list, init=False)

    async def fetch(self, video_id: str) -> TranscriptResult:
        self.calls.append(video_id)
        if self.error is not None:
            raise self.error
        return self.result


@dataclass(slots=True)
class FakeSpeechSynthesizer:
    """Return stable MP3-like bytes without contacting a speech service."""

    audio: bytes = b"ID3-vslingo-fake-audio"

    async def synthesize(self, text: str, *, voice: str | None = None) -> SynthesizedSpeech:
        del voice
        if not text.strip():
            raise IntegrationError(
                "fake_tts",
                IntegrationErrorCode.INVALID_REQUEST,
                "Text must not be empty.",
            )
        return SynthesizedSpeech(audio=self.audio)


@dataclass(slots=True)
class FakeVoiceFeedback:
    """Return configured structured feedback or a default valid feedback."""

    result: VoiceFeedback | None = None
    error: Exception | None = None

    async def generate(self, transcript: str, scenario: str) -> VoiceFeedback:
        if self.error is not None:
            raise self.error
        if self.result is not None:
            return self.result
        return VoiceFeedback(
            summary_es="La idea se entiende; buen intento en la respuesta.",
            strengths=["Expresaste tu punto claramente."],
            corrections=[
                CorrectionItem(
                    category="grammar",
                    original=transcript[:100] if transcript else "sample",
                    corrected=transcript[:100] if transcript else "sample",
                    explanation_es="Texto de prueba.",
                )
            ],
            vocabulary=[
                VocabularyItem(
                    term="feedback",
                    meaning_es="retroalimentación",
                    example_en="Thanks for the feedback.",
                )
            ],
        )
