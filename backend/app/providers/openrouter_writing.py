"""OpenRouter adapter for non-streaming structured writing corrections."""

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.writing import CorrectionResult
from app.prompts.writing import build_writing_messages


class OpenRouterCorrectionProvider:
    """Request one strict JSON Schema correction from OpenRouter."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def correct(self, text: str) -> CorrectionResult:
        """Return validated structured output without exposing provider details."""

        api_key = self._api_key()
        model = self._settings.openrouter_llm_model.strip()
        if not model:
            raise IntegrationError(
                "openrouter_writing",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OPENROUTER_LLM_MODEL is required for Writing Studio.",
            )

        url = f"{str(self._settings.openrouter_base_url).rstrip('/')}/chat/completions"
        request_payload: dict[str, object] = {
            "model": model,
            "messages": build_writing_messages(text),
            "stream": False,
            "temperature": 0.0,
            "max_tokens": 1000,
            "provider": {"require_parameters": True},
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "writing_correction",
                    "strict": True,
                    "schema": CorrectionResult.model_json_schema(),
                },
            },
        }

        try:
            async with httpx.AsyncClient(
                timeout=self._settings.provider_timeout_seconds
            ) as client:
                response = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=request_payload,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise IntegrationError(
                "openrouter_writing",
                IntegrationErrorCode.TIMEOUT,
                "OpenRouter writing correction timed out.",
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise IntegrationError(
                "openrouter_writing",
                _http_error_code(exc.response.status_code),
                "OpenRouter rejected the writing correction request.",
            ) from exc
        except httpx.HTTPError as exc:
            raise IntegrationError(
                "openrouter_writing",
                IntegrationErrorCode.UNAVAILABLE,
                "OpenRouter writing correction failed.",
            ) from exc

        try:
            payload: object = response.json()
        except ValueError as exc:
            raise IntegrationError(
                "openrouter_writing",
                IntegrationErrorCode.INVALID_RESPONSE,
                "OpenRouter returned an invalid response envelope.",
            ) from exc

        content = _strip_json_fence(_response_content(payload))
        try:
            return CorrectionResult.model_validate_json(content)
        except ValidationError as exc:
            raise IntegrationError(
                "openrouter_writing",
                IntegrationErrorCode.INVALID_RESPONSE,
                "OpenRouter returned invalid structured correction data.",
            ) from exc

    def _api_key(self) -> str:
        secret = self._settings.openrouter_api_key
        if secret is None or not secret.get_secret_value().strip():
            raise IntegrationError(
                "openrouter_writing",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OPENROUTER_API_KEY is required for Writing Studio.",
            )
        return secret.get_secret_value().strip()


def _response_content(payload: object) -> str:
    """Extract the structured assistant content from an OpenRouter envelope."""

    if isinstance(payload, dict):
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            choice = choices[0]
            if isinstance(choice, dict):
                message = choice.get("message")
                if isinstance(message, dict):
                    content = message.get("content")
                    if isinstance(content, str) and content.strip():
                        return content
    raise IntegrationError(
        "openrouter_writing",
        IntegrationErrorCode.INVALID_RESPONSE,
        "OpenRouter returned no structured correction content.",
    )


def _http_error_code(status_code: int) -> IntegrationErrorCode:
    """Classify OpenRouter statuses without exposing response details."""

    if status_code in {401, 403}:
        return IntegrationErrorCode.NOT_CONFIGURED
    if 400 <= status_code < 500 and status_code != 429:
        return IntegrationErrorCode.INVALID_REQUEST
    return IntegrationErrorCode.UNAVAILABLE


def _strip_json_fence(content: str) -> str:
    """Remove only a surrounding Markdown JSON fence used by some models."""

    cleaned = content.strip()
    if cleaned.lower().startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    else:
        return cleaned

    if cleaned.rstrip().endswith("```"):
        cleaned = cleaned.rstrip()[:-3]
    return cleaned.strip()
