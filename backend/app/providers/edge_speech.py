"""Microsoft Edge Neural TTS adapter implementing SpeechSynthesizerPort."""

import asyncio
from collections.abc import Callable
from typing import Any

import edge_tts

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.models import SynthesizedSpeech
from app.domain.ports import SpeechSynthesizerPort


class EdgeTTSSynthesizer(SpeechSynthesizerPort):
    """Synthesize text using Microsoft Edge Neural voices via edge-tts."""

    def __init__(
        self,
        settings: Settings,
        *,
        communicate_factory: Callable[[str, str], Any] | None = None,
    ) -> None:
        self._settings = settings
        self._communicate_factory = communicate_factory

    async def synthesize(self, text: str, *, voice: str | None = None) -> SynthesizedSpeech:
        if not self._settings.edge_tts_configured:
            raise IntegrationError(
                provider="edge_tts",
                code=IntegrationErrorCode.NOT_CONFIGURED,
                message="Edge TTS no está configurado.",
            )

        selected_voice = voice or self._settings.edge_tts_voice

        if self._communicate_factory is not None:
            communicate = self._communicate_factory(text, selected_voice)
        else:
            communicate = edge_tts.Communicate(text, selected_voice)

        audio_chunks: list[bytes] = []

        async def _stream_audio() -> None:
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio" and "data" in chunk:
                    audio_chunks.append(chunk["data"])

        try:
            await asyncio.wait_for(
                _stream_audio(),
                timeout=self._settings.provider_timeout_seconds,
            )
        except TimeoutError:
            raise IntegrationError(
                provider="edge_tts",
                code=IntegrationErrorCode.TIMEOUT,
                message="Tiempo de espera agotado al comunicar con Edge TTS.",
            ) from None
        except asyncio.CancelledError:
            raise
        except IntegrationError:
            raise
        except Exception:
            raise IntegrationError(
                provider="edge_tts",
                code=IntegrationErrorCode.UNAVAILABLE,
                message="Error al sintetizar audio con Edge TTS.",
            ) from None

        audio_bytes = b"".join(audio_chunks)
        if not audio_bytes:
            raise IntegrationError(
                provider="edge_tts",
                code=IntegrationErrorCode.INVALID_RESPONSE,
                message="La síntesis de Edge TTS produjo una respuesta vacía.",
            )

        return SynthesizedSpeech(audio=audio_bytes, media_type="audio/mpeg")
