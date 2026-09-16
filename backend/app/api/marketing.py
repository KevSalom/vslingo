"""Versioned consent and allowlisted browser marketing events."""

from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import AuthIdentity
from app.core.config import Settings
from app.persistence.marketing import MarketingRepository


class ConsentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analytics_allowed: bool


class VisitorConsentRequest(ConsentRequest):
    visitor_id: str = Field(min_length=36, max_length=36)


class PageViewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visitor_id: str = Field(min_length=36, max_length=36)
    event_id: str = Field(min_length=36, max_length=36)
    route: Literal[
        "/",
        "/demo",
        "/app",
        "/app/hablar",
        "/app/escribir",
        "/app/videos",
        "/app/cuenta",
    ]


def build_marketing_router(repository: MarketingRepository, settings: Settings) -> APIRouter:
    router = APIRouter(tags=["marketing"])

    @router.get("/api/marketing/config")
    async def marketing_config() -> dict[str, object]:
        return {
            "enabled": settings.marketing_mode != "disabled",
            "policy_version": settings.marketing_policy_version,
        }

    @router.get("/api/account/marketing-consent")
    async def get_consent(request: Request) -> dict[str, object]:
        return repository.consent(_identity(request).user_id)

    @router.put("/api/account/marketing-consent")
    async def save_consent(
        request: Request, payload: ConsentRequest
    ) -> dict[str, object]:
        return repository.save_consent(
            _identity(request).user_id, payload.analytics_allowed
        )

    @router.post("/api/marketing/visitor-consent")
    async def visitor_consent(payload: VisitorConsentRequest) -> object:
        try:
            repository.save_visitor_consent(
                payload.visitor_id, payload.analytics_allowed
            )
        except ValueError:
            return _invalid_marketing_request()
        return {"status": "saved"}

    @router.post("/api/marketing/page-view")
    async def page_view(request: Request, payload: PageViewRequest) -> object:
        try:
            queued = repository.enqueue_page_view(
                visitor_id=payload.visitor_id,
                event_id=payload.event_id,
                route=payload.route,
                client_ip_address=(
                    request.client.host if request.client is not None else None
                ),
                client_user_agent=request.headers.get("user-agent"),
            )
        except ValueError:
            return _invalid_marketing_request()
        return {"status": "queued" if queued else "not_allowed"}

    return router


def _identity(request: Request) -> AuthIdentity:
    identity = getattr(request.state, "auth_identity", None)
    if not isinstance(identity, AuthIdentity):
        raise RuntimeError("Protected endpoint reached without authenticated state.")
    return identity


def _invalid_marketing_request() -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "invalid_marketing_request",
                "message": "El evento de medición no es válido.",
                "retryable": False,
            }
        },
    )
