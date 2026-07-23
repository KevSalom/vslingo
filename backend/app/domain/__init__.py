"""Provider-independent domain contracts."""

from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.models import ChatMessage, SynthesizedSpeech, Transcription
from app.domain.ports import (
    LanguageModelPort,
    SpeechSynthesizerPort,
    SpeechToTextPort,
)

__all__ = [
    "ChatMessage",
    "IntegrationError",
    "IntegrationErrorCode",
    "LanguageModelPort",
    "SpeechSynthesizerPort",
    "SpeechToTextPort",
    "SynthesizedSpeech",
    "Transcription",
]
