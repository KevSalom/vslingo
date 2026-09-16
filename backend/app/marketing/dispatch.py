"""One-shot consent-aware marketing outbox dispatcher."""

import asyncio
import json
from dataclasses import asdict

from app.core.config import Settings
from app.marketing.fake import FakeMarketingGateway
from app.marketing.meta import MetaMarketingGateway
from app.persistence.database import Database
from app.persistence.marketing import MarketingRepository
from app.services.marketing import MarketingService


async def _run() -> None:
    settings = Settings()
    database = Database(
        settings.database_path, busy_timeout_ms=settings.sqlite_busy_timeout_ms
    )
    database.migrate()
    repository = MarketingRepository(
        database,
        policy_version=settings.marketing_policy_version,
        frontend_origin=settings.normalized_frontend_origin,
    )
    gateway = (
        None
        if settings.marketing_mode == "disabled"
        else FakeMarketingGateway()
        if settings.marketing_mode == "fake"
        else MetaMarketingGateway(settings)
    )
    try:
        result = await MarketingService(repository, settings, gateway).dispatch()
        print(json.dumps(asdict(result), sort_keys=True))
    finally:
        database.close()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
