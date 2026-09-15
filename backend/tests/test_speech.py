"""Tests for speech service domain, application router, and endpoint contracts."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.models import SynthesizedSpeech
from app.domain.speech import SpeechProvider, SpeechRequest
from app.main import create_app
from app.services.speech import SpeechService, SpeechServiceError

AUTH_HEADERS = {"Authorization": "Bearer dev-session-token"}


class ConfigurableFakeSynthesizer:
    """Fake synthesizer that supports custom audio or errors per call."""

    def __init__(
        self, audio: bytes = b"ID3-custom-speech-bytes", error: Exception | None = None
    ) -> None:
        self.audio = audio
        self.error = error
        self.last_text: str | None = None
        self.last_voice: str | None = None

    async def synthesize(self, text: str, *, voice: str | None = None) -> SynthesizedSpeech:
        self.last_text = text
        self.last_voice = voice
        if self.error is not None:
            raise self.error
        return SynthesizedSpeech(audio=self.audio)


def test_speech_provider_enum() -> None:
    assert SpeechProvider.EDGE_TTS == "edge_tts"


def test_speech_request_validation() -> None:
    req = SpeechRequest(
        text="  Hello world  ",
        provider=SpeechProvider.EDGE_TTS,
        voice="en-US-AriaNeural",
    )
    assert req.clean_text == "Hello world"
    assert req.voice == "en-US-AriaNeural"

    too_long = "a" * 3001
    with pytest.raises(SpeechServiceError) as exc_info:
        SpeechRequest(text=too_long, provider=SpeechProvider.EDGE_TTS).validate()
    assert exc_info.value.code == "text_too_long"

    empty = "   "
    with pytest.raises(SpeechServiceError) as exc_info:
        SpeechRequest(text=empty, provider=SpeechProvider.EDGE_TTS).validate()
    assert exc_info.value.code == "empty_text"


@pytest.mark.asyncio
async def test_speech_service_success_edge() -> None:
    edge_fake = ConfigurableFakeSynthesizer(b"ID3-edge-audio")
    service = SpeechService(
        providers={
            SpeechProvider.EDGE_TTS: edge_fake,
        }
    )

    req = SpeechRequest(text="Test speech", provider=SpeechProvider.EDGE_TTS)
    speech = await service.synthesize(req)

    assert speech.audio == b"ID3-edge-audio"
    assert speech.media_type == "audio/mpeg"
    assert edge_fake.last_text == "Test speech"


@pytest.mark.asyncio
async def test_speech_service_maps_edge_error() -> None:
    edge_fake = ConfigurableFakeSynthesizer(
        error=IntegrationError("edge_tts", IntegrationErrorCode.UNAVAILABLE, "Edge down")
    )
    service = SpeechService(
        providers={
            SpeechProvider.EDGE_TTS: edge_fake,
        }
    )

    req = SpeechRequest(text="Test speech", provider=SpeechProvider.EDGE_TTS)
    with pytest.raises(SpeechServiceError) as exc_info:
        await service.synthesize(req)

    assert exc_info.value.code == "provider_unavailable"
    assert exc_info.value.retryable is True
    assert edge_fake.last_text == "Test speech"


def test_speech_api_success_headers_and_bytes() -> None:
    edge_fake = ConfigurableFakeSynthesizer(b"ID3-edge-binary-data")
    service = SpeechService(
        providers={
            SpeechProvider.EDGE_TTS: edge_fake,
        }
    )
    app = create_app(Settings(_env_file=None, environment="test"), speech_service=service)
    client = TestClient(app, headers=AUTH_HEADERS)

    response = client.post(
        "/api/speech",
        json={"text": "Hello", "provider": "edge_tts", "voice": "en-US-AriaNeural"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.content == b"ID3-edge-binary-data"


def test_speech_api_invalid_provider_returns_422() -> None:
    app = create_app(Settings(_env_file=None, environment="test"))
    client = TestClient(app, headers=AUTH_HEADERS)

    response = client.post(
        "/api/speech",
        json={"text": "Hello", "provider": "unknown_provider"},
    )

    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "invalid_request"
    assert data["error"]["retryable"] is False


def test_speech_api_empty_text_returns_422() -> None:
    app = create_app(Settings(_env_file=None, environment="test"))
    client = TestClient(app, headers=AUTH_HEADERS)

    response = client.post(
        "/api/speech",
        json={"text": "   ", "provider": "edge_tts"},
    )

    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "empty_text"
    assert data["error"]["retryable"] is False


def test_speech_api_text_too_long_returns_422() -> None:
    app = create_app(Settings(_env_file=None, environment="test"))
    client = TestClient(app, headers=AUTH_HEADERS)

    response = client.post(
        "/api/speech",
        json={"text": "x" * 3001, "provider": "edge_tts"},
    )

    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "text_too_long"
    assert data["error"]["retryable"] is False
