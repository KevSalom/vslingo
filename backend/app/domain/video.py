"""Typed Video Lab values, URL parsing, and controlled failures."""

import re
from enum import StrEnum
from typing import Self
from urllib.parse import parse_qs, urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_VIDEO_URL_LENGTH = 2048
MAX_TRANSCRIPT_SEGMENTS = 2_000
MAX_TRANSCRIPT_SEGMENT_LENGTH = 2_000
_VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
_STANDARD_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
    }
)
_PRIVACY_HOSTS = frozenset({"youtube-nocookie.com", "www.youtube-nocookie.com"})
_SHORT_HOSTS = frozenset({"youtu.be", "www.youtu.be"})
_PATH_PREFIXES = frozenset({"embed", "live", "shorts", "v"})


class TranscriptSource(StrEnum):
    """Origin of a normalized transcript displayed by Video Lab."""

    YOUTUBE = "youtube"
    FIXTURE = "fixture"


class TranscriptSegment(BaseModel):
    """One timed and validated caption segment."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    text: str = Field(min_length=1, max_length=MAX_TRANSCRIPT_SEGMENT_LENGTH)
    start: float = Field(ge=0.0)
    duration: float = Field(gt=0.0)


class TranscriptResult(BaseModel):
    """Provider-neutral transcript returned by the service and HTTP API."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    video_id: str = Field(pattern=_VIDEO_ID_PATTERN.pattern)
    source: TranscriptSource
    segments: tuple[TranscriptSegment, ...] = Field(
        min_length=1,
        max_length=MAX_TRANSCRIPT_SEGMENTS,
    )

    @model_validator(mode="after")
    def validate_segment_order(self) -> Self:
        """Require deterministic chronological ordering while allowing overlaps."""

        starts = [segment.start for segment in self.segments]
        if starts != sorted(starts):
            raise ValueError("transcript segments must be ordered by start time")
        return self


class VideoInputErrorCode(StrEnum):
    """Stable input failures controlled before contacting YouTube."""

    INVALID_URL = "invalid_url"


class VideoInputError(ValueError):
    """A safe, typed validation failure for a submitted video URL."""

    def __init__(self, code: VideoInputErrorCode = VideoInputErrorCode.INVALID_URL) -> None:
        self.code = code
        super().__init__(code.value)


class VideoProviderErrorCode(StrEnum):
    """Provider failures that Video Lab maps to actionable public errors."""

    CAPTIONS_UNAVAILABLE = "captions_unavailable"
    PROVIDER_BLOCKED = "provider_blocked"
    TIMEOUT = "timeout"
    UNAVAILABLE = "unavailable"
    INVALID_RESPONSE = "invalid_response"


class VideoProviderError(RuntimeError):
    """A normalized transcript-provider failure without private diagnostics."""

    def __init__(self, code: VideoProviderErrorCode, message: str) -> None:
        self.code = code
        super().__init__(message)


def extract_youtube_video_id(raw_url: str) -> str:
    """Extract an 11-character ID only from explicit trusted YouTube URLs."""

    url = raw_url.strip()
    if not url or len(url) > MAX_VIDEO_URL_LENGTH:
        raise VideoInputError()

    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower().rstrip(".")
        _ = parsed.port
    except ValueError as exc:
        raise VideoInputError() from exc

    if (
        parsed.scheme not in {"http", "https"}
        or not host
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise VideoInputError()

    candidate: str | None = None
    path_parts = [part for part in parsed.path.split("/") if part]

    if host in _SHORT_HOSTS:
        if len(path_parts) == 1:
            candidate = path_parts[0]
    elif host in _STANDARD_HOSTS:
        if parsed.path.rstrip("/") == "/watch":
            values = parse_qs(parsed.query, keep_blank_values=True).get("v", [])
            if len(values) == 1:
                candidate = values[0]
        elif len(path_parts) == 2 and path_parts[0] in _PATH_PREFIXES:
            candidate = path_parts[1]
    elif (
        host in _PRIVACY_HOSTS
        and len(path_parts) == 2
        and path_parts[0] == "embed"
    ):
        candidate = path_parts[1]

    if candidate is None or _VIDEO_ID_PATTERN.fullmatch(candidate) is None:
        raise VideoInputError()
    return candidate
