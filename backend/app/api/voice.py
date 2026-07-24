"""WebSocket router for Voice Studio protocol v1."""

from urllib.parse import urlsplit

from fastapi import APIRouter, Response, WebSocket

from app.core.config import Settings
from app.core.protection import ConnectionLimiter, ProviderGates
from app.domain.ports import LanguageModelPort, SpeechToTextPort, VoiceFeedbackPort
from app.services.speech import SpeechService
from app.voice.session import VoiceSession

_DENIAL_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


def _normalize_origin(value: str) -> str | None:
    """Normalize an Origin header strictly rather than accepting string prefixes."""

    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
    ):
        return None
    host = parsed.hostname.lower()
    try:
        port = parsed.port
    except ValueError:
        return None
    if port is not None and not (
        (parsed.scheme == "http" and port == 80)
        or (parsed.scheme == "https" and port == 443)
    ):
        host = f"{host}:{port}"
    return f"{parsed.scheme}://{host}"


def build_voice_router(
    stt_provider: SpeechToTextPort,
    llm_provider: LanguageModelPort | None = None,
    feedback_provider: VoiceFeedbackPort | None = None,
    speech_service: SpeechService | None = None,
    *,
    settings: Settings | None = None,
    gates: ProviderGates | None = None,
    connection_limiter: ConnectionLimiter | None = None,
) -> APIRouter:
    """Construct router with admission checks that run before WebSocket accept."""

    router = APIRouter(prefix="/api/voice", tags=["voice"])
    runtime_settings = settings or Settings()

    @router.websocket("/ws")
    async def voice_websocket(websocket: WebSocket) -> None:
        origin = websocket.headers.get("origin")
        if (
            origin is None
            or _normalize_origin(origin) != runtime_settings.normalized_frontend_origin
        ):
            await websocket.send_denial_response(
                Response(status_code=403, headers=_DENIAL_HEADERS)
            )
            return

        peer_ip = websocket.client.host if websocket.client is not None else "unknown"
        admitted = connection_limiter is None or connection_limiter.try_open(peer_ip)
        if not admitted:
            await websocket.send_denial_response(
                Response(status_code=403, headers=_DENIAL_HEADERS)
            )
            return

        await websocket.accept()
        try:
            session = VoiceSession(
                websocket,
                stt_provider,
                llm_provider=llm_provider,
                feedback_provider=feedback_provider,
                speech_service=speech_service,
                settings=runtime_settings,
                gates=gates,
            )
            await session.run()
        finally:
            if connection_limiter is not None:
                connection_limiter.release(peer_ip)

    return router
