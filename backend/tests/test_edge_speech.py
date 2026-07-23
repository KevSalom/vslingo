"""Tests for Edge TTS adapter."""

import pytest

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.providers.edge_speech import EdgeTTSSynthesizer


class MockCommunicate:
    def __init__(self, chunks: list[dict] | None = None, error: Exception | None = None) -> None:
        self.chunks = chunks or [
            {"type": "audio", "data": b"ID3-edge-chunk1"},
            {"type": "audio", "data": b"-chunk2"},
        ]
        self.error = error

    async def stream(self) -> object:
        if self.error is not None:
            raise self.error
        for chunk in self.chunks:
            yield chunk


@pytest.mark.asyncio
async def test_edge_tts_synthesizer_success() -> None:
    settings = Settings(edge_tts_voice="en-US-GuyNeural")
    mock_comm = MockCommunicate()
    synthesizer = EdgeTTSSynthesizer(settings, communicate_factory=lambda text, voice: mock_comm)

    result = await synthesizer.synthesize("Hello Edge")

    assert result.audio == b"ID3-edge-chunk1-chunk2"
    assert result.media_type == "audio/mpeg"


@pytest.mark.asyncio
async def test_edge_tts_empty_audio_raises_invalid_response() -> None:
    settings = Settings(edge_tts_voice="en-US-GuyNeural")
    mock_comm = MockCommunicate(chunks=[{"type": "WordBoundary", "data": b"123"}])
    synthesizer = EdgeTTSSynthesizer(settings, communicate_factory=lambda text, voice: mock_comm)

    with pytest.raises(IntegrationError) as exc_info:
        await synthesizer.synthesize("Hello Edge")

    assert exc_info.value.code == IntegrationErrorCode.INVALID_RESPONSE
    assert exc_info.value.provider == "edge_tts"
