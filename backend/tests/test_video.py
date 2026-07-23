from typing import Never

import pytest
from fastapi.testclient import TestClient
from requests.exceptions import ConnectionError as RequestsConnectionError

from app.core.config import Settings
from app.domain.video import (
    TranscriptResult,
    TranscriptSegment,
    TranscriptSource,
    VideoProviderError,
    VideoProviderErrorCode,
)
from app.main import create_app
from app.providers.fakes import FakeTranscriptProvider
from app.providers.youtube_transcript import YouTubeTranscriptProvider
from app.services.video import VideoService

VIDEO_ID = "aircAruvnKk"
VIDEO_URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"
RESULT = TranscriptResult(
    video_id=VIDEO_ID,
    source=TranscriptSource.YOUTUBE,
    segments=(
        TranscriptSegment(text="Neural networks recognize patterns.", start=0.0, duration=4.2),
        TranscriptSegment(text="Layers transform those patterns.", start=4.2, duration=3.8),
    ),
)


class _ConnectionFailingClient:
    def list(self, video_id: str) -> Never:
        del video_id
        raise RequestsConnectionError("private upstream host diagnostic")


def _client_for(
    result: TranscriptResult = RESULT,
    *,
    error: VideoProviderError | None = None,
) -> tuple[TestClient, FakeTranscriptProvider]:
    provider = FakeTranscriptProvider(result=result, error=error)
    app = create_app(
        Settings(_env_file=None, environment="test"),
        video_service=VideoService(provider),
    )
    return TestClient(app), provider


def test_video_endpoint_returns_typed_english_segments() -> None:
    client, provider = _client_for()

    response = client.post("/api/video/transcript", json={"url": VIDEO_URL})

    assert response.status_code == 200
    assert response.json() == {
        "video_id": VIDEO_ID,
        "source": "youtube",
        "segments": [
            {
                "text": "Neural networks recognize patterns.",
                "start": 0.0,
                "duration": 4.2,
            },
            {
                "text": "Layers transform those patterns.",
                "start": 4.2,
                "duration": 3.8,
            },
        ],
    }
    assert provider.calls == [VIDEO_ID]


def test_video_endpoint_normalizes_invalid_urls_without_calling_provider() -> None:
    client, provider = _client_for()

    response = client.post(
        "/api/video/transcript",
        json={"url": "https://youtube.com.evil.test/watch?v=aircAruvnKk"},
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "invalid_url",
            "message": "Introduce una URL válida de YouTube.",
            "retryable": False,
        }
    }
    assert provider.calls == []


@pytest.mark.parametrize(
    ("provider_code", "status_code", "public_code", "retryable"),
    [
        (VideoProviderErrorCode.CAPTIONS_UNAVAILABLE, 404, "captions_unavailable", False),
        (VideoProviderErrorCode.PROVIDER_BLOCKED, 503, "provider_blocked", False),
        (VideoProviderErrorCode.TIMEOUT, 504, "provider_timeout", True),
        (VideoProviderErrorCode.UNAVAILABLE, 503, "provider_unavailable", True),
        (VideoProviderErrorCode.INVALID_RESPONSE, 502, "invalid_provider_response", True),
    ],
)
def test_video_endpoint_maps_provider_failures_to_safe_errors(
    provider_code: VideoProviderErrorCode,
    status_code: int,
    public_code: str,
    retryable: bool,
) -> None:
    client, _ = _client_for(
        error=VideoProviderError(provider_code, "Private provider diagnostic."),
    )

    response = client.post("/api/video/transcript", json={"url": VIDEO_URL})

    assert response.status_code == status_code
    assert response.json()["error"]["code"] == public_code
    assert response.json()["error"]["retryable"] is retryable
    assert "Private provider diagnostic" not in response.text


def test_transport_connection_failures_never_escape_as_private_http_500() -> None:
    provider = YouTubeTranscriptProvider(
        timeout_seconds=1.0,
        client_factory=_ConnectionFailingClient,
    )
    app = create_app(
        Settings(_env_file=None, environment="test"),
        video_service=VideoService(provider),
    )
    client = TestClient(app, raise_server_exceptions=False)

    response = client.post("/api/video/transcript", json={"url": VIDEO_URL})

    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "provider_unavailable",
        "message": "YouTube no está disponible. Inténtalo de nuevo o usa la demo técnica.",
        "retryable": True,
    }
    assert "private upstream host diagnostic" not in response.text


def test_video_endpoint_normalizes_malformed_requests_for_video() -> None:
    client, provider = _client_for()
    responses = (
        client.post("/api/video/transcript", json={}),
        client.post("/api/video/transcript", json={"url": 42}),
        client.post(
            "/api/video/transcript",
            json={"url": VIDEO_URL, "unexpected": True},
        ),
    )

    for response in responses:
        assert response.status_code == 422
        assert response.json() == {
            "error": {
                "code": "invalid_request",
                "message": "La solicitud de transcripción no es válida.",
                "retryable": False,
            }
        }
    assert provider.calls == []


def test_video_service_rejects_a_mismatched_provider_video_id() -> None:
    mismatched = TranscriptResult(
        video_id="dQw4w9WgXcQ",
        source=TranscriptSource.YOUTUBE,
        segments=(TranscriptSegment(text="Wrong video.", start=0.0, duration=1.0),),
    )
    client, provider = _client_for(mismatched)

    response = client.post("/api/video/transcript", json={"url": VIDEO_URL})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "invalid_provider_response"
    assert provider.calls == [VIDEO_ID]
