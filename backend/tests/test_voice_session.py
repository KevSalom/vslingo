"""Integration tests for VoiceSession WebSocket v1 protocol via FastAPI TestClient (T05 & T06)."""

import struct

import pytest
from fastapi.testclient import TestClient

from app.domain.models import Transcription
from app.main import create_app
from app.providers.fakes import FakeLanguageModel, FakeSpeechToText, FakeVoiceFeedback


def make_valid_wav_pcm_16k_mono(duration_ms: int = 1000) -> bytes:
    """Generate a minimal valid 16-bit 16kHz mono PCM WAV byte buffer."""
    sample_rate = 16000
    num_samples = int(sample_rate * (duration_ms / 1000.0))
    data_size = num_samples * 2
    file_size = 36 + data_size

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        file_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        1,  # mono
        16000,
        32000,
        2,
        16,
        b"data",
        data_size,
    )
    return header + (b"\x00\x00" * num_samples)


@pytest.fixture
def fake_stt() -> FakeSpeechToText:
    return FakeSpeechToText(result=Transcription(text="I deployed the API."))


@pytest.fixture
def fake_llm() -> FakeLanguageModel:
    return FakeLanguageModel(chunks=("That sounds ", "great!"))


@pytest.fixture
def fake_feedback() -> FakeVoiceFeedback:
    return FakeVoiceFeedback()


@pytest.fixture
def client(
    fake_stt: FakeSpeechToText,
    fake_llm: FakeLanguageModel,
    fake_feedback: FakeVoiceFeedback,
) -> TestClient:
    app = create_app(
        stt_provider=fake_stt,
        llm_provider=fake_llm,
        feedback_provider=fake_feedback,
    )
    return TestClient(app)


def test_voice_ws_handshake_and_config(client: TestClient) -> None:
    with client.websocket_connect("/api/voice/ws") as ws:
        # Start session
        ws.send_json({"type": "session.start", "protocol_version": 1})
        ready = ws.receive_json()
        assert ready["type"] == "session.ready"
        assert ready["protocol_version"] == 1
        assert ready["generation"] == 0
        assert "session_id" in ready

        # Config session
        ws.send_json({
            "type": "session.config",
            "scenario": "daily_standup",
            "speech_provider": "aws_polly",
        })
        configured = ws.receive_json()
        assert configured["type"] == "session.configured"
        assert configured["scenario"] == "daily_standup"
        assert configured["config_revision"] == 1


def test_voice_ws_full_ptt_turn_with_stream_and_feedback(client: TestClient) -> None:
    wav_bytes = make_valid_wav_pcm_16k_mono(1000)
    turn_id = "123e4567-e89b-12d3-a456-426614174000"

    with client.websocket_connect("/api/voice/ws") as ws:
        ws.send_json({"type": "session.start", "protocol_version": 1})
        _ = ws.receive_json()

        # Proposed generation 1
        ws.send_json({
            "type": "speech.started",
            "turn_id": turn_id,
            "generation": 1,
        })

        # Utterance begin
        ws.send_json({
            "type": "utterance.begin",
            "turn_id": turn_id,
            "generation": 1,
            "media_type": "audio/wav",
            "byte_length": len(wav_bytes),
            "duration_ms": 1000,
        })

        # Send binary WAV
        ws.send_bytes(wav_bytes)

        # Collect events until done and feedback ready
        events = []
        for _ in range(5):  # transcript.final, 2x delta, assistant.done, feedback.ready
            events.append(ws.receive_json())

        event_types = [e["type"] for e in events]
        assert "transcript.final" in event_types
        assert "assistant.delta" in event_types
        assert "assistant.done" in event_types
        assert "feedback.ready" in event_types

        # Verify assistant done text matches concatenated deltas
        deltas = [e["delta"] for e in events if e["type"] == "assistant.delta"]
        done_event = next(e for e in events if e["type"] == "assistant.done")
        assert done_event["text"] == "".join(deltas)


def test_voice_ws_feedback_error_does_not_cancel_conversation(
    fake_stt: FakeSpeechToText,
    fake_llm: FakeLanguageModel,
) -> None:
    failing_feedback = FakeVoiceFeedback(error=RuntimeError("Feedback model down"))
    app = create_app(
        stt_provider=fake_stt,
        llm_provider=fake_llm,
        feedback_provider=failing_feedback,
    )
    client = TestClient(app)
    wav_bytes = make_valid_wav_pcm_16k_mono(1000)
    turn_id = "123e4567-e89b-12d3-a456-426614174000"

    with client.websocket_connect("/api/voice/ws") as ws:
        ws.send_json({"type": "session.start", "protocol_version": 1})
        _ = ws.receive_json()

        ws.send_json({"type": "speech.started", "turn_id": turn_id, "generation": 1})
        ws.send_json({
            "type": "utterance.begin",
            "turn_id": turn_id,
            "generation": 1,
            "media_type": "audio/wav",
            "byte_length": len(wav_bytes),
            "duration_ms": 1000,
        })
        ws.send_bytes(wav_bytes)

        events = []
        for _ in range(5):
            events.append(ws.receive_json())

        event_types = [e["type"] for e in events]
        assert "assistant.done" in event_types
        # Error event for feedback_unavailable
        err_event = next(e for e in events if e["type"] == "error")
        assert err_event["code"] == "feedback_unavailable"
        assert err_event["retryable"] is True


def test_voice_ws_invalid_generation_rejection(client: TestClient) -> None:
    with client.websocket_connect("/api/voice/ws") as ws:
        ws.send_json({"type": "session.start", "protocol_version": 1})
        _ = ws.receive_json()

        ws.send_json({
            "type": "speech.started",
            "turn_id": "123e4567-e89b-12d3-a456-426614174000",
            "generation": 5,
        })

        err = ws.receive_json()
        assert err["type"] == "error"
        assert err["code"] == "invalid_generation"
        assert err["fatal"] is False


def test_voice_ws_invalid_wav_rejection(client: TestClient) -> None:
    bad_bytes = b"NOT_A_WAV_HEADER_AT_ALL_MOCK_DATA"

    with client.websocket_connect("/api/voice/ws") as ws:
        ws.send_json({"type": "session.start", "protocol_version": 1})
        _ = ws.receive_json()

        ws.send_json({
            "type": "speech.started",
            "turn_id": "123e4567-e89b-12d3-a456-426614174000",
            "generation": 1,
        })

        ws.send_json({
            "type": "utterance.begin",
            "turn_id": "123e4567-e89b-12d3-a456-426614174000",
            "generation": 1,
            "media_type": "audio/wav",
            "byte_length": len(bad_bytes),
            "duration_ms": 1000,
        })

        ws.send_bytes(bad_bytes)

        err = ws.receive_json()
        assert err["type"] == "error"
        assert err["code"] == "invalid_audio"


def test_voice_ws_cancel_turn(client: TestClient) -> None:
    with client.websocket_connect("/api/voice/ws") as ws:
        ws.send_json({"type": "session.start", "protocol_version": 1})
        _ = ws.receive_json()

        ws.send_json({
            "type": "speech.started",
            "turn_id": "123e4567-e89b-12d3-a456-426614174000",
            "generation": 1,
        })

        ws.send_json({
            "type": "response.cancel",
            "turn_id": "123e4567-e89b-12d3-a456-426614174000",
            "generation": 1,
        })

        cancelled = ws.receive_json()
        assert cancelled["type"] == "response.cancelled"
        assert cancelled["turn_id"] == "123e4567-e89b-12d3-a456-426614174000"



@pytest.mark.asyncio
async def test_speech_started_cancels_previous_generation_not_the_new_one(
    fake_stt: FakeSpeechToText,
    fake_llm: FakeLanguageModel,
) -> None:
    """A newly accepted generation must remain eligible for TTS enqueueing."""
    from app.voice.session import VoiceSession
    from app.voice.tts_queue import TTSSegmentItem

    class StubWebSocket:
        async def close(self, code: int = 1000) -> None:
            del code

    class StubSpeechService:
        async def synthesize(self, request: object) -> object:
            del request
            raise AssertionError("The consumer is not exercised by this state test")

    session = VoiceSession(
        StubWebSocket(),  # type: ignore[arg-type]
        fake_stt,
        llm_provider=fake_llm,
        speech_service=StubSpeechService(),
    )
    try:
        await session._handle_text('{"type":"session.start","protocol_version":1}')
        await session._handle_text(
            '{"type":"speech.started","turn_id":"turn-1","generation":1}'
        )

        assert session.tts_consumer is not None
        accepted = await session.tts_consumer.enqueue(
            TTSSegmentItem(
                turn_id="turn-1",
                generation=1,
                segment_index=0,
                text="Hello.",
                provider="aws_polly",
            ),
            active_generation=session.current_generation,
        )
        assert accepted is True
    finally:
        await session._cleanup()



@pytest.mark.asyncio
async def test_stale_response_cancel_does_not_cancel_current_generation(
    fake_stt: FakeSpeechToText,
) -> None:
    from app.voice.session import VoiceSession
    from app.voice.tts_queue import TTSSegmentItem

    class StubWebSocket:
        async def close(self, code: int = 1000) -> None:
            del code

    class StubSpeechService:
        async def synthesize(self, request: object) -> object:
            del request
            raise AssertionError("Not exercised")

    session = VoiceSession(
        StubWebSocket(),  # type: ignore[arg-type]
        fake_stt,
        speech_service=StubSpeechService(),
    )
    try:
        await session._handle_text('{"type":"session.start","protocol_version":1}')
        await session._handle_text(
            '{"type":"speech.started","turn_id":"turn-1","generation":1}'
        )
        await session._handle_text(
            '{"type":"speech.started","turn_id":"turn-2","generation":2}'
        )
        await session._handle_text(
            '{"type":"response.cancel","turn_id":"turn-1","generation":1}'
        )

        assert session.tts_consumer is not None
        accepted = await session.tts_consumer.enqueue(
            TTSSegmentItem("turn-2", 2, 0, "Current.", "aws_polly"),
            active_generation=2,
        )
        assert accepted is True
        assert session.active_turn_id == "turn-2"
    finally:
        await session._cleanup()



@pytest.mark.asyncio
async def test_active_turn_configuration_is_cancelled_then_applied(
    fake_stt: FakeSpeechToText,
) -> None:
    import json

    from app.voice.session import VoiceSession

    class StubWebSocket:
        async def close(self, code: int = 1000) -> None:
            del code

    session = VoiceSession(StubWebSocket(), fake_stt)  # type: ignore[arg-type]
    await session._handle_text('{"type":"session.start","protocol_version":1}')
    await session.outbound_queue.get()
    session.outbound_queue.task_done()
    await session._handle_text(
        '{"type":"speech.started","turn_id":"turn-1","generation":1}'
    )
    await session._handle_text(
        '{"type":"session.config","scenario":"free","speech_provider":"edge_tts"}'
    )

    cancelled = json.loads(await session.outbound_queue.get())
    session.outbound_queue.task_done()
    configured = json.loads(await session.outbound_queue.get())
    session.outbound_queue.task_done()

    assert cancelled == {
        "type": "response.cancelled",
        "turn_id": "turn-1",
        "generation": 1,
    }
    assert configured["type"] == "session.configured"
    assert configured["scenario"] == "free"
    assert configured["speech_provider"] == "edge_tts"
    assert session.active_turn_id is None
