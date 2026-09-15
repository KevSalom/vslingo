"""Authenticated session, preference and WebSocket-ticket endpoints."""

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import Authenticator, AuthIdentity
from app.persistence.identity import (
    IdentityRepository,
    PreferenceConflictError,
    UserPreferences,
)
from app.persistence.ws_tickets import WebSocketTicketRepository


class SessionResponse(BaseModel):
    user_id: str
    session_id: str
    auth_mode: str


class PreferencesPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theme: str = Field(pattern="^(light|dark)$")
    speech_voice: str = Field(min_length=1, max_length=128)
    version: int = Field(ge=0)


class TicketResponse(BaseModel):
    ticket: str
    expires_in_seconds: int


def build_session_router(
    *,
    auth_mode: str,
    authenticator: Authenticator,
    identities: IdentityRepository,
    tickets: WebSocketTicketRepository,
    allowed_voices: tuple[str, ...],
) -> APIRouter:
    """Build endpoints that derive ownership only from verified request state."""

    router = APIRouter(prefix="/api", tags=["session"])

    @router.get("/session", response_model=SessionResponse)
    async def get_session(request: Request) -> SessionResponse:
        identity = _identity(request)
        return SessionResponse(
            user_id=identity.user_id,
            session_id=identity.session_id,
            auth_mode=auth_mode,
        )

    @router.post("/session/ws-ticket", response_model=TicketResponse)
    async def create_ws_ticket(request: Request) -> TicketResponse:
        identity = _identity(request)
        issued = tickets.issue(identity.user_id, identity.session_id)
        return TicketResponse(
            ticket=issued.ticket,
            expires_in_seconds=issued.expires_in_seconds,
        )

    @router.post("/session/logout", response_class=Response, response_model=None)
    async def logout(request: Request) -> Response | JSONResponse:
        identity = _identity(request)
        try:
            await authenticator.revoke(identity)
        except Exception:
            return _error_response(
                502,
                "logout_failed",
                "No se pudo cerrar la sesión. Inténtalo de nuevo.",
                True,
            )
        tickets.revoke_session(identity.session_id)
        return Response(status_code=204)

    @router.get("/preferences", response_model=PreferencesPayload)
    async def get_preferences(request: Request) -> UserPreferences:
        return identities.get_preferences(_identity(request).user_id)

    @router.put("/preferences", response_model=PreferencesPayload)
    async def save_preferences(
        request: Request,
        payload: PreferencesPayload,
    ) -> UserPreferences | JSONResponse:
        if payload.speech_voice not in allowed_voices:
            return _error_response(
                422,
                "invalid_preference",
                "La voz seleccionada no está disponible.",
                False,
            )
        try:
            return identities.save_preferences(
                _identity(request).user_id,
                UserPreferences(**payload.model_dump()),
            )
        except PreferenceConflictError:
            return _error_response(
                409,
                "preference_conflict",
                "Tus preferencias cambiaron en otra sesión. Recarga e inténtalo de nuevo.",
                True,
            )

    return router


def authentication_error_response() -> JSONResponse:
    return _error_response(
        401,
        "authentication_required",
        "Inicia sesión para continuar.",
        False,
    )


def _identity(request: Request) -> AuthIdentity:
    identity = getattr(request.state, "auth_identity", None)
    if not isinstance(identity, AuthIdentity):
        raise RuntimeError("Protected endpoint reached without authenticated state.")
    return identity


def _error_response(
    status_code: int,
    code: str,
    message: str,
    retryable: bool,
) -> JSONResponse:
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
