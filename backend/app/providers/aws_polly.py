"""AWS Polly Neural adapter implementing SpeechSynthesizerPort."""

import asyncio
import contextlib
from collections.abc import Callable
from typing import Any

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.models import SynthesizedSpeech
from app.domain.ports import SpeechSynthesizerPort


class AWSPollySynthesizer(SpeechSynthesizerPort):
    """Synthesize text using AWS Polly Neural engine."""

    def __init__(
        self,
        settings: Settings,
        *,
        client_factory: Callable[[], Any] | None = None,
    ) -> None:
        self._settings = settings
        self._client_factory = client_factory

    async def synthesize(self, text: str, *, voice: str | None = None) -> SynthesizedSpeech:
        if not self._settings.aws_polly_configured:
            raise IntegrationError(
                provider="aws_polly",
                code=IntegrationErrorCode.NOT_CONFIGURED,
                message="AWS Polly no está configurado.",
            )

        selected_voice = voice or self._settings.aws_polly_voice_id

        def _call_polly() -> bytes:
            if self._client_factory is not None:
                client = self._client_factory()
            else:
                import boto3
                from botocore.config import Config

                config = Config(
                    connect_timeout=self._settings.provider_timeout_seconds,
                    read_timeout=self._settings.provider_timeout_seconds,
                    retries={"max_attempts": 0},
                )
                client = boto3.client(
                    "polly",
                    aws_access_key_id=self._settings.aws_access_key_id.get_secret_value()
                    if self._settings.aws_access_key_id
                    else None,
                    aws_secret_access_key=self._settings.aws_secret_access_key.get_secret_value()
                    if self._settings.aws_secret_access_key
                    else None,
                    region_name=self._settings.aws_region,
                    config=config,
                )

            try:
                response = client.synthesize_speech(
                    Engine="neural",
                    OutputFormat="mp3",
                    SampleRate="24000",
                    TextType="text",
                    Text=text,
                    VoiceId=selected_voice,
                )
                stream = response.get("AudioStream")
                if stream is None:
                    raise IntegrationError(
                        provider="aws_polly",
                        code=IntegrationErrorCode.INVALID_RESPONSE,
                        message="Respuesta inválida de AWS Polly.",
                    )
                audio_bytes = bytes(stream.read())
                if hasattr(stream, "close"):
                    stream.close()
                return audio_bytes
            except IntegrationError:
                raise
            except TimeoutError:
                raise IntegrationError(
                    provider="aws_polly",
                    code=IntegrationErrorCode.TIMEOUT,
                    message="Tiempo de espera agotado al conectar con AWS Polly.",
                ) from None
            except Exception as err:
                err_type = type(err).__name__
                if any(k in err_type for k in ("Timeout", "ConnectTimeout", "ReadTimeout")):
                    raise IntegrationError(
                        provider="aws_polly",
                        code=IntegrationErrorCode.TIMEOUT,
                        message="Tiempo de espera agotado en AWS Polly.",
                    ) from None
                raise IntegrationError(
                    provider="aws_polly",
                    code=IntegrationErrorCode.UNAVAILABLE,
                    message="Error de comunicación con AWS Polly.",
                ) from None
            finally:
                if hasattr(client, "close"):
                    with contextlib.suppress(Exception):
                        client.close()

        try:
            raw_audio = await asyncio.wait_for(
                asyncio.to_thread(_call_polly),
                timeout=self._settings.provider_timeout_seconds + 2.0,
            )
        except TimeoutError:
            raise IntegrationError(
                provider="aws_polly",
                code=IntegrationErrorCode.TIMEOUT,
                message="Tiempo de espera agotado en AWS Polly.",
            ) from None

        if not raw_audio:
            raise IntegrationError(
                provider="aws_polly",
                code=IntegrationErrorCode.INVALID_RESPONSE,
                message="Respuesta de audio vacía de AWS Polly.",
            )

        return SynthesizedSpeech(audio=raw_audio, media_type="audio/mpeg")
