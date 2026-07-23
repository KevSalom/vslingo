"""Tests for VoiceFeedback domain models and validation rules (T06)."""

import pytest
from pydantic import ValidationError

from app.domain.feedback import CorrectionItem, VocabularyItem, VoiceFeedback


def test_valid_voice_feedback() -> None:
    feedback = VoiceFeedback(
        summary_es="La idea se entiende claramente.",
        strengths=["Excelente estructura."],
        corrections=[
            CorrectionItem(
                category="grammar",
                original="I deploy yesterday",
                corrected="I deployed yesterday",
                explanation_es="Usa el pasado simple.",
            )
        ],
        vocabulary=[
            VocabularyItem(
                term="rollout",
                meaning_es="despliegue gradual",
                example_en="We started a rollout.",
            )
        ],
    )
    assert feedback.summary_es == "La idea se entiende claramente."
    assert len(feedback.strengths) == 1
    assert feedback.corrections[0].category == "grammar"


def test_feedback_string_trimming() -> None:
    feedback = VoiceFeedback(
        summary_es="  Resumen con espacios  ",
        strengths=["  Fortaleza  "],
        corrections=[
            CorrectionItem(
                category="vocabulary",
                original="  orig  ",
                corrected="  corr  ",
                explanation_es="  expl  ",
            )
        ],
    )
    assert feedback.summary_es == "Resumen con espacios"
    assert feedback.strengths[0] == "Fortaleza"
    assert feedback.corrections[0].original == "orig"


def test_feedback_extra_fields_forbidden() -> None:
    with pytest.raises(ValidationError):
        VoiceFeedback.model_validate({
            "summary_es": "Resumen",
            "extra_field": "not allowed",
        })


def test_feedback_limits_exceeded() -> None:
    # Test summary too long
    with pytest.raises(ValidationError):
        VoiceFeedback(summary_es="a" * 501)

    # Test strengths max length 3
    with pytest.raises(ValidationError):
        VoiceFeedback(
            summary_es="OK",
            strengths=["s1", "s2", "s3", "s4"],
        )
