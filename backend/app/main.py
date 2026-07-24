"""FastAPI application factory and development entrypoint."""

from typing import Final

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from app import __version__
from app.api.speech import (
    build_speech_router,
    handle_speech_validation_error,
)
from app.api.video import build_video_router, video_validation_error_response
from app.api.voice import build_voice_router
from app.api.writing import build_writing_router
from app.api.writing import (
    handle_request_validation_error as handle_writing_validation_error,
)
from app.core.config import Settings
from app.core.protection import ConnectionLimiter, ProviderGate, ProviderGates, RequestLimiter
from app.domain.ports import LanguageModelPort, SpeechToTextPort, VoiceFeedbackPort
from app.domain.speech import SpeechProvider
from app.providers.aws_polly import AWSPollySynthesizer
from app.providers.edge_speech import EdgeTTSSynthesizer
from app.providers.openrouter_chat import OpenRouterChatLanguageModel
from app.providers.openrouter_feedback import OpenRouterVoiceFeedbackProvider
from app.providers.openrouter_stt import OpenRouterSpeechToTextProvider
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
    stt_provider: SpeechToTextPort | None = None,
    llm_provider: LanguageModelPort | None = None,
    feedback_provider: VoiceFeedbackPort | None = None,
) -> FastAPI:
    """Build an isolated FastAPI application with explicit dependencies."""

    runtime_settings = settings or Settings()
    request_limiter = RequestLimiter(
        max_http_requests_per_minute=runtime_settings.max_http_requests_per_minute,
        max_speech_requests_per_minute=runtime_settings.max_speech_requests_per_minute,
    )
    connection_limiter = ConnectionLimiter(
        max_connections=runtime_settings.max_ws_connections,
        max_connections_per_ip=runtime_settings.max_ws_connections_per_ip,
        request_limiter=request_limiter,
    )
    provider_gates = ProviderGates(
        stt=ProviderGate(
            runtime_settings.max_concurrent_stt,
            acquire_timeout_seconds=runtime_settings.provider_acquire_timeout_seconds,
        ),
        llm=ProviderGate(
            runtime_settings.max_concurrent_llm,
            acquire_timeout_seconds=runtime_settings.provider_acquire_timeout_seconds,
        ),
        tts=ProviderGate(
            runtime_settings.max_concurrent_tts,
            acquire_timeout_seconds=runtime_settings.provider_acquire_timeout_seconds,
        ),
        video=ProviderGate(
            runtime_settings.max_concurrent_video,
            acquire_timeout_seconds=runtime_settings.provider_acquire_timeout_seconds,
        ),
    )
    runtime_correction_service = correction_service or CorrectionService(
        OpenRouterCorrectionProvider(runtime_settings), gate=provider_gates.llm
    )
    runtime_video_service = video_service or VideoService(
        YouTubeTranscriptProvider(
            timeout_seconds=runtime_settings.provider_timeout_seconds,
        ),
        gate=provider_gates.video,
    )
    runtime_speech_service = speech_service or SpeechService(
        providers={
            SpeechProvider.AWS_POLLY: AWSPollySynthesizer(runtime_settings),
            SpeechProvider.EDGE_TTS: EdgeTTSSynthesizer(runtime_settings),
        },
        gate=provider_gates.tts,
    )
    runtime_stt_provider = stt_provider or OpenRouterSpeechToTextProvider(
        api_key=runtime_settings.openrouter_api_key.get_secret_value()
        if runtime_settings.openrouter_api_key
        else None,
        model=runtime_settings.openrouter_stt_model,
        base_url=str(runtime_settings.openrouter_base_url),
        timeout_seconds=runtime_settings.provider_timeout_seconds,
    )
    runtime_llm_provider = llm_provider or OpenRouterChatLanguageModel(runtime_settings)
    runtime_feedback_provider = feedback_provider or OpenRouterVoiceFeedbackProvider(
        runtime_settings
    )

    application = FastAPI(title=SERVICE_NAME, version=__version__)
    application.state.settings = runtime_settings
    application.state.request_limiter = request_limiter
    application.state.connection_limiter = connection_limiter
    application.state.provider_gates = provider_gates
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[runtime_settings.normalized_frontend_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @application.middleware("http")
    async def protect_api_requests(request: Request, call_next: object) -> Response:
        """Rate-limit costly direct API calls and apply neutral API response headers."""

        is_costly = request.method == "POST" and request.url.path in {
            "/api/writing/correct",
            "/api/video/transcript",
            "/api/speech",
        }
        if is_costly:
            peer_ip = request.client.host if request.client is not None else "unknown"
            decision = request_limiter.check_http(
                peer_ip, speech=request.url.path == "/api/speech"
            )
            if not decision.allowed:
                response: Response = JSONResponse(
                    status_code=429,
                    content={
                        "error": {
                            "code": "rate_limited",
                            "message": (
                            "Has alcanzado el límite temporal de solicitudes. "
                            "Inténtalo de nuevo pronto."
                        ),
                            "retryable": True,
                        }
                    },
                    headers={"Retry-After": str(decision.retry_after_seconds)},
                )
            else:
                response = await call_next(request)  # type: ignore[operator]
        else:
            response = await call_next(request)  # type: ignore[operator]

        if request.url.path.startswith("/api/"):
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["Cache-Control"] = "no-store"
        return response

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
    application.include_router(
        build_voice_router(
            runtime_stt_provider,
            llm_provider=runtime_llm_provider,
            feedback_provider=runtime_feedback_provider,
            speech_service=runtime_speech_service,
            settings=runtime_settings,
            gates=provider_gates,
            connection_limiter=connection_limiter,
        )
    )

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
