"""Print aggregate revenue, refund, provider-cost, and outbox status."""

import json

from app.core.config import Settings
from app.persistence.database import Database
from app.persistence.marketing import MarketingRepository


def main() -> None:
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
    try:
        print(json.dumps(repository.operator_summary(), sort_keys=True))
    finally:
        database.close()


if __name__ == "__main__":
    main()
