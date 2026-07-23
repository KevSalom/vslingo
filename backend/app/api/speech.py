"""API endpoints and request handlers for Speech synthesis."""

from fastapi import APIRouter, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.domain.speech import SpeechProvider, SpeechRequest, SpeechServiceError
from app.services.speech import SpeechService


class SpeechApiRequest(BaseModel):
    """Payload schema for POST /api/speech."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(description="Raw text to synthesize.")
    provider: SpeechProvider = Field(description="Explicit speech provider.")
    voice: str | None = Field(default=None, description="Optional voice identifier.")


def speech_error_response(
    code: str,
    message: str,
    status_code: int,
    retryable: bool,
) -> JSONResponse:
    """Build standardized public error envelope."""

    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "retryable": retryable,
            }
        },
    )


async def handle_speech_validation_error(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    """Map FastAPI/Pydantic validation errors on /api/speech to standardized envelopes."""

    del request
    code = "invalid_request"
    message = "La solicitud enviada al servicio de voz es inválida."

    if isinstance(exc, RequestValidationError):
        for error in exc.errors():
            loc = error.get("loc", ())
            if "text" in loc:
                msg = str(error.get("msg", ""))
                if "string" in msg or "value" in msg:
                    code = "invalid_request"
            elif "provider" in loc:
                code = "invalid_request"
                message = "El proveedor de voz especificado no es válido."

    return speech_error_response(code=code, message=message, status_code=422, retryable=False)


def build_speech_router(speech_service: SpeechService) -> APIRouter:
    """Construct router for speech synthesis."""

    router = APIRouter(prefix="/api/speech", tags=["speech"])

    @router.post("", response_class=Response)
    async def synthesize(payload: SpeechApiRequest) -> Response:
        try:
            req = SpeechRequest(
                text=payload.text,
                provider=payload.provider,
                voice=payload.voice,
            )
            speech = await speech_service.synthesize(req)
            return Response(
                content=speech.audio,
                media_type="audio/mpeg",
                headers={
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )
        except SpeechServiceError as err:
            return speech_error_response(
                code=err.code,
                message=err.message,
                status_code=err.status_code,
                retryable=err.retryable,
            )

    return router
