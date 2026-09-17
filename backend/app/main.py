"""FastAPI application factory and development entrypoint."""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Final

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from app import __version__
from app.api.billing import build_billing_router
from app.api.history import build_history_router
from app.api.marketing import build_marketing_router
from app.api.session import authentication_error_response, build_session_router
from app.api.speech import (
    build_speech_router,
    handle_speech_validation_error,
)
from app.api.usage import build_usage_router
from app.api.video import build_video_router, video_validation_error_response
from app.api.voice import build_voice_router
from app.api.writing import build_writing_router
from app.api.writing import (
    handle_request_validation_error as handle_writing_validation_error,
)
from app.billing.fake import FakeBillingGateway
from app.billing.gateway import BillingGateway
from app.billing.paypal import build_billing_gateway
from app.core.auth import AuthenticationError, Authenticator, build_authenticator
from app.core.config import Settings
from app.core.product import ProductConfig
from app.core.protection import ConnectionLimiter, ProviderGate, ProviderGates, RequestLimiter
from app.domain.ports import LanguageModelPort, SpeechToTextPort, VoiceFeedbackPort
from app.domain.speech import SpeechProvider
from app.marketing.fake import FakeMarketingGateway
from app.marketing.gateway import MarketingGateway
from app.marketing.meta import MetaMarketingGateway
from app.persistence.billing import BillingRepository
from app.persistence.database import Database
from app.persistence.identity import IdentityRepository
from app.persistence.marketing import MarketingRepository
from app.persistence.study import StudyRepository
from app.persistence.usage import UsageRepository
from app.persistence.ws_tickets import WebSocketTicketRepository
from app.providers.edge_speech import EdgeTTSSynthesizer
from app.providers.openrouter_chat import OpenRouterChatLanguageModel
from app.providers.openrouter_feedback import OpenRouterVoiceFeedbackProvider
from app.providers.openrouter_stt import OpenRouterSpeechToTextProvider
from app.providers.openrouter_writing import OpenRouterCorrectionProvider
from app.providers.readiness import get_provider_readiness
from app.providers.youtube_transcript import YouTubeTranscriptProvider
from app.services.billing import BillingService
from app.services.correction import CorrectionService
from app.services.marketing import MarketingService
from app.services.speech import SpeechService
from app.services.video import VideoService

SERVICE_NAME: Final = "Inglés al Grano API"


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
    database: Database | None = None,
    authenticator: Authenticator | None = None,
    billing_gateway: BillingGateway | None = None,
    marketing_gateway: MarketingGateway | None = None,
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
    database_path = (
        ":memory:"
        if runtime_settings.environment.lower() == "test"
        else runtime_settings.database_path
    )
    runtime_database = database or Database(
        database_path,
        busy_timeout_ms=runtime_settings.sqlite_busy_timeout_ms,
    )
    product_config = ProductConfig.from_settings(runtime_settings)
    marketing_repository = MarketingRepository(
        runtime_database,
        policy_version=runtime_settings.marketing_policy_version,
        frontend_origin=runtime_settings.normalized_frontend_origin,
    )
    identity_repository = IdentityRepository(
        runtime_database, on_user_created=marketing_repository.enqueue_lead
    )
    study_repository = StudyRepository(runtime_database)
    usage_repository = UsageRepository(runtime_database, product_config)
    billing_repository = BillingRepository(
        runtime_database, product_config, marketing_repository
    )
    runtime_billing_gateway = billing_gateway or (
        FakeBillingGateway()
        if runtime_settings.billing_mode == "fake"
        else build_billing_gateway(runtime_settings)
    )
    billing_service = BillingService(
        billing_repository,
        runtime_billing_gateway,
        runtime_settings,
        product_config,
    )
    runtime_marketing_gateway = marketing_gateway or (
        None
        if runtime_settings.marketing_mode == "disabled"
        else FakeMarketingGateway()
        if runtime_settings.marketing_mode == "fake"
        else MetaMarketingGateway(runtime_settings)
    )
    marketing_service = MarketingService(
        marketing_repository, runtime_settings, runtime_marketing_gateway
    )
    ws_ticket_repository = WebSocketTicketRepository(
        runtime_database,
        ttl_seconds=runtime_settings.ws_ticket_ttl_seconds,
    )
    runtime_authenticator = authenticator or build_authenticator(runtime_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        runtime_database.migrate()
        usage_repository.reconcile_after_restart()
        try:
            yield
        finally:
            runtime_database.close()

    application = FastAPI(title=SERVICE_NAME, version=__version__, lifespan=lifespan)
    application.state.settings = runtime_settings
    application.state.request_limiter = request_limiter
    application.state.connection_limiter = connection_limiter
    application.state.provider_gates = provider_gates
    application.state.database = runtime_database
    application.state.identity_repository = identity_repository
    application.state.study_repository = study_repository
    application.state.product_config = product_config
    application.state.usage_repository = usage_repository
    application.state.billing_repository = billing_repository
    application.state.billing_gateway = runtime_billing_gateway
    application.state.billing_service = billing_service
    application.state.marketing_repository = marketing_repository
    application.state.marketing_gateway = runtime_marketing_gateway
    application.state.marketing_service = marketing_service
    application.state.ws_ticket_repository = ws_ticket_repository
    application.state.authenticator = runtime_authenticator
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[runtime_settings.normalized_frontend_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @application.middleware("http")
    async def protect_api_requests(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Rate-limit costly direct API calls and apply neutral API response headers."""

        response: Response | None
        protected_request = request.method != "OPTIONS" and (
            request.url.path.startswith("/api/history/")
            or (request.method, request.url.path)
            in {
                ("GET", "/api/session"),
                ("POST", "/api/session/logout"),
                ("POST", "/api/session/ws-ticket"),
                ("GET", "/api/preferences"),
                ("PUT", "/api/preferences"),
                ("GET", "/api/account/quota"),
                ("GET", "/api/account/billing"),
                ("POST", "/api/billing/checkout"),
                ("POST", "/api/billing/cancel"),
                ("GET", "/api/account/marketing-consent"),
                ("PUT", "/api/account/marketing-consent"),
                ("POST", "/api/writing/correct"),
                ("POST", "/api/video/transcript"),
                ("POST", "/api/speech"),
            }
        )
        if protected_request:
            try:
                identity = await runtime_authenticator.authenticate(request)
            except AuthenticationError:
                response = authentication_error_response()
            else:
                identity_repository.ensure_user(identity.user_id)
                request.state.auth_identity = identity
                response = None
        else:
            response = None

        is_costly = request.method == "POST" and request.url.path in {
            "/api/writing/correct",
            "/api/video/transcript",
            "/api/speech",
            "/api/marketing/visitor-consent",
            "/api/marketing/page-view",
        }
        if response is not None:
            pass
        elif is_costly:
            peer_ip = request.client.host if request.client is not None else "unknown"
            decision = request_limiter.check_http(
                peer_ip, speech=request.url.path == "/api/speech"
            )
            if not decision.allowed:
                response = JSONResponse(
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
                response = await call_next(request)
        else:
            response = await call_next(request)

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
        if request.url.path.startswith("/api/history/"):
            return JSONResponse(
                status_code=422,
                content={
                    "error": {
                        "code": "invalid_history_request",
                        "message": "Los datos del historial no son válidos.",
                        "retryable": False,
                    }
                },
            )
        if request.url.path.startswith("/api/marketing/") or request.url.path == (
            "/api/account/marketing-consent"
        ):
            return JSONResponse(
                status_code=422,
                content={
                    "error": {
                        "code": "invalid_marketing_request",
                        "message": "La preferencia o el evento de medición no es válido.",
                        "retryable": False,
                    }
                },
            )
        return await handle_writing_validation_error(request, error)

    application.add_exception_handler(
        RequestValidationError,
        handle_request_validation_error,
    )
    application.include_router(build_usage_router(product_config, usage_repository))
    application.include_router(build_billing_router(billing_service))
    application.include_router(build_marketing_router(marketing_repository, runtime_settings))
    application.include_router(build_writing_router(runtime_correction_service, usage_repository))
    application.include_router(build_video_router(runtime_video_service, usage_repository))
    application.include_router(build_speech_router(runtime_speech_service))
    application.include_router(build_history_router(study_repository))
    application.include_router(
        build_session_router(
            auth_mode=runtime_settings.auth_mode,
            authenticator=runtime_authenticator,
            identities=identity_repository,
            tickets=ws_ticket_repository,
            allowed_voices=runtime_settings.edge_tts_allowed_voices,
        )
    )
    application.include_router(
        build_voice_router(
            runtime_stt_provider,
            llm_provider=runtime_llm_provider,
            feedback_provider=runtime_feedback_provider,
            speech_service=runtime_speech_service,
            settings=runtime_settings,
            gates=provider_gates,
            connection_limiter=connection_limiter,
            ticket_repository=ws_ticket_repository,
            study_repository=study_repository,
            usage_repository=usage_repository,
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
