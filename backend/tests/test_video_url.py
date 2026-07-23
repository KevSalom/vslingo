import pytest

from app.domain.video import VideoInputError, extract_youtube_video_id

VIDEO_ID = "aircAruvnKk"


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/watch?v={VIDEO_ID}",
        f"https://youtube.com/watch?feature=shared&v={VIDEO_ID}",
        f"https://m.youtube.com/shorts/{VIDEO_ID}?feature=share",
        f"https://youtu.be/{VIDEO_ID}?si=fixture",
        f"https://www.youtube.com/embed/{VIDEO_ID}",
        f"https://www.youtube-nocookie.com/embed/{VIDEO_ID}",
        f"https://youtube.com/live/{VIDEO_ID}",
    ],
)
def test_extract_youtube_video_id_accepts_supported_urls(url: str) -> None:
    assert extract_youtube_video_id(url) == VIDEO_ID


@pytest.mark.parametrize(
    "url",
    [
        "",
        "aircAruvnKk",
        "https://example.com/watch?v=aircAruvnKk",
        "https://youtube.com.evil.test/watch?v=aircAruvnKk",
        "javascript:alert(1)",
        "https://youtu.be/too-short",
        "https://www.youtube.com/watch?v=aircAruvnKkextra",
        "https://www.youtube.com/watch?x=aircAruvnKk",
    ],
)
def test_extract_youtube_video_id_rejects_invalid_or_untrusted_urls(url: str) -> None:
    with pytest.raises(VideoInputError) as exc_info:
        extract_youtube_video_id(url)

    assert exc_info.value.code.value == "invalid_url"
