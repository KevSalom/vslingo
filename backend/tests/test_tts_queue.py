"""Unit tests for TTSConsumer."""

import asyncio

import pytest

from app.domain.models import SynthesizedSpeech
from app.domain.speech import SpeechRequest
from app.voice.tts_queue import TTSConsumer, TTSSegmentItem


class FakeSpeechService:
    def __init__(self, should_fail: bool = False) -> None:
        self.should_fail = should_fail
        self.synthesized_texts: list[str] = []

    async def synthesize(self, request: SpeechRequest) -> SynthesizedSpeech:
        if self.should_fail:
            raise RuntimeError("TTS engine offline")
        self.synthesized_texts.append(request.text)
        return SynthesizedSpeech(
            audio=b"FAKE_MP3_BYTES_" + request.text.encode(),
            media_type="audio/mpeg",
        )


@pytest.mark.asyncio
async def test_tts_consumer_basic_flow() -> None:
    speech_svc = FakeSpeechService()
    written_messages: list[str | bytes] = []

    async def fake_writer(msg: str | bytes) -> None:
        written_messages.append(msg)

    consumer = TTSConsumer(speech_service=speech_svc, outbound_writer=fake_writer)
    consumer.start()

    item = TTSSegmentItem(
        turn_id="turn-1",
        generation=1,
        segment_index=0,
        text="Hello world.",
        provider="aws_polly",
    )
    enqueued = await consumer.enqueue(item, active_generation=1)
    assert enqueued is True

    await asyncio.sleep(0.1)
    await consumer.stop()

    assert len(written_messages) == 3
    assert "audio.begin" in written_messages[0]  # type: ignore[operator]
    assert written_messages[1] == b"FAKE_MP3_BYTES_Hello world."
    assert "audio.end" in written_messages[2]  # type: ignore[operator]


@pytest.mark.asyncio
async def test_tts_consumer_cancellation() -> None:
    speech_svc = FakeSpeechService()
    written_messages: list[str | bytes] = []

    async def fake_writer(msg: str | bytes) -> None:
        written_messages.append(msg)

    consumer = TTSConsumer(speech_service=speech_svc, outbound_writer=fake_writer)
    consumer.mark_generation_cancelled(1)
    consumer.start()

    item = TTSSegmentItem(
        turn_id="turn-1",
        generation=1,
        segment_index=0,
        text="Hello world.",
        provider="aws_polly",
    )
    enqueued = await consumer.enqueue(item, active_generation=1)
    assert enqueued is False

    await asyncio.sleep(0.05)
    await consumer.stop()
    assert len(written_messages) == 0



@pytest.mark.asyncio
async def test_tts_consumer_cancels_active_synthesis() -> None:
    first_started = asyncio.Event()
    first_cancelled = asyncio.Event()
    second_written = asyncio.Event()
    written_messages: list[str | bytes] = []

    class BlockingSpeechService:
        async def synthesize(self, request: SpeechRequest) -> SynthesizedSpeech:
            if request.text == "First.":
                first_started.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    first_cancelled.set()
                    raise
            return SynthesizedSpeech(audio=b"SECOND_MP3", media_type="audio/mpeg")

    async def fake_writer(msg: str | bytes) -> None:
        written_messages.append(msg)
        if msg == b"SECOND_MP3":
            second_written.set()

    consumer = TTSConsumer(BlockingSpeechService(), fake_writer)
    consumer.start()
    try:
        await consumer.enqueue(
            TTSSegmentItem("turn-1", 1, 0, "First.", "aws_polly"),
            active_generation=1,
        )
        await asyncio.wait_for(first_started.wait(), timeout=1)
        consumer.mark_generation_cancelled(1)
        await asyncio.wait_for(first_cancelled.wait(), timeout=1)

        await consumer.enqueue(
            TTSSegmentItem("turn-2", 2, 0, "Second.", "edge_tts"),
            active_generation=2,
        )
        await asyncio.wait_for(second_written.wait(), timeout=1)
    finally:
        await consumer.stop()

    assert b"SECOND_MP3" in written_messages


@pytest.mark.asyncio
async def test_tts_consumer_rejects_oversized_audio_and_keeps_running() -> None:
    error_written = asyncio.Event()
    valid_written = asyncio.Event()
    written_messages: list[str | bytes] = []

    class SizedSpeechService:
        async def synthesize(self, request: SpeechRequest) -> SynthesizedSpeech:
            audio = b"x" * 2_000_001 if request.text == "Too large." else b"VALID_MP3"
            return SynthesizedSpeech(audio=audio, media_type="audio/mpeg")

    async def fake_writer(msg: str | bytes) -> None:
        written_messages.append(msg)
        if isinstance(msg, str) and "speech_unavailable" in msg:
            error_written.set()
        if msg == b"VALID_MP3":
            valid_written.set()

    consumer = TTSConsumer(SizedSpeechService(), fake_writer)
    consumer.start()
    try:
        await consumer.enqueue(
            TTSSegmentItem("turn-1", 1, 0, "Too large.", "aws_polly"),
            active_generation=1,
        )
        await asyncio.wait_for(error_written.wait(), timeout=1)
        await consumer.enqueue(
            TTSSegmentItem("turn-2", 2, 0, "Valid.", "aws_polly"),
            active_generation=2,
        )
        await asyncio.wait_for(valid_written.wait(), timeout=1)
    finally:
        await consumer.stop()

    assert any(isinstance(msg, str) and "speech_unavailable" in msg for msg in written_messages)
    assert b"VALID_MP3" in written_messages
