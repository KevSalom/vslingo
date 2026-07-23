"""Tests for speech service domain, application router, and endpoint contracts."""

import pytest
from fastapi.testclient import TestClient

from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.models import SynthesizedSpeech
from app.domain.speech import SpeechProvider, SpeechRequest
from app.main import create_app
from app.services.speech import SpeechService, SpeechServiceError


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
    assert SpeechProvider.AWS_POLLY == "aws_polly"
    assert SpeechProvider.EDGE_TTS == "edge_tts"


def test_speech_request_validation() -> None:
    req = SpeechRequest(text="  Hello world  ", provider=SpeechProvider.AWS_POLLY, voice="Joanna")
    assert req.clean_text == "Hello world"
    assert req.voice == "Joanna"

    too_long = "a" * 3001
    with pytest.raises(SpeechServiceError) as exc_info:
        SpeechRequest(text=too_long, provider=SpeechProvider.AWS_POLLY).validate()
    assert exc_info.value.code == "text_too_long"

    empty = "   "
    with pytest.raises(SpeechServiceError) as exc_info:
        SpeechRequest(text=empty, provider=SpeechProvider.AWS_POLLY).validate()
    assert exc_info.value.code == "empty_text"


@pytest.mark.asyncio
async def test_speech_service_success_polly() -> None:
    polly_fake = ConfigurableFakeSynthesizer(b"ID3-polly-audio")
    edge_fake = ConfigurableFakeSynthesizer(b"ID3-edge-audio")
    service = SpeechService(
        providers={
            SpeechProvider.AWS_POLLY: polly_fake,
            SpeechProvider.EDGE_TTS: edge_fake,
        }
    )

    req = SpeechRequest(text="Test speech", provider=SpeechProvider.AWS_POLLY)
    speech = await service.synthesize(req)

    assert speech.audio == b"ID3-polly-audio"
    assert speech.media_type == "audio/mpeg"
    assert polly_fake.last_text == "Test speech"
    assert edge_fake.last_text is None


@pytest.mark.asyncio
async def test_speech_service_no_fallback_on_error() -> None:
    polly_fake = ConfigurableFakeSynthesizer(
        error=IntegrationError("aws_polly", IntegrationErrorCode.UNAVAILABLE, "Polly down")
    )
    edge_fake = ConfigurableFakeSynthesizer(b"ID3-edge-audio")
    service = SpeechService(
        providers={
            SpeechProvider.AWS_POLLY: polly_fake,
            SpeechProvider.EDGE_TTS: edge_fake,
        }
    )

    req = SpeechRequest(text="Test speech", provider=SpeechProvider.AWS_POLLY)
    with pytest.raises(SpeechServiceError) as exc_info:
        await service.synthesize(req)

    assert exc_info.value.code == "provider_unavailable"
    assert exc_info.value.retryable is True
    assert edge_fake.last_text is None


def test_speech_api_success_headers_and_bytes() -> None:
    polly_fake = ConfigurableFakeSynthesizer(b"ID3-polly-binary-data")
    service = SpeechService(
        providers={
            SpeechProvider.AWS_POLLY: polly_fake,
            SpeechProvider.EDGE_TTS: ConfigurableFakeSynthesizer(),
        }
    )
    app = create_app(speech_service=service)
    client = TestClient(app)

    response = client.post(
        "/api/speech",
        json={"text": "Hello VSLingo", "provider": "aws_polly", "voice": None},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.content == b"ID3-polly-binary-data"


def test_speech_api_invalid_provider_returns_422() -> None:
    app = create_app()
    client = TestClient(app)

    response = client.post(
        "/api/speech",
        json={"text": "Hello", "provider": "unknown_provider"},
    )

    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "invalid_request"
    assert data["error"]["retryable"] is False


def test_speech_api_empty_text_returns_422() -> None:
    app = create_app()
    client = TestClient(app)

    response = client.post(
        "/api/speech",
        json={"text": "   ", "provider": "aws_polly"},
    )

    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "empty_text"
    assert data["error"]["retryable"] is False


def test_speech_api_text_too_long_returns_422() -> None:
    app = create_app()
    client = TestClient(app)

    response = client.post(
        "/api/speech",
        json={"text": "x" * 3001, "provider": "aws_polly"},
    )

    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "text_too_long"
    assert data["error"]["retryable"] is False
