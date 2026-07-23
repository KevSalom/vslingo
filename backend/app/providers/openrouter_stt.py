"""Async OpenRouter Whisper STT provider adapter."""

import httpx

from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.models import Transcription
from app.domain.ports import SpeechToTextPort


class OpenRouterSpeechToTextProvider(SpeechToTextPort):
    """Transcribe audio using OpenRouter's speech-to-text endpoints."""

    def __init__(
        self,
        *,
        api_key: str | None,
        model: str = "openai/whisper-large-v3-turbo",
        base_url: str = "https://openrouter.ai/api/v1",
        timeout_seconds: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._external_client = client

    async def transcribe(self, audio: bytes, *, media_type: str = "audio/wav") -> Transcription:
        if not self._api_key or not self._api_key.strip():
            raise IntegrationError(
                "openrouter_stt",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OpenRouter API key is not configured.",
            )

        headers = {
            "Authorization": f"Bearer {self._api_key.strip()}",
        }
        files = {
            "file": ("utterance.wav", audio, media_type),
        }
        data = {
            "model": self._model,
        }

        url = f"{self._base_url}/audio/transcriptions"

        try:
            if self._external_client is not None:
                response = await self._external_client.post(
                    url,
                    headers=headers,
                    files=files,
                    data=data,
                    timeout=self._timeout_seconds,
                )
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        url,
                        headers=headers,
                        files=files,
                        data=data,
                        timeout=self._timeout_seconds,
                    )
        except httpx.TimeoutException as exc:
            raise IntegrationError(
                "openrouter_stt",
                IntegrationErrorCode.TIMEOUT,
                "STT request timed out.",
            ) from exc
        except httpx.RequestError as exc:
            raise IntegrationError(
                "openrouter_stt",
                IntegrationErrorCode.UNAVAILABLE,
                "STT provider request failed.",
            ) from exc

        if response.status_code in (401, 403):
            raise IntegrationError(
                "openrouter_stt",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OpenRouter API key is invalid or unauthorized.",
            )
        if response.status_code == 400:
            raise IntegrationError(
                "openrouter_stt",
                IntegrationErrorCode.INVALID_REQUEST,
                "Audio data was rejected by the provider.",
            )
        if response.status_code >= 400:
            raise IntegrationError(
                "openrouter_stt",
                IntegrationErrorCode.UNAVAILABLE,
                f"STT provider returned HTTP status {response.status_code}.",
            )

        try:
            result_json = response.json()
        except ValueError as exc:
            raise IntegrationError(
                "openrouter_stt",
                IntegrationErrorCode.INVALID_RESPONSE,
                "STT provider returned malformed JSON.",
            ) from exc

        text = result_json.get("text", "")
        if not isinstance(text, str) or not text.strip():
            raise IntegrationError(
                "openrouter_stt",
                IntegrationErrorCode.INVALID_RESPONSE,
                "STT provider returned an empty or missing text field.",
            )

        duration_seconds: float | None = None
        cost_usd: float | None = None

        usage = result_json.get("usage")
        if isinstance(usage, dict):
            raw_duration = usage.get("seconds")
            if isinstance(raw_duration, (int, float)):
                duration_seconds = float(raw_duration)
            raw_cost = usage.get("cost")
            if isinstance(raw_cost, (int, float)):
                cost_usd = float(raw_cost)

        return Transcription(
            text=text.strip(),
            duration_seconds=duration_seconds,
            cost_usd=cost_usd,
        )
