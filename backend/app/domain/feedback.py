"""Domain models for Voice feedback (T06)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class BaseFeedbackModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


CorrectionCategoryType = Literal["grammar", "vocabulary", "clarity", "tone"]


class CorrectionItem(BaseFeedbackModel):
    category: CorrectionCategoryType
    original: str = Field(min_length=1, max_length=500)
    corrected: str = Field(min_length=1, max_length=500)
    explanation_es: str = Field(min_length=1, max_length=500)

    @field_validator("original", "corrected", "explanation_es", mode="before")
    @classmethod
    def trim_string(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class VocabularyItem(BaseFeedbackModel):
    term: str = Field(min_length=1, max_length=100)
    meaning_es: str = Field(min_length=1, max_length=200)
    example_en: str = Field(min_length=1, max_length=300)

    @field_validator("term", "meaning_es", "example_en", mode="before")
    @classmethod
    def trim_string(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class VoiceFeedback(BaseFeedbackModel):
    summary_es: str = Field(min_length=1, max_length=500)
    strengths: list[str] = Field(default_factory=list, max_length=3)
    corrections: list[CorrectionItem] = Field(default_factory=list, max_length=5)
    vocabulary: list[VocabularyItem] = Field(default_factory=list, max_length=5)

    @field_validator("summary_es", mode="before")
    @classmethod
    def trim_summary(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("strengths", mode="before")
    @classmethod
    def trim_strengths(cls, values: object) -> object:
        if isinstance(values, list):
            trimmed: list[str] = []
            for v in values:
                if isinstance(v, str):
                    t = v.strip()
                    if not (1 <= len(t) <= 200):
                        raise ValueError(
                            "Cada fortaleza debe tener entre 1 y 200 caracteres tras trim."
                        )
                    trimmed.append(t)
                else:
                    trimmed.append(v)
            return trimmed
        return values
