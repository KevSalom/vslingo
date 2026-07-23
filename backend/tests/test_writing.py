import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.writing import (
    MAX_CORRECTION_TEXT_LENGTH,
    Correction,
    CorrectionCategory,
    CorrectionResult,
)
from app.main import create_app
from app.providers.fakes import FakeCorrectionProvider
from app.services.correction import CorrectionService


def _client_for(
    result: CorrectionResult | None = None,
    *,
    error: IntegrationError | None = None,
) -> TestClient:
    provider = FakeCorrectionProvider(result=result, error=error)
    service = CorrectionService(provider)
    return TestClient(
        create_app(
            Settings(_env_file=None, environment="test"),
            correction_service=service,
        )
    )


def test_writing_returns_positive_feedback_for_correct_text() -> None:
    text = "The deployment completed successfully."
    result = CorrectionResult(
        original_text=text,
        corrected_text=text,
        has_corrections=False,
        corrections=(),
        general_feedback="La oración es correcta, clara y natural.",
    )

    response = _client_for(result).post("/api/writing/correct", json={"text": text})

    assert response.status_code == 200
    assert response.json() == {
        "original_text": text,
        "corrected_text": text,
        "has_corrections": False,
        "corrections": [],
        "general_feedback": "La oración es correcta, clara y natural.",
    }


def test_writing_returns_multiple_categorized_corrections() -> None:
    text = "She deploy the service yesterday and it work good."
    result = CorrectionResult(
        original_text=text,
        corrected_text="She deployed the service yesterday, and it worked well.",
        has_corrections=True,
        corrections=(
            Correction(
                original="deploy",
                corrected="deployed",
                explanation="El marcador temporal exige pasado simple.",
                category=CorrectionCategory.GRAMMAR,
            ),
            Correction(
                original="work good",
                corrected="worked well",
                explanation="Se necesita pasado y el adverbio «well».",
                category=CorrectionCategory.STYLE,
            ),
        ),
        general_feedback="Buen vocabulario técnico; revisa el pasado simple.",
    )

    response = _client_for(result).post("/api/writing/correct", json={"text": text})

    assert response.status_code == 200
    payload = response.json()
    assert payload["corrected_text"] == "She deployed the service yesterday, and it worked well."
    assert [item["category"] for item in payload["corrections"]] == [
        "grammar",
        "style",
    ]


def test_writing_rejects_empty_text_with_a_typed_error() -> None:
    response = _client_for().post("/api/writing/correct", json={"text": "   "})

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "empty_text",
            "message": "Escribe un texto en inglés antes de solicitar la corrección.",
            "retryable": False,
        }
    }


def test_writing_accepts_the_maximum_length() -> None:
    text = "a" * MAX_CORRECTION_TEXT_LENGTH

    response = _client_for().post("/api/writing/correct", json={"text": text})

    assert response.status_code == 200
    assert response.json()["original_text"] == text


def test_writing_rejects_text_above_the_maximum_length() -> None:
    text = "a" * (MAX_CORRECTION_TEXT_LENGTH + 1)

    response = _client_for().post("/api/writing/correct", json={"text": text})

    assert response.status_code == 422
    assert response.json()["error"] == {
        "code": "text_too_long",
        "message": f"El texto no puede superar {MAX_CORRECTION_TEXT_LENGTH} caracteres.",
        "retryable": False,
    }


def test_writing_maps_invalid_provider_output_to_a_safe_error() -> None:
    response = _client_for(
        error=IntegrationError(
            "openrouter_writing",
            IntegrationErrorCode.INVALID_RESPONSE,
            "Provider response contained private diagnostics.",
        )
    ).post("/api/writing/correct", json={"text": "Check this sentence."})

    assert response.status_code == 502
    assert response.json()["error"] == {
        "code": "invalid_provider_response",
        "message": "El proveedor devolvió una corrección inválida. Inténtalo de nuevo.",
        "retryable": True,
    }
    assert "private diagnostics" not in response.text


def test_writing_maps_provider_timeout_to_a_retryable_error() -> None:
    response = _client_for(
        error=IntegrationError(
            "openrouter_writing",
            IntegrationErrorCode.TIMEOUT,
            "OpenRouter timed out.",
        )
    ).post("/api/writing/correct", json={"text": "Check this sentence."})

    assert response.status_code == 504
    assert response.json()["error"] == {
        "code": "provider_timeout",
        "message": "La corrección tardó demasiado. Inténtalo de nuevo.",
        "retryable": True,
    }


def test_writing_normalizes_request_validation_errors() -> None:
    client = _client_for()
    responses = (
        client.post(
            "/api/writing/correct",
            content="{broken",
            headers={"Content-Type": "application/json"},
        ),
        client.post("/api/writing/correct", json={}),
        client.post("/api/writing/correct", json={"text": 42}),
        client.post(
            "/api/writing/correct",
            json={"text": "Check this.", "unexpected": True},
        ),
    )

    for response in responses:
        assert response.status_code == 422
        assert response.json() == {
            "error": {
                "code": "invalid_request",
                "message": "La solicitud de corrección no es válida.",
                "retryable": False,
            }
        }


def test_correction_result_rejects_changes_without_a_changed_final_text() -> None:
    text = "Check this text."

    with pytest.raises(ValidationError):
        CorrectionResult(
            original_text=text,
            corrected_text=text,
            has_corrections=True,
            corrections=(
                Correction(
                    original="this",
                    corrected="that",
                    explanation="El cambio debe aparecer en el resultado final.",
                    category=CorrectionCategory.STYLE,
                ),
            ),
            general_feedback="Revisa el resultado.",
        )


class _ScriptedCorrectionProvider:
    """Return deterministic outcomes in call order."""

    def __init__(self, *outcomes: CorrectionResult | IntegrationError) -> None:
        self._outcomes = iter(outcomes)
        self.calls: list[str] = []

    async def correct(self, text: str) -> CorrectionResult:
        self.calls.append(text)
        outcome = next(self._outcomes)
        if isinstance(outcome, IntegrationError):
            raise outcome
        return outcome


def _client_for_scripted_provider(provider: _ScriptedCorrectionProvider) -> TestClient:
    return TestClient(
        create_app(
            Settings(_env_file=None, environment="test"),
            correction_service=CorrectionService(provider),
        )
    )


def _email_correction(text: str) -> CorrectionResult:
    return CorrectionResult(
        original_text=text,
        corrected_text=text.replace("withh email", "with the email"),
        has_corrections=True,
        corrections=(
            Correction(
                original="withh",
                corrected="with the",
                explanation="Corrige el error ortográfico y añade el artículo necesario.",
                category=CorrectionCategory.SPELLING,
            ),
        ),
        general_feedback="La dirección de email se conserva sin cambios.",
    )


def test_writing_retries_one_invalid_response_and_preserves_email(
    caplog: pytest.LogCaptureFixture,
) -> None:
    text = "Hey, Can we ban the user withh email fulanito@gmail.com?"
    invalid_response = IntegrationError(
        "openrouter_writing",
        IntegrationErrorCode.INVALID_RESPONSE,
        f"Private provider diagnostics containing {text}",
    )
    provider = _ScriptedCorrectionProvider(invalid_response, _email_correction(text))
    caplog.set_level("WARNING", logger="app.services.correction")

    response = _client_for_scripted_provider(provider).post(
        "/api/writing/correct", json={"text": text}
    )

    assert response.status_code == 200
    assert provider.calls == [text, text]
    assert response.json()["original_text"] == text
    assert "fulanito@gmail.com" in response.json()["corrected_text"]
    assert text not in caplog.text
    assert "Private provider diagnostics" not in caplog.text
    records = [record for record in caplog.records if record.name == "app.services.correction"]
    assert len(records) == 1
    assert records[0].provider == "openrouter_writing"
    assert records[0].code == "invalid_response"
    assert records[0].attempt == 1
    assert records[0].cause_type == "IntegrationError"
    assert records[0].validation_errors == []


def test_writing_stops_after_two_invalid_responses() -> None:
    text = "Check this sentence."
    provider = _ScriptedCorrectionProvider(
        IntegrationError(
            "openrouter_writing",
            IntegrationErrorCode.INVALID_RESPONSE,
            "First private provider diagnostic.",
        ),
        IntegrationError(
            "openrouter_writing",
            IntegrationErrorCode.INVALID_RESPONSE,
            "Second private provider diagnostic.",
        ),
    )

    response = _client_for_scripted_provider(provider).post(
        "/api/writing/correct", json={"text": text}
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "invalid_provider_response"
    assert provider.calls == [text, text]
    assert "private provider diagnostic" not in response.text.lower()


def test_writing_does_not_retry_timeouts() -> None:
    text = "Check this sentence."
    provider = _ScriptedCorrectionProvider(
        IntegrationError(
            "openrouter_writing",
            IntegrationErrorCode.TIMEOUT,
            "Private timeout diagnostic.",
        )
    )

    response = _client_for_scripted_provider(provider).post(
        "/api/writing/correct", json={"text": text}
    )

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "provider_timeout"
    assert provider.calls == [text]


def test_writing_retries_an_original_text_mismatch_once() -> None:
    text = "Hey, Can we ban the user withh email fulanito@gmail.com?"
    mismatched_result = CorrectionResult(
        original_text="A different original text.",
        corrected_text="A different original text.",
        has_corrections=False,
        corrections=(),
        general_feedback="El texto es correcto.",
    )
    provider = _ScriptedCorrectionProvider(mismatched_result, _email_correction(text))

    response = _client_for_scripted_provider(provider).post(
        "/api/writing/correct", json={"text": text}
    )

    assert response.status_code == 200
    assert response.json()["original_text"] == text
    assert provider.calls == [text, text]


@pytest.mark.parametrize("terminal_line_ending", ["\n", "\r\n"])
def test_writing_normalizes_terminal_line_endings_before_calling_provider(
    terminal_line_ending: str,
) -> None:
    canonical_text = "Hey, Can we ban the user?"
    valid_result = CorrectionResult(
        original_text=canonical_text,
        corrected_text=canonical_text,
        has_corrections=False,
        corrections=(),
        general_feedback="El texto es correcto.",
    )
    provider = _ScriptedCorrectionProvider(valid_result, valid_result)

    response = _client_for_scripted_provider(provider).post(
        "/api/writing/correct",
        json={"text": f"{canonical_text}{terminal_line_ending}"},
    )

    assert response.status_code == 200
    assert response.json()["original_text"] == canonical_text
    assert provider.calls == [canonical_text]
