import json

import httpx
import pytest
import respx
from pydantic import SecretStr

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.providers.openrouter_writing import OpenRouterCorrectionProvider

OPENROUTER_URL = "https://openrouter.test/api/v1/chat/completions"


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        openrouter_api_key=SecretStr("test-key"),
        openrouter_llm_model="test/structured-model",
        openrouter_base_url="https://openrouter.test/api/v1",
        provider_timeout_seconds=0.25,
    )


@respx.mock
async def test_openrouter_requests_and_parses_strict_structured_output() -> None:
    text = "She don't deploy on Fridays."
    route = respx.post(OPENROUTER_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "original_text": text,
                                    "corrected_text": "She doesn't deploy on Fridays.",
                                    "has_corrections": True,
                                    "corrections": [
                                        {
                                            "original": "don't",
                                            "corrected": "doesn't",
                                            "explanation": "Con «she» usamos «doesn't».",
                                            "category": "grammar",
                                        }
                                    ],
                                    "general_feedback": (
                                        "La idea es clara; revisa la tercera persona."
                                    ),
                                }
                            )
                        }
                    }
                ]
            },
        )
    )

    result = await OpenRouterCorrectionProvider(_settings()).correct(text)

    assert result.corrected_text == "She doesn't deploy on Fridays."
    assert result.corrections[0].category == "grammar"
    request = route.calls.last.request
    payload = json.loads(request.content)
    assert payload["model"] == "test/structured-model"
    assert payload["stream"] is False
    assert payload["temperature"] == 0.0
    assert payload["max_tokens"] == 1000
    assert payload["provider"] == {"require_parameters": True}
    messages = payload["messages"]
    assert [message["role"] for message in messages] == [
        "system",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
    ]
    assert messages[-1]["content"] == text
    assert json.loads(messages[2]["content"])["has_corrections"] is True
    assert json.loads(messages[4]["content"])["has_corrections"] is False
    assert payload["response_format"]["type"] == "json_schema"
    assert payload["response_format"]["json_schema"]["strict"] is True
    schema = payload["response_format"]["json_schema"]["schema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"])
    assert "default" not in schema["properties"]["corrections"]
    assert request.headers["Authorization"] == "Bearer test-key"


@pytest.mark.parametrize(
    "content",
    (
        "not-json",
        json.dumps(
            {
                "original_text": "Check this text.",
                "corrected_text": "Check this text.",
                "has_corrections": True,
                "corrections": [
                    {
                        "original": "this",
                        "corrected": "that",
                        "explanation": "Cambio contradictorio.",
                        "category": "style",
                    }
                ],
                "general_feedback": "Revisa el resultado.",
            }
        ),
    ),
)
@respx.mock
async def test_openrouter_rejects_invalid_structured_output(content: str) -> None:
    respx.post(OPENROUTER_URL).mock(
        return_value=httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}]},
        )
    )

    with pytest.raises(IntegrationError) as error:
        await OpenRouterCorrectionProvider(_settings()).correct("Check this text.")

    assert error.value.code is IntegrationErrorCode.INVALID_RESPONSE


@respx.mock
async def test_openrouter_maps_transport_timeout() -> None:
    respx.post(OPENROUTER_URL).mock(side_effect=httpx.ReadTimeout("too slow"))

    with pytest.raises(IntegrationError) as error:
        await OpenRouterCorrectionProvider(_settings()).correct("Check this text.")

    assert error.value.code is IntegrationErrorCode.TIMEOUT


@pytest.mark.parametrize(
    ("status_code", "expected_code"),
    (
        (400, IntegrationErrorCode.INVALID_REQUEST),
        (401, IntegrationErrorCode.NOT_CONFIGURED),
        (403, IntegrationErrorCode.NOT_CONFIGURED),
        (429, IntegrationErrorCode.UNAVAILABLE),
        (500, IntegrationErrorCode.UNAVAILABLE),
    ),
)
@respx.mock
async def test_openrouter_classifies_http_failures(
    status_code: int,
    expected_code: IntegrationErrorCode,
) -> None:
    respx.post(OPENROUTER_URL).mock(return_value=httpx.Response(status_code))

    with pytest.raises(IntegrationError) as error:
        await OpenRouterCorrectionProvider(_settings()).correct("Check this text.")

    assert error.value.code is expected_code


async def test_openrouter_requires_key_and_model_before_network_access() -> None:
    provider = OpenRouterCorrectionProvider(Settings(_env_file=None))

    with pytest.raises(IntegrationError) as error:
        await provider.correct("Check this text.")

    assert error.value.code is IntegrationErrorCode.NOT_CONFIGURED


@respx.mock
async def test_openrouter_accepts_json_wrapped_in_markdown_fences() -> None:
    text = "The deployment completed successfully."
    content = json.dumps(
        {
            "original_text": text,
            "corrected_text": text,
            "has_corrections": False,
            "corrections": [],
            "general_feedback": "La oración es correcta y natural.",
        }
    )
    respx.post(OPENROUTER_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": f"```json\n{content}\n```"}}
                ]
            },
        )
    )

    result = await OpenRouterCorrectionProvider(_settings()).correct(text)

    assert result.original_text == text
    assert result.has_corrections is False
