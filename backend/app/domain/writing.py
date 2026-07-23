"""Typed Writing Studio values and input validation errors."""

from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_CORRECTION_TEXT_LENGTH = 1000


class CorrectionCategory(StrEnum):
    """Stable categories used to explain a writing correction."""

    GRAMMAR = "grammar"
    SPELLING = "spelling"
    PUNCTUATION = "punctuation"
    STYLE = "style"


class Correction(BaseModel):
    """One categorized change from the submitted text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    original: str = Field(min_length=1, max_length=MAX_CORRECTION_TEXT_LENGTH)
    corrected: str = Field(min_length=1, max_length=MAX_CORRECTION_TEXT_LENGTH)
    explanation: str = Field(min_length=1, max_length=2000)
    category: CorrectionCategory


class CorrectionResult(BaseModel):
    """Structured result returned by correction providers and the HTTP API."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    original_text: str = Field(min_length=1, max_length=MAX_CORRECTION_TEXT_LENGTH)
    corrected_text: str = Field(min_length=1, max_length=2000)
    has_corrections: bool
    corrections: tuple[Correction, ...]
    general_feedback: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def validate_correction_consistency(self) -> Self:
        """Reject contradictory provider output before it reaches the user."""

        if self.has_corrections != bool(self.corrections):
            raise ValueError("has_corrections must match the corrections collection")
        if self.has_corrections and self.corrected_text == self.original_text:
            raise ValueError("corrections must change the final text")
        if not self.has_corrections and self.corrected_text != self.original_text:
            raise ValueError("unchanged results must preserve the original text")
        return self


class WritingInputErrorCode(StrEnum):
    """Input failures controlled by the correction service."""

    EMPTY_TEXT = "empty_text"
    TEXT_TOO_LONG = "text_too_long"


class WritingInputError(ValueError):
    """A safe, typed validation failure for Writing Studio input."""

    def __init__(self, code: WritingInputErrorCode) -> None:
        self.code = code
        super().__init__(code.value)
