"""Speech service coordinating provider selection and validation."""

import asyncio
from collections.abc import Mapping

from app.core.protection import ProviderBusyError, ProviderGate
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.models import SynthesizedSpeech
from app.domain.ports import SpeechSynthesizerPort
from app.domain.speech import SpeechProvider, SpeechRequest, SpeechServiceError


class SpeechService:
    """Service handling text synthesis with explicit provider selection."""

    def __init__(
        self,
        providers: Mapping[SpeechProvider, SpeechSynthesizerPort],
        *,
        gate: ProviderGate | None = None,
    ) -> None:
        self._providers = dict(providers)
        self._gate = gate

    async def synthesize(self, request: SpeechRequest) -> SynthesizedSpeech:
        """Validate input and synthesize speech via selected provider without fallback."""

        request.validate()

        provider_port = self._providers.get(request.provider)
        if provider_port is None:
            raise SpeechServiceError(
                code="invalid_request",
                message="El proveedor de voz especificado no es válido.",
                status_code=422,
                retryable=False,
            )

        try:
            if self._gate is None:
                result = await provider_port.synthesize(request.clean_text, voice=request.voice)
            else:
                async with self._gate.slot():
                    result = await provider_port.synthesize(request.clean_text, voice=request.voice)
        except asyncio.CancelledError:
            raise
        except ProviderBusyError as err:
            raise SpeechServiceError(
                code="provider_busy",
                message="El proveedor de voz está ocupado. Inténtalo de nuevo pronto.",
                status_code=503,
                retryable=True,
            ) from err
        except IntegrationError as err:
            raise self._map_integration_error(err) from err
        except SpeechServiceError:
            raise
        except Exception as err:
            raise SpeechServiceError(
                code="provider_unavailable",
                message="Error inesperado durante la síntesis de voz.",
                status_code=503,
                retryable=True,
            ) from err

        if not result.audio or result.media_type != "audio/mpeg":
            raise SpeechServiceError(
                code="invalid_provider_response",
                message="El proveedor devolvió una respuesta de audio inválida.",
                status_code=502,
                retryable=True,
            )

        return result

    @staticmethod
    def _map_integration_error(err: IntegrationError) -> SpeechServiceError:
        match err.code:
            case IntegrationErrorCode.NOT_CONFIGURED:
                return SpeechServiceError(
                    code="provider_not_configured",
                    message="El proveedor de voz seleccionado no está configurado.",
                    status_code=503,
                    retryable=False,
                )
            case IntegrationErrorCode.TIMEOUT:
                return SpeechServiceError(
                    code="provider_timeout",
                    message="El proveedor de voz agotó el tiempo de respuesta.",
                    status_code=504,
                    retryable=True,
                )
            case IntegrationErrorCode.UNAVAILABLE:
                return SpeechServiceError(
                    code="provider_unavailable",
                    message="El proveedor de voz no se encuentra disponible.",
                    status_code=503,
                    retryable=True,
                )
            case IntegrationErrorCode.INVALID_RESPONSE:
                return SpeechServiceError(
                    code="invalid_provider_response",
                    message="El proveedor de voz devolvió una respuesta de audio no válida.",
                    status_code=502,
                    retryable=True,
                )
            case _:
                return SpeechServiceError(
                    code="invalid_request",
                    message="La solicitud de síntesis es inválida.",
                    status_code=422,
                    retryable=False,
                )
