"""Acceptance coverage for T09 security, limits, and safe observability."""

import json
import logging
from collections.abc import AsyncIterator, Sequence
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.testclient import WebSocketDenialResponse

from app.core.config import Settings
from app.domain.models import ChatMessage, Transcription
from app.main import create_app
from app.providers.fakes import FakeSpeechToText
from app.voice.session import VoiceSession


class QuietLanguageModel:
    """Deterministic LLM fake that produces no provider content."""

    def stream_chat(self, messages: Sequence[ChatMessage]) -> AsyncIterator[str]:
        del messages

        async def empty() -> AsyncIterator[str]:
            if False:
                yield ""

        return empty()


def settings(**overrides: object) -> Settings:
    """Build small, deterministic protection limits for integration tests."""

    return Settings(
        _env_file=None,
        environment="test",
        frontend_origin="http://localhost:4321",
        max_http_requests_per_minute=2,
        max_speech_requests_per_minute=1,
        max_ws_connections=1,
        max_ws_connections_per_ip=1,
        max_voice_session_seconds=900,
        max_voice_turns=1,
        max_audio_seconds=60,
        max_audio_bytes=2_000_044,
        max_concurrent_stt=1,
        max_concurrent_llm=1,
        max_concurrent_tts=1,
        max_concurrent_video=1,
        provider_acquire_timeout_seconds=0.01,
        **overrides,
    )


def test_settings_rejects_non_origin_and_insecure_production_origin() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, frontend_origin="http://localhost:4321/demo")
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            environment="production",
            frontend_origin="http://localhost:4321",
        )


def test_api_sets_restrictive_cors_security_headers_and_rate_limits_by_socket_ip() -> None:
    app = create_app(settings())
    client = TestClient(app)

    preflight = client.options(
        "/api/speech",
        headers={
            "Origin": "http://localhost:4321",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:4321"
    assert preflight.headers["access-control-allow-methods"] == "GET, POST, OPTIONS"

    health = client.get("/api/health")
    assert health.headers["x-content-type-options"] == "nosniff"
    assert health.headers["referrer-policy"] == "no-referrer"
    assert health.headers["cache-control"] == "no-store"

    first = client.post("/api/speech", json={"text": "one", "provider": "edge_tts"})
    second = client.post(
        "/api/speech",
        json={"text": "two", "provider": "edge_tts"},
        headers={"X-Forwarded-For": "203.0.113.9"},
    )
    assert first.status_code != 429
    assert second.status_code == 429
    assert second.json()["error"] == {
        "code": "rate_limited",
        "message": "Has alcanzado el límite temporal de solicitudes. Inténtalo de nuevo pronto.",
        "retryable": True,
    }
    assert second.headers["retry-after"].isdigit()


def test_ws_rejects_wrong_or_missing_origin_before_accepting() -> None:
    client = TestClient(create_app(settings()))

    for headers in ({}, {"origin": "https://attacker.example"}):
        with (
            pytest.raises(WebSocketDenialResponse) as denied,
            client.websocket_connect("/api/voice/ws", headers=headers),
        ):
            pass
        assert denied.value.status_code == 403

    with client.websocket_connect(
        "/api/voice/ws", headers={"origin": "http://localhost:4321"}
    ) as websocket:
        websocket.send_json({"type": "session.start", "protocol_version": 1})
        assert websocket.receive_json()["type"] == "session.ready"


@pytest.mark.asyncio
async def test_turn_limit_is_fatal_and_never_logs_or_returns_canary_content(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class StubWebSocket:
        closed: list[int]

        def __init__(self) -> None:
            self.closed = []

        async def close(self, code: int = 1000) -> None:
            self.closed.append(code)

    websocket = StubWebSocket()
    session = VoiceSession(
        websocket,  # type: ignore[arg-type]
        FakeSpeechToText(result=Transcription(text="CANARY_TRANSCRIPT")),
        llm_provider=QuietLanguageModel(),
        settings=settings(),
    )
    try:
        await session._handle_text('{"type":"session.start","protocol_version":1}')
        await session.outbound_queue.get()
        session.outbound_queue.task_done()
        await session._handle_text(
            '{"type":"speech.started","turn_id":"turn-1","generation":1}'
        )
        await session._handle_text(
            '{"type":"utterance.begin","turn_id":"turn-1","generation":1,'
            '"media_type":"audio/wav","byte_length":44,"duration_ms":100}'
        )
        await session._handle_text(
            '{"type":"speech.started","turn_id":"turn-2","generation":2}'
        )
        await session._handle_text(
            '{"type":"utterance.begin","turn_id":"turn-2","generation":2,'
            '"media_type":"audio/wav","byte_length":44,"duration_ms":100}'
        )
        error = json.loads(await session.outbound_queue.get())
        session.outbound_queue.task_done()

        assert error["type"] == "error"
        assert error["code"] == "turn_limit_reached"
        assert error["fatal"] is True
        assert websocket.closed == [1008]
        assert "CANARY_TRANSCRIPT" not in caplog.text
    finally:
        await session._cleanup()


def test_shared_protocol_fixture_includes_safe_metrics_contract() -> None:
    fixture = json.loads(
        (Path(__file__).parents[2] / "docs" / "contracts" / "voice-protocol-v1.json").read_text(
            encoding="utf-8"
        )
    )

    assert fixture["client_events"]["playback_started"] == {
        "type": "playback.started",
        "turn_id": "123e4567-e89b-12d3-a456-426614174000",
        "generation": 1,
        "segment_id": "223e4567-e89b-12d3-a456-426614174000",
    }
    metric = fixture["server_events"]["metrics_stage"]
    assert metric["type"] == "metrics.stage"
    assert metric["stage"] == "stt_final"
    assert "text" not in metric



@pytest.mark.asyncio
async def test_process_local_limiters_gates_and_safe_log_allowlist() -> None:
    from app.core.observability import log_operational_event
    from app.core.protection import (
        ConnectionLimiter,
        ProviderBusyError,
        ProviderGate,
        RequestLimiter,
        SlidingWindowLimiter,
    )

    now = [10.0]
    limiter = SlidingWindowLimiter(clock=lambda: now[0])
    assert limiter.check("ip", 1).allowed is True
    denied = limiter.check("ip", 1)
    assert denied.allowed is False
    assert denied.retry_after_seconds == 60
    now[0] += 60
    assert limiter.check("ip", 1).allowed is True

    request_limiter = RequestLimiter(
        max_http_requests_per_minute=2,
        max_speech_requests_per_minute=1,
        limiter=SlidingWindowLimiter(clock=lambda: now[0]),
    )
    connections = ConnectionLimiter(
        max_connections=1,
        max_connections_per_ip=1,
        request_limiter=request_limiter,
    )
    assert connections.try_open("127.0.0.1") is True
    assert connections.try_open("127.0.0.1") is False
    connections.release("127.0.0.1")

    gate = ProviderGate(1, acquire_timeout_seconds=0.001)
    async with gate.slot():
        with pytest.raises(ProviderBusyError):
            async with gate.slot():
                pass
    async with gate.slot():
        pass

    captured: list[str] = []

    class CaptureHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record.getMessage())

    telemetry_logger = logging.getLogger("vslingo.telemetry")
    handler = CaptureHandler()
    telemetry_logger.addHandler(handler)
    telemetry_logger.setLevel(logging.INFO)
    try:
        log_operational_event(
            event="voice_stage_completed",
            turn_id="turn-1",
            latency_ms=12,
            transcript="CANARY_TRANSCRIPT",
            authorization="CANARY_SECRET",
        )
    finally:
        telemetry_logger.removeHandler(handler)
    assert "CANARY" not in "".join(captured)
