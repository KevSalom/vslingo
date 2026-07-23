"""OpenRouter adapter for structured voice feedback (T06)."""

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.feedback import VoiceFeedback


class OpenRouterVoiceFeedbackProvider:
    """Request structured feedback for a transcript and scenario from OpenRouter."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _api_key(self) -> str:
        if not self._settings.openrouter_api_key:
            raise IntegrationError(
                "openrouter_feedback",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OPENROUTER_API_KEY is required for voice feedback.",
            )
        api_key = self._settings.openrouter_api_key.get_secret_value().strip()
        if not api_key:
            raise IntegrationError(
                "openrouter_feedback",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OPENROUTER_API_KEY is required for voice feedback.",
            )
        return api_key

    async def generate(self, transcript: str, scenario: str) -> VoiceFeedback:
        """Return validated VoiceFeedback or raise IntegrationError."""
        api_key = self._api_key()
        model = self._settings.openrouter_llm_model.strip()
        if not model:
            raise IntegrationError(
                "openrouter_feedback",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OPENROUTER_LLM_MODEL is required for voice feedback.",
            )

        url = f"{str(self._settings.openrouter_base_url).rstrip('/')}/chat/completions"

        system_instruction = (
            "You are an expert English language coach. Analyze the user's transcript in the "
            "context of the given scenario.\n"
            "Produce strict structured feedback in Spanish for explanations and summary, and "
            "English for corrected text and vocabulary.\n"
            "Categories allowed: grammar, vocabulary, clarity, tone.\n"
            "Summary must be in Spanish (1-500 chars). Strengths: 0-3 items (Spanish). "
            "Corrections: 0-5 items. Vocabulary: 0-5 items."
        )

        user_content = f"Scenario: {scenario}\nUser transcript: {transcript}"

        request_payload: dict[str, object] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_content},
            ],
            "stream": False,
            "temperature": 0.0,
            "max_tokens": 1000,
            "provider": {"require_parameters": True},
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "voice_feedback",
                    "strict": True,
                    "schema": VoiceFeedback.model_json_schema(),
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
                payload = response.json()
        except httpx.TimeoutException as exc:
            raise IntegrationError(
                "openrouter_feedback",
                IntegrationErrorCode.TIMEOUT,
                "Voice feedback generation timed out.",
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise IntegrationError(
                "openrouter_feedback",
                IntegrationErrorCode.UNAVAILABLE,
                f"OpenRouter feedback returned status {exc.response.status_code}.",
            ) from exc
        except Exception as exc:
            if isinstance(exc, IntegrationError):
                raise
            raise IntegrationError(
                "openrouter_feedback",
                IntegrationErrorCode.UNAVAILABLE,
                f"OpenRouter feedback failed: {exc}",
            ) from exc

        try:
            raw_content = payload["choices"][0]["message"]["content"]
            return VoiceFeedback.model_validate_json(raw_content)
        except (KeyError, IndexError, TypeError, ValidationError, ValueError) as exc:
            raise IntegrationError(
                "openrouter_feedback",
                IntegrationErrorCode.INVALID_RESPONSE,
                f"OpenRouter returned an invalid feedback structure: {exc}",
            ) from exc
