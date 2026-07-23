"""FastAPI application factory and development entrypoint."""

from typing import Final

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import __version__
from app.core.config import Settings
from app.providers.readiness import get_provider_readiness

SERVICE_NAME: Final = "VSLingo API"


class ProviderHealth(BaseModel):
    """Secret-free provider readiness exposed by health."""

    configured: bool


class HealthResponse(BaseModel):
    """Public health response for deployment and local checks."""

    status: str
    service: str
    version: str
    environment: str
    providers: dict[str, ProviderHealth]


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build an isolated FastAPI application with explicit settings."""

    runtime_settings = settings or Settings()
    application = FastAPI(title=SERVICE_NAME, version=__version__)
    application.state.settings = runtime_settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[str(runtime_settings.frontend_origin).rstrip("/")],
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )

    @application.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        """Report app and provider readiness without credential material."""

        providers = {
            provider.name: ProviderHealth(configured=provider.configured)
            for provider in get_provider_readiness(runtime_settings)
        }
        return HealthResponse(
            status="ok",
            service=SERVICE_NAME,
            version=__version__,
            environment=runtime_settings.environment,
            providers=providers,
        )

    return application


app = create_app()


def run() -> None:
    """Run the development server through the installed console script."""

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
