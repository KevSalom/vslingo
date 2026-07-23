"""Integration tests for VoiceSession WebSocket v1 protocol via FastAPI TestClient."""

import struct

import pytest
from fastapi.testclient import TestClient

from app.domain.models import Transcription
from app.main import create_app
from app.providers.fakes import FakeSpeechToText


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
def client(fake_stt: FakeSpeechToText) -> TestClient:
    app = create_app(stt_provider=fake_stt)
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


def test_voice_ws_full_ptt_turn(client: TestClient) -> None:
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

        # Receive final transcript
        res = ws.receive_json()
        assert res["type"] == "transcript.final"
        assert res["turn_id"] == turn_id
        assert res["generation"] == 1
        assert res["text"] == "I deployed the API."


def test_voice_ws_invalid_generation_rejection(client: TestClient) -> None:
    with client.websocket_connect("/api/voice/ws") as ws:
        ws.send_json({"type": "session.start", "protocol_version": 1})
        _ = ws.receive_json()

        # Propose generation 5 instead of 1
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
