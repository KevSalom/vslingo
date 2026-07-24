"""Video transcript orchestration."""

from dataclasses import dataclass

from app.core.protection import ProviderGate
from app.domain.ports import TranscriptProviderPort
from app.domain.video import (
    TranscriptResult,
    VideoProviderError,
    VideoProviderErrorCode,
    extract_youtube_video_id,
)


@dataclass(frozen=True, slots=True)
class VideoService:
    """Validate a YouTube URL and request its normalized transcript."""

    provider: TranscriptProviderPort
    gate: ProviderGate | None = None

    async def transcript(self, url: str) -> TranscriptResult:
        """Return timed captions for one trusted YouTube URL."""

        video_id = extract_youtube_video_id(url)
        if self.gate is None:
            result = await self.provider.fetch(video_id)
        else:
            async with self.gate.slot():
                result = await self.provider.fetch(video_id)
        if result.video_id != video_id:
            raise VideoProviderError(
                VideoProviderErrorCode.INVALID_RESPONSE,
                "The transcript provider returned a mismatched video ID.",
            )
        return result
