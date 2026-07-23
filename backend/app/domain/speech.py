"""Domain models, limits, and error types for Speech (TTS)."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

MAX_SPEECH_TEXT_LENGTH: Final[int] = 3000


class SpeechProvider(StrEnum):
    """Supported speech synthesis providers."""

    AWS_POLLY = "aws_polly"
    EDGE_TTS = "edge_tts"


@dataclass(frozen=True, slots=True)
class SpeechServiceError(Exception):
    """Service-level error with HTTP-mapped error details."""

    code: str
    message: str
    status_code: int = 422
    retryable: bool = False

    def __str__(self) -> str:
        return f"SpeechServiceError(code={self.code!r}, message={self.message!r})"


@dataclass(frozen=True, slots=True)
class SpeechRequest:
    """Validated payload for speech synthesis."""

    text: str
    provider: SpeechProvider
    voice: str | None = None

    @property
    def clean_text(self) -> str:
        """Return text with leading and trailing whitespace stripped."""
        return self.text.strip()

    def validate(self) -> None:
        """Validate input parameters prior to synthesis."""
        if len(self.text) > MAX_SPEECH_TEXT_LENGTH:
            raise SpeechServiceError(
                code="text_too_long",
                message=f"El texto excede el límite máximo de {MAX_SPEECH_TEXT_LENGTH} caracteres.",
                status_code=422,
                retryable=False,
            )

        if not self.clean_text:
            raise SpeechServiceError(
                code="empty_text",
                message="El texto no puede estar vacío tras eliminar espacios exteriores.",
                status_code=422,
                retryable=False,
            )

        if self.voice is not None and (
            not (1 <= len(self.voice) <= 100) or any(ord(c) < 32 for c in self.voice)
        ):
                raise SpeechServiceError(
                    code="invalid_request",
                    message="La voz especificada es inválida.",
                    status_code=422,
                    retryable=False,
                )
