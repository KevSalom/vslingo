import time
from dataclasses import dataclass

import pytest
from requests import HTTPError, PreparedRequest, Response, Session
from requests.exceptions import (
    ConnectionError as RequestsConnectionError,
)
from requests.exceptions import (
    Timeout as RequestsTimeout,
)
from youtube_transcript_api._errors import (
    RequestBlocked,
    TranscriptsDisabled,
    YouTubeDataUnparsable,
    YouTubeRequestFailed,
)

from app.domain.video import TranscriptSource, VideoProviderError, VideoProviderErrorCode
from app.providers.youtube_transcript import (
    BoundedTimeoutSession,
    YouTubeTranscriptProvider,
)

VIDEO_ID = "aircAruvnKk"


@dataclass(frozen=True)
class _Snippet:
    text: str
    start: float
    duration: float


class _Track:
    def __init__(
        self,
        language_code: str,
        snippets: list[_Snippet],
        *,
        is_generated: bool = False,
        is_translatable: bool = False,
    ) -> None:
        self.language_code = language_code
        self.is_generated = is_generated
        self.is_translatable = is_translatable
        self._snippets = snippets
        self.translated_to: list[str] = []

    def translate(self, language_code: str) -> "_Track":
        self.translated_to.append(language_code)
        return _Track("en", self._snippets)

    def fetch(self) -> list[_Snippet]:
        return self._snippets


class _Client:
    def __init__(self, tracks: list[_Track]) -> None:
        self.tracks = tracks
        self.calls: list[str] = []

    def list(self, video_id: str) -> list[_Track]:
        self.calls.append(video_id)
        return self.tracks


class _FailingClient:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def list(self, video_id: str) -> list[_Track]:
        del video_id
        raise self.error


class _SlowClient:
    def list(self, video_id: str) -> list[_Track]:
        del video_id
        time.sleep(0.05)
        return [_Track("en", [_Snippet("Too late.", 0.0, 1.0)])]


async def test_youtube_provider_prefers_direct_manual_english_captions() -> None:
    generated = _Track(
        "en",
        [_Snippet("Generated captions.", 0.0, 2.0)],
        is_generated=True,
    )
    manual = _Track("en-GB", [_Snippet("Manual &amp; captions.", 0.0, 2.0)])
    client = _Client([generated, manual])
    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=lambda: client,
    )

    result = await provider.fetch(VIDEO_ID)

    assert result.source is TranscriptSource.YOUTUBE
    assert result.segments[0].text == "Manual & captions."
    assert client.calls == [VIDEO_ID]


async def test_youtube_provider_translates_the_first_translatable_track() -> None:
    track = _Track(
        "es",
        [_Snippet("Translated English captions.", 1.0, 2.5)],
        is_translatable=True,
    )
    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=lambda: _Client([track]),
    )

    result = await provider.fetch(VIDEO_ID)

    assert track.translated_to == ["en"]
    assert result.segments[0].start == 1.0


async def test_youtube_provider_reports_missing_captions() -> None:
    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=lambda: _Client([]),
    )

    with pytest.raises(VideoProviderError) as exc_info:
        await provider.fetch(VIDEO_ID)

    assert exc_info.value.code is VideoProviderErrorCode.CAPTIONS_UNAVAILABLE


@pytest.mark.parametrize(
    ("provider_error", "expected_code"),
    [
        (RequestBlocked(VIDEO_ID), VideoProviderErrorCode.PROVIDER_BLOCKED),
        (TranscriptsDisabled(VIDEO_ID), VideoProviderErrorCode.CAPTIONS_UNAVAILABLE),
        (YouTubeDataUnparsable(VIDEO_ID), VideoProviderErrorCode.INVALID_RESPONSE),
        (
            YouTubeRequestFailed(VIDEO_ID, HTTPError("private response")),
            VideoProviderErrorCode.UNAVAILABLE,
        ),
        (
            RequestsConnectionError("private connection diagnostic"),
            VideoProviderErrorCode.UNAVAILABLE,
        ),
        (RequestsTimeout("private timeout diagnostic"), VideoProviderErrorCode.TIMEOUT),
    ],
)
async def test_youtube_provider_classifies_library_and_transport_failures(
    provider_error: Exception,
    expected_code: VideoProviderErrorCode,
) -> None:
    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=lambda: _FailingClient(provider_error),
    )

    with pytest.raises(VideoProviderError) as exc_info:
        await provider.fetch(VIDEO_ID)

    assert exc_info.value.code is expected_code
    assert "private" not in str(exc_info.value)


def test_bounded_timeout_session_injects_and_preserves_transport_timeouts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed_timeouts: list[object] = []

    def fake_send(
        _session: Session,
        _request: PreparedRequest,
        **kwargs: object,
    ) -> Response:
        observed_timeouts.append(kwargs.get("timeout"))
        return Response()

    monkeypatch.setattr(Session, "send", fake_send)
    session = BoundedTimeoutSession(0.25)
    request = PreparedRequest()

    session.send(request)
    session.send(request, timeout=0.75)

    assert observed_timeouts == [0.25, 0.75]


async def test_youtube_provider_rejects_empty_and_malformed_transcripts() -> None:
    cases = (
        _Track("en", []),
        _Track("en", [_Snippet("", 0.0, 1.0)]),
    )

    for track in cases:
        provider = YouTubeTranscriptProvider(
            timeout_seconds=1.0,
            client_factory=lambda track=track: _Client([track]),
        )
        with pytest.raises(VideoProviderError) as exc_info:
            await provider.fetch(VIDEO_ID)
        assert exc_info.value.code is VideoProviderErrorCode.INVALID_RESPONSE


async def test_youtube_provider_enforces_its_async_timeout() -> None:
    provider = YouTubeTranscriptProvider(
        timeout_seconds=0.001,
        client_factory=_SlowClient,
    )

    with pytest.raises(VideoProviderError) as exc_info:
        await provider.fetch(VIDEO_ID)

    assert exc_info.value.code is VideoProviderErrorCode.TIMEOUT



async def test_youtube_provider_uses_a_bounded_ttl_lru_cache() -> None:
    other_video_id = "dQw4w9WgXcQ"
    third_video_id = "5qap5aO4i9A"
    clock = [100.0]
    client = _Client([_Track("en", [_Snippet("Cached captions.", 0.0, 1.0)])])
    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=lambda: client,
        cache_ttl_seconds=30.0,
        cache_max_entries=2,
        clock=lambda: clock[0],
    )

    await provider.fetch(VIDEO_ID)
    await provider.fetch(other_video_id)
    await provider.fetch(VIDEO_ID)
    await provider.fetch(third_video_id)
    await provider.fetch(other_video_id)

    assert client.calls == [VIDEO_ID, other_video_id, third_video_id, other_video_id]

    clock[0] += 31.0
    await provider.fetch(VIDEO_ID)
    assert client.calls[-1] == VIDEO_ID


async def test_youtube_provider_retries_one_transient_failure() -> None:
    client = _Client([_Track("en", [_Snippet("Recovered captions.", 0.0, 1.0)])])
    factory_calls = 0

    def client_factory() -> _Client | _FailingClient:
        nonlocal factory_calls
        factory_calls += 1
        if factory_calls == 1:
            return _FailingClient(RequestsConnectionError("temporary failure"))
        return client

    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=client_factory,
        max_attempts=2,
    )

    result = await provider.fetch(VIDEO_ID)

    assert result.segments[0].text == "Recovered captions."
    assert factory_calls == 2
    assert client.calls == [VIDEO_ID]


async def test_youtube_provider_does_not_retry_permanent_failures() -> None:
    factory_calls = 0

    def client_factory() -> _FailingClient:
        nonlocal factory_calls
        factory_calls += 1
        return _FailingClient(RequestBlocked(VIDEO_ID))

    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=client_factory,
        max_attempts=2,
    )

    with pytest.raises(VideoProviderError) as exc_info:
        await provider.fetch(VIDEO_ID)

    assert exc_info.value.code is VideoProviderErrorCode.PROVIDER_BLOCKED
    assert factory_calls == 1

def test_youtube_provider_rejects_more_than_two_attempts() -> None:
    with pytest.raises(ValueError):
        YouTubeTranscriptProvider(timeout_seconds=1.0, max_attempts=3)


@pytest.mark.parametrize(
    ("provider_error", "expected_code"),
    [
        (
            RequestsConnectionError("temporary failure"),
            VideoProviderErrorCode.UNAVAILABLE,
        ),
        (RequestsTimeout("temporary timeout"), VideoProviderErrorCode.TIMEOUT),
    ],
)
async def test_youtube_provider_stops_after_two_transient_failures(
    provider_error: Exception,
    expected_code: VideoProviderErrorCode,
) -> None:
    factory_calls = 0

    def client_factory() -> _FailingClient:
        nonlocal factory_calls
        factory_calls += 1
        return _FailingClient(provider_error)

    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=client_factory,
        max_attempts=2,
    )

    with pytest.raises(VideoProviderError) as exc_info:
        await provider.fetch(VIDEO_ID)

    assert exc_info.value.code is expected_code
    assert factory_calls == 2


async def test_youtube_provider_does_not_cache_errors() -> None:
    client = _Client([_Track("en", [_Snippet("Fresh captions.", 0.0, 1.0)])])
    factory_calls = 0

    def client_factory() -> _Client | _FailingClient:
        nonlocal factory_calls
        factory_calls += 1
        if factory_calls == 1:
            return _FailingClient(RequestsConnectionError("temporary failure"))
        return client

    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=client_factory,
        max_attempts=1,
    )

    with pytest.raises(VideoProviderError):
        await provider.fetch(VIDEO_ID)
    result = await provider.fetch(VIDEO_ID)

    assert result.segments[0].text == "Fresh captions."
    assert factory_calls == 2