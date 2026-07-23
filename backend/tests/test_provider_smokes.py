from collections.abc import AsyncIterator
from pathlib import Path
from types import TracebackType
from typing import Self

import pytest
from botocore.config import Config
from botocore.exceptions import ReadTimeoutError
from pydantic import SecretStr

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.providers import smoke


class FakeHttpResponse:
    def __init__(
        self,
        *,
        payload: object | None = None,
        lines: tuple[str, ...] = (),
    ) -> None:
        self.payload = payload
        self.lines = lines
        self.closed = False

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.closed = True

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self.payload

    async def aiter_lines(self) -> AsyncIterator[str]:
        for line in self.lines:
            yield line


class FakeHttpClient:
    def __init__(self, response: FakeHttpResponse) -> None:
        self.response = response
        self.closed = False

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.closed = True

    async def post(self, *args: object, **kwargs: object) -> FakeHttpResponse:
        return self.response

    def stream(self, *args: object, **kwargs: object) -> FakeHttpResponse:
        return self.response


class FakeAudioStream:
    def __init__(self) -> None:
        self.closed = False

    def read(self) -> bytes:
        return b"ID3-live-smoke"

    def close(self) -> None:
        self.closed = True


class FakePollyClient:
    def __init__(self, *, timeout: bool = False) -> None:
        self.audio_stream = FakeAudioStream()
        self.timeout = timeout
        self.call_finished = False
        self.closed = False
        self.closed_after_call = False

    def synthesize_speech(self, **kwargs: object) -> dict[str, object]:
        if self.timeout:
            self.call_finished = True
            raise ReadTimeoutError(endpoint_url="https://polly.test")
        self.call_finished = True
        return {"AudioStream": self.audio_stream}

    def close(self) -> None:
        self.closed = True
        self.closed_after_call = self.call_finished


@pytest.fixture
def audio_path(tmp_path: Path) -> Path:
    path = tmp_path / "sample.wav"
    path.write_bytes(b"RIFF-fake-wave")
    return path


def openrouter_settings() -> Settings:
    return Settings(
        _env_file=None,
        openrouter_api_key=SecretStr("test-key"),
        openrouter_llm_model="test/model",
    )


async def test_stt_rejects_blank_transcript_and_closes_client(
    monkeypatch: pytest.MonkeyPatch,
    audio_path: Path,
) -> None:
    response = FakeHttpResponse(payload={"text": "   "})
    client = FakeHttpClient(response)
    monkeypatch.setattr(smoke.httpx, "AsyncClient", lambda **kwargs: client)

    with pytest.raises(IntegrationError) as error:
        await smoke.smoke_openrouter_stt(openrouter_settings(), audio_path)

    assert error.value.code is IntegrationErrorCode.INVALID_RESPONSE
    assert client.closed is True


async def test_chat_rejects_metadata_only_stream_and_closes_resources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = FakeHttpResponse(
        lines=(
            'data: {"choices":[{"delta":{"role":"assistant"}}]}',
            "data: [DONE]",
        )
    )
    client = FakeHttpClient(response)
    monkeypatch.setattr(smoke.httpx, "AsyncClient", lambda **kwargs: client)

    with pytest.raises(IntegrationError) as error:
        await smoke.smoke_openrouter_chat(openrouter_settings())

    assert error.value.code is IntegrationErrorCode.INVALID_RESPONSE
    assert response.closed is True
    assert client.closed is True


@pytest.mark.parametrize("should_timeout", [False, True])
async def test_polly_uses_transport_timeouts_and_closes_after_call(
    monkeypatch: pytest.MonkeyPatch,
    should_timeout: bool,
) -> None:
    client = FakePollyClient(timeout=should_timeout)
    captured: dict[str, object] = {}

    def create_client(service: str, **kwargs: object) -> FakePollyClient:
        assert service == "polly"
        captured.update(kwargs)
        return client

    monkeypatch.setattr(smoke.boto3, "client", create_client)
    settings = Settings(
        _env_file=None,
        aws_access_key_id=SecretStr("test-key"),
        aws_secret_access_key=SecretStr("test-secret"),
        provider_timeout_seconds=0.25,
    )

    if should_timeout:
        with pytest.raises(IntegrationError) as error:
            await smoke.smoke_aws_polly(settings)
        assert error.value.code is IntegrationErrorCode.TIMEOUT
    else:
        await smoke.smoke_aws_polly(settings)
        assert client.audio_stream.closed is True

    transport_config = captured["config"]
    assert isinstance(transport_config, Config)
    assert transport_config.connect_timeout == 0.25
    assert transport_config.read_timeout == 0.25
    assert client.closed is True
    assert client.closed_after_call is True


async def test_runner_invokes_only_the_selected_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def selected(settings: Settings) -> None:
        calls.append("edge-tts")

    async def unexpected(settings: Settings) -> None:
        raise AssertionError("An unselected provider was invoked")

    async def unexpected_stt(settings: Settings, audio: Path) -> None:
        raise AssertionError("An unselected provider was invoked")

    monkeypatch.setattr(smoke, "smoke_edge_tts", selected)
    monkeypatch.setattr(smoke, "smoke_openrouter_chat", unexpected)
    monkeypatch.setattr(smoke, "smoke_aws_polly", unexpected)
    monkeypatch.setattr(smoke, "smoke_openrouter_stt", unexpected_stt)

    await smoke._run("edge-tts", None, Settings(_env_file=None))

    assert calls == ["edge-tts"]
