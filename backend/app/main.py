"""FastAPI application factory and development entrypoint."""

from typing import Final

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import __version__
from app.api.speech import (
    build_speech_router,
    handle_speech_validation_error,
)
from app.api.video import build_video_router, video_validation_error_response
from app.api.writing import build_writing_router
from app.api.writing import (
    handle_request_validation_error as handle_writing_validation_error,
)
from app.core.config import Settings
from app.domain.speech import SpeechProvider
from app.providers.aws_polly import AWSPollySynthesizer
from app.providers.edge_speech import EdgeTTSSynthesizer
from app.providers.openrouter_writing import OpenRouterCorrectionProvider
from app.providers.readiness import get_provider_readiness
from app.providers.youtube_transcript import YouTubeTranscriptProvider
from app.services.correction import CorrectionService
from app.services.speech import SpeechService
from app.services.video import VideoService

SERVICE_NAME: Final = "VSLingo API"


class ProviderHealth(BaseModel):
    """Secret-free provider readiness exposed by health."""

    configured: bool


class HealthResponse(BaseModel):
    """Public health response for deployment and local checks."""

    status: str
    service: str
    version: str
    environment: str
    providers: dict[str, ProviderHealth]


def create_app(
    settings: Settings | None = None,
    *,
    correction_service: CorrectionService | None = None,
    video_service: VideoService | None = None,
    speech_service: SpeechService | None = None,
) -> FastAPI:
    """Build an isolated FastAPI application with explicit dependencies."""

    runtime_settings = settings or Settings()
    runtime_correction_service = correction_service or CorrectionService(
        OpenRouterCorrectionProvider(runtime_settings)
    )
    runtime_video_service = video_service or VideoService(
        YouTubeTranscriptProvider(
            timeout_seconds=runtime_settings.provider_timeout_seconds,
        )
    )
    runtime_speech_service = speech_service or SpeechService(
        providers={
            SpeechProvider.AWS_POLLY: AWSPollySynthesizer(runtime_settings),
            SpeechProvider.EDGE_TTS: EdgeTTSSynthesizer(runtime_settings),
        }
    )
    application = FastAPI(title=SERVICE_NAME, version=__version__)
    application.state.settings = runtime_settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[str(runtime_settings.frontend_origin).rstrip("/")],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    async def handle_request_validation_error(
        request: Request,
        error: Exception,
    ) -> JSONResponse:
        if request.url.path.startswith("/api/video/"):
            return video_validation_error_response()
        if request.url.path.startswith("/api/speech"):
            return await handle_speech_validation_error(request, error)
        return await handle_writing_validation_error(request, error)

    application.add_exception_handler(
        RequestValidationError,
        handle_request_validation_error,
    )
    application.include_router(build_writing_router(runtime_correction_service))
    application.include_router(build_video_router(runtime_video_service))
    application.include_router(build_speech_router(runtime_speech_service))

    @application.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        """Report app and provider readiness without credential material."""

        providers = {
            provider.name: ProviderHealth(configured=provider.configured)
            for provider in get_provider_readiness(runtime_settings)
        }
        return HealthResponse(
            status="ok",
            service=SERVICE_NAME,
            version=__version__,
            environment=runtime_settings.environment,
            providers=providers,
        )

    return application



app = create_app()


def run() -> None:
    """Run the development server through the installed console script."""

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
