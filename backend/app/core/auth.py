"""Authentication port with deterministic fake and Clerk session-token adapter."""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from clerk_backend_api import Clerk
from clerk_backend_api.security import AuthenticateRequestOptions, authenticate_request
from fastapi import Request

from app.core.config import Settings

DEV_SESSION_TOKEN = "dev-session-token"


@dataclass(frozen=True, slots=True)
class AuthIdentity:
    user_id: str
    session_id: str


class AuthenticationError(RuntimeError):
    """Raised when a request lacks a valid, current session."""


class Authenticator(Protocol):
    async def authenticate(self, request: Request) -> AuthIdentity: ...

    async def revoke(self, identity: AuthIdentity) -> None: ...


class FakeAuthenticator:
    """Explicit bearer-token authenticator for local development and tests only."""

    def __init__(self, tokens: Mapping[str, AuthIdentity] | None = None) -> None:
        self._tokens = dict(
            tokens
            or {
                DEV_SESSION_TOKEN: AuthIdentity(
                    user_id="user_development",
                    session_id="session_development",
                )
            }
        )

    async def authenticate(self, request: Request) -> AuthIdentity:
        token = _bearer_token(request)
        identity = self._tokens.get(token) if token is not None else None
        if identity is None:
            raise AuthenticationError("Authentication required.")
        return identity

    async def revoke(self, identity: AuthIdentity) -> None:
        self._tokens = {
            token: candidate
            for token, candidate in self._tokens.items()
            if candidate.session_id != identity.session_id
        }


AuthenticateCall = Callable[[Any, AuthenticateRequestOptions], Any]
RevokeCall = Callable[[str], Awaitable[None]]


class ClerkAuthenticator:
    """Verify Clerk v2 session tokens and revoke their server-side session on logout."""

    def __init__(
        self,
        settings: Settings,
        *,
        authenticate_call: AuthenticateCall = authenticate_request,
        revoke_call: RevokeCall | None = None,
    ) -> None:
        if not settings.clerk_configured:
            raise ValueError("Clerk authentication is not configured.")
        secret_key = settings.clerk_secret_key
        jwt_key = settings.clerk_jwt_key
        assert secret_key is not None
        assert jwt_key is not None
        self._options = AuthenticateRequestOptions(
            secret_key=secret_key.get_secret_value(),
            jwt_key=jwt_key.get_secret_value().replace("\\n", "\n"),
            authorized_parties=list(settings.clerk_authorized_parties),
            accepts_token=["session_token"],
        )
        self._authenticate_call = authenticate_call
        self._revoke_call: RevokeCall
        if revoke_call is None:
            client = Clerk(bearer_auth=secret_key.get_secret_value())

            async def revoke_session(session_id: str) -> None:
                await client.sessions.revoke_async(session_id=session_id)

            self._revoke_call = revoke_session
        else:
            self._revoke_call = revoke_call

    async def authenticate(self, request: Request) -> AuthIdentity:
        try:
            state = await asyncio.to_thread(
                lambda: self._authenticate_call(request, self._options)
            )
        except Exception as exc:
            raise AuthenticationError("Authentication required.") from exc
        payload = state.payload if state.is_signed_in else None
        user_id = payload.get("sub") if isinstance(payload, dict) else None
        session_id = payload.get("sid") if isinstance(payload, dict) else None
        if not isinstance(user_id, str) or not isinstance(session_id, str):
            raise AuthenticationError("Authentication required.")
        return AuthIdentity(user_id=user_id, session_id=session_id)

    async def revoke(self, identity: AuthIdentity) -> None:
        await self._revoke_call(identity.session_id)


def build_authenticator(settings: Settings) -> Authenticator:
    if settings.auth_mode == "clerk":
        return ClerkAuthenticator(settings)
    return FakeAuthenticator()


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()
