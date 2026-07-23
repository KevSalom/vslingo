"""Tests for Voice Protocol v1 Pydantic models against shared contract fixture."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.domain.voice_protocol import (
    client_adapter,
    server_adapter,
)

CONTRACT_PATH = Path(__file__).parents[2] / "docs" / "contracts" / "voice-protocol-v1.json"


def test_fixture_parsing() -> None:
    assert CONTRACT_PATH.exists(), f"Contract fixture missing at {CONTRACT_PATH}"
    data = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    assert data["protocol_version"] == 1

    # Validate client events
    for _name, msg in data["client_events"].items():
        parsed_client = client_adapter.validate_python(msg)
        assert parsed_client.type == msg["type"]

    # Validate server events
    for _name, msg in data["server_events"].items():
        parsed_server = server_adapter.validate_python(msg)
        assert parsed_server.type == msg["type"]


def test_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        client_adapter.validate_python({
            "type": "session.start",
            "protocol_version": 1,
            "extra_field": "hacker",
        })


def test_rejects_invalid_audio_length() -> None:
    with pytest.raises(ValidationError):
        client_adapter.validate_python({
            "type": "utterance.begin",
            "turn_id": "123e4567-e89b-12d3-a456-426614174000",
            "generation": 1,
            "media_type": "audio/wav",
            "byte_length": 3_000_000,  # Exceeds max 2000044
            "duration_ms": 1000,
        })


def test_rejects_unsupported_protocol() -> None:
    with pytest.raises(ValidationError):
        client_adapter.validate_python({
            "type": "session.start",
            "protocol_version": 2,
        })
