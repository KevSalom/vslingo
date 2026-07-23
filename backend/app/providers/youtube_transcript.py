"""Resilient adapter for English YouTube captions."""

import asyncio
from collections import OrderedDict
from collections.abc import Callable, Iterable, Iterator
from functools import partial
from html import unescape
from time import monotonic
from typing import Any, Protocol, cast

from pydantic import ValidationError
from requests import PreparedRequest, Response, Session
from requests.exceptions import RequestException
from requests.exceptions import Timeout as RequestsTimeout
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    AgeRestricted,
    CouldNotRetrieveTranscript,
    InvalidVideoId,
    IpBlocked,
    NoTranscriptFound,
    NotTranslatable,
    PoTokenRequired,
    RequestBlocked,
    TranscriptsDisabled,
    TranslationLanguageNotAvailable,
    VideoUnavailable,
    YouTubeDataUnparsable,
    YouTubeRequestFailed,
    YouTubeTranscriptApiException,
)

from app.domain.video import (
    MAX_TRANSCRIPT_SEGMENTS,
    TranscriptResult,
    TranscriptSegment,
    TranscriptSource,
    VideoProviderError,
    VideoProviderErrorCode,
)

_ENGLISH_LANGUAGE_CODES = frozenset({"en", "en-gb", "en-us"})
_TRANSPORT_TIMEOUT_RATIO = 0.2
_MINIMUM_TRANSPORT_TIMEOUT_SECONDS = 0.001
_DEFAULT_CACHE_TTL_SECONDS = 300.0
_DEFAULT_CACHE_MAX_ENTRIES = 32
_DEFAULT_MAX_ATTEMPTS = 2
_RETRYABLE_CODES = frozenset(
    {VideoProviderErrorCode.TIMEOUT, VideoProviderErrorCode.UNAVAILABLE}
)


class TranscriptSnippetLike(Protocol):
    """Minimal snippet surface consumed from youtube-transcript-api."""

    text: str
    start: float
    duration: float


class TranscriptTrackLike(Protocol):
    """Minimal caption-track surface consumed from youtube-transcript-api."""

    language_code: str
    is_generated: bool
    is_translatable: bool

    def translate(self, language_code: str) -> "TranscriptTrackLike": ...

    def fetch(self) -> Iterable[TranscriptSnippetLike]: ...


class TranscriptListLike(Protocol):
    """Iterable caption-list boundary used for deterministic tests."""

    def __iter__(self) -> Iterator[TranscriptTrackLike]: ...


class YouTubeClientLike(Protocol):
    """Synchronous library boundary moved away from the event loop."""

    def list(self, video_id: str) -> TranscriptListLike: ...


TranscriptClientFactory = Callable[[], YouTubeClientLike]


class BoundedTimeoutSession(Session):
    """Apply a default requests timeout when the SDK omits one."""

    def __init__(self, timeout_seconds: float) -> None:
        super().__init__()
        self._timeout_seconds = timeout_seconds

    def send(self, request: PreparedRequest, **kwargs: Any) -> Response:
        if kwargs.get("timeout") is None:
            kwargs["timeout"] = self._timeout_seconds
        return super().send(request, **kwargs)


class YouTubeTranscriptProvider:
    """Fetch English captions with bounded retries and a temporary LRU cache."""

    def __init__(
        self,
        *,
        timeout_seconds: float,
        client_factory: TranscriptClientFactory | None = None,
        cache_ttl_seconds: float = _DEFAULT_CACHE_TTL_SECONDS,
        cache_max_entries: int = _DEFAULT_CACHE_MAX_ENTRIES,
        max_attempts: int = _DEFAULT_MAX_ATTEMPTS,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        if (
            cache_ttl_seconds <= 0
            or cache_max_entries < 1
            or not 1 <= max_attempts <= _DEFAULT_MAX_ATTEMPTS
        ):
            raise ValueError("Cache bounds must be positive and attempts must be 1 or 2.")
        self._timeout_seconds = timeout_seconds
        self._client_factory = client_factory or partial(
            _create_client,
            timeout_seconds,
        )
        self._cache_ttl_seconds = cache_ttl_seconds
        self._cache_max_entries = cache_max_entries
        self._max_attempts = max_attempts
        self._clock = clock
        self._cache: OrderedDict[str, tuple[float, TranscriptResult]] = OrderedDict()

    async def fetch(self, video_id: str) -> TranscriptResult:
        """Return normalized captions without blocking the async event loop."""

        cached = self._cached(video_id)
        if cached is not None:
            return cached

        for attempt in range(1, self._max_attempts + 1):
            try:
                async with asyncio.timeout(self._timeout_seconds):
                    result = await asyncio.to_thread(self._fetch_sync, video_id)
            except TimeoutError as exc:
                error = VideoProviderError(
                    VideoProviderErrorCode.TIMEOUT,
                    "The YouTube transcript request timed out.",
                )
                error.__cause__ = exc
            except VideoProviderError as exc:
                error = exc
            else:
                self._store(video_id, result)
                return result

            if error.code not in _RETRYABLE_CODES or attempt == self._max_attempts:
                raise error

        raise RuntimeError("The YouTube transcript retry loop ended unexpectedly.")

    def _cached(self, video_id: str) -> TranscriptResult | None:
        """Return a fresh cached transcript and refresh its LRU position."""

        entry = self._cache.get(video_id)
        if entry is None:
            return None
        expires_at, result = entry
        if expires_at <= self._clock():
            del self._cache[video_id]
            return None
        self._cache.move_to_end(video_id)
        return result

    def _store(self, video_id: str, result: TranscriptResult) -> None:
        """Store one successful result and evict the least-recently-used entry."""

        self._cache[video_id] = (self._clock() + self._cache_ttl_seconds, result)
        self._cache.move_to_end(video_id)
        while len(self._cache) > self._cache_max_entries:
            self._cache.popitem(last=False)

    def _fetch_sync(self, video_id: str) -> TranscriptResult:
        try:
            tracks = list(self._client_factory().list(video_id))
            selected = _select_track(tracks)
            snippets = list(selected.fetch())
            if not snippets or len(snippets) > MAX_TRANSCRIPT_SEGMENTS:
                raise VideoProviderError(
                    VideoProviderErrorCode.INVALID_RESPONSE,
                    "YouTube returned an empty or oversized transcript.",
                )

            segments = tuple(
                sorted(
                    (
                        TranscriptSegment(
                            text=unescape(snippet.text).strip(),
                            start=snippet.start,
                            duration=snippet.duration,
                        )
                        for snippet in snippets
                    ),
                    key=lambda segment: segment.start,
                )
            )
            return TranscriptResult(
                video_id=video_id,
                source=TranscriptSource.YOUTUBE,
                segments=segments,
            )
        except VideoProviderError:
            raise
        except RequestsTimeout as exc:
            raise VideoProviderError(
                VideoProviderErrorCode.TIMEOUT,
                "The YouTube transport timed out.",
            ) from exc
        except RequestException as exc:
            raise VideoProviderError(
                VideoProviderErrorCode.UNAVAILABLE,
                "The YouTube transport is unavailable.",
            ) from exc
        except (RequestBlocked, IpBlocked, PoTokenRequired) as exc:
            raise VideoProviderError(
                VideoProviderErrorCode.PROVIDER_BLOCKED,
                "YouTube blocked transcript access from this host.",
            ) from exc
        except (
            AgeRestricted,
            InvalidVideoId,
            NoTranscriptFound,
            NotTranslatable,
            TranscriptsDisabled,
            TranslationLanguageNotAvailable,
            VideoUnavailable,
        ) as exc:
            raise VideoProviderError(
                VideoProviderErrorCode.CAPTIONS_UNAVAILABLE,
                "No usable English captions are available for this video.",
            ) from exc
        except YouTubeDataUnparsable as exc:
            raise VideoProviderError(
                VideoProviderErrorCode.INVALID_RESPONSE,
                "YouTube returned transcript data in an unsupported format.",
            ) from exc
        except (YouTubeRequestFailed, CouldNotRetrieveTranscript) as exc:
            raise VideoProviderError(
                VideoProviderErrorCode.UNAVAILABLE,
                "YouTube transcript retrieval failed.",
            ) from exc
        except YouTubeTranscriptApiException as exc:
            raise VideoProviderError(
                VideoProviderErrorCode.UNAVAILABLE,
                "YouTube transcript retrieval failed.",
            ) from exc
        except (AttributeError, TypeError, ValueError, ValidationError) as exc:
            raise VideoProviderError(
                VideoProviderErrorCode.INVALID_RESPONSE,
                "YouTube returned malformed transcript data.",
            ) from exc


def _select_track(tracks: list[TranscriptTrackLike]) -> TranscriptTrackLike:
    direct = [
        track
        for track in tracks
        if track.language_code.lower() in _ENGLISH_LANGUAGE_CODES
        or track.language_code.lower().startswith("en-")
    ]
    if direct:
        return min(direct, key=lambda track: track.is_generated)

    translatable = next((track for track in tracks if track.is_translatable), None)
    if translatable is None:
        raise VideoProviderError(
            VideoProviderErrorCode.CAPTIONS_UNAVAILABLE,
            "No direct or translatable English captions are available.",
        )
    return translatable.translate("en")


def _create_client(timeout_seconds: float) -> YouTubeClientLike:
    transport_timeout = max(
        _MINIMUM_TRANSPORT_TIMEOUT_SECONDS,
        timeout_seconds * _TRANSPORT_TIMEOUT_RATIO,
    )
    session = BoundedTimeoutSession(transport_timeout)
    return cast(YouTubeClientLike, YouTubeTranscriptApi(http_client=session))
