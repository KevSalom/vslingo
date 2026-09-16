"""One-shot billing reconciliation command for a scheduler or operator."""

import asyncio
import json
from dataclasses import asdict

from app.billing.fake import FakeBillingGateway
from app.billing.paypal import build_billing_gateway
from app.core.config import Settings
from app.core.product import ProductConfig
from app.persistence.billing import BillingRepository
from app.persistence.database import Database
from app.services.billing import BillingService


async def _run() -> None:
    settings = Settings()
    database = Database(
        settings.database_path, busy_timeout_ms=settings.sqlite_busy_timeout_ms
    )
    database.migrate()
    product = ProductConfig.from_settings(settings)
    repository = BillingRepository(database, product)
    gateway = (
        FakeBillingGateway()
        if settings.billing_mode == "fake"
        else build_billing_gateway(settings)
    )
    service = BillingService(repository, gateway, settings, product)
    try:
        result = await service.reconcile()
        print(json.dumps(asdict(result), sort_keys=True))
    finally:
        database.close()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
