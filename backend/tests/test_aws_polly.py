"""Tests for AWS Polly adapter."""

import io

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.providers.aws_polly import AWSPollySynthesizer


class MockPollyClient:
    def __init__(
        self, audio_bytes: bytes = b"ID3-polly-stream", error: Exception | None = None
    ) -> None:
        self.audio_bytes = audio_bytes
        self.error = error
        self.last_kwargs: dict | None = None
        self.closed = False

    def synthesize_speech(self, **kwargs: object) -> dict:
        self.last_kwargs = kwargs
        if self.error is not None:
            raise self.error
        stream = io.BytesIO(self.audio_bytes)
        return {"AudioStream": stream}

    def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_aws_polly_synthesizer_success() -> None:
    settings = Settings(
        aws_access_key_id=SecretStr("AKIAIOSFODNN7EXAMPLE"),
        aws_secret_access_key=SecretStr("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
        aws_region="us-east-1",
        aws_polly_voice_id="Matthew",
    )
    mock_client = MockPollyClient(b"ID3-neural-polly")
    synthesizer = AWSPollySynthesizer(settings, client_factory=lambda: mock_client)

    result = await synthesizer.synthesize("Hello world")

    assert result.audio == b"ID3-neural-polly"
    assert result.media_type == "audio/mpeg"
    assert mock_client.last_kwargs == {
        "Engine": "neural",
        "OutputFormat": "mp3",
        "SampleRate": "24000",
        "TextType": "text",
        "Text": "Hello world",
        "VoiceId": "Matthew",
    }
    assert mock_client.closed is True


@pytest.mark.asyncio
async def test_aws_polly_unconfigured_raises_integration_error() -> None:
    settings = Settings(
        aws_access_key_id=None,
        aws_secret_access_key=None,
    )
    synthesizer = AWSPollySynthesizer(settings)

    with pytest.raises(IntegrationError) as exc_info:
        await synthesizer.synthesize("Hello")

    assert exc_info.value.code == IntegrationErrorCode.NOT_CONFIGURED
    assert exc_info.value.provider == "aws_polly"
