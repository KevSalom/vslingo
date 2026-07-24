"""WebSocket router for Voice Studio protocol v1."""

from fastapi import APIRouter, WebSocket

from app.domain.ports import LanguageModelPort, SpeechToTextPort, VoiceFeedbackPort
from app.services.speech import SpeechService
from app.voice.session import VoiceSession


def build_voice_router(
    stt_provider: SpeechToTextPort,
    llm_provider: LanguageModelPort | None = None,
    feedback_provider: VoiceFeedbackPort | None = None,
    speech_service: SpeechService | None = None,
) -> APIRouter:
    """Construct router for WebSocket voice sessions."""

    router = APIRouter(prefix="/api/voice", tags=["voice"])

    @router.websocket("/ws")
    async def voice_websocket(websocket: WebSocket) -> None:
        await websocket.accept()
        session = VoiceSession(
            websocket,
            stt_provider,
            llm_provider=llm_provider,
            feedback_provider=feedback_provider,
            speech_service=speech_service,
        )
        await session.run()

    return router
