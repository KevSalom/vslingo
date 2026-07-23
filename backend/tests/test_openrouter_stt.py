"""Tests for OpenRouterSpeechToTextProvider with mocked HTTP responses."""

import httpx
import pytest

from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.providers.openrouter_stt import OpenRouterSpeechToTextProvider


@pytest.mark.asyncio
async def test_stt_not_configured() -> None:
    provider = OpenRouterSpeechToTextProvider(api_key=None)
    with pytest.raises(IntegrationError) as exc_info:
        await provider.transcribe(b"fake-wav-bytes")
    assert exc_info.value.code == IntegrationErrorCode.NOT_CONFIGURED


@pytest.mark.asyncio
async def test_stt_successful_transcription() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/audio/transcriptions"
        assert request.headers["Authorization"] == "Bearer test-key"
        return httpx.Response(
            200,
            json={
                "text": "Hello world from Whisper.",
                "usage": {"seconds": 2.5, "cost": 0.001},
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = OpenRouterSpeechToTextProvider(
            api_key="test-key",
            client=client,
        )
        res = await provider.transcribe(b"RIFF....WAVEfmt ...data....")
        assert res.text == "Hello world from Whisper."
        assert res.duration_seconds == 2.5
        assert res.cost_usd == 0.001


@pytest.mark.asyncio
async def test_stt_http_error_mapping() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "Invalid WAV format"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = OpenRouterSpeechToTextProvider(
            api_key="test-key",
            client=client,
        )
        with pytest.raises(IntegrationError) as exc_info:
            await provider.transcribe(b"bad-audio")
        assert exc_info.value.code == IntegrationErrorCode.INVALID_REQUEST
