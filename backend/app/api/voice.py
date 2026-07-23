"""WebSocket router for Voice Studio protocol v1."""

from fastapi import APIRouter, WebSocket

from app.domain.ports import SpeechToTextPort
from app.voice.session import VoiceSession


def build_voice_router(stt_provider: SpeechToTextPort) -> APIRouter:
    """Construct router for WebSocket voice sessions."""

    router = APIRouter(prefix="/api/voice", tags=["voice"])

    @router.websocket("/ws")
    async def voice_websocket(websocket: WebSocket) -> None:
        await websocket.accept()
        session = VoiceSession(websocket, stt_provider)
        await session.run()

    return router
