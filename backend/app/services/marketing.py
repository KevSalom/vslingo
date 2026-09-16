"""Consent-gated marketing ingestion and independent outbox dispatch."""

from dataclasses import dataclass

from app.core.config import Settings
from app.core.observability import safe_error_code
from app.marketing.gateway import MarketingGateway, MarketingGatewayError
from app.persistence.marketing import MarketingRepository


@dataclass(frozen=True, slots=True)
class DispatchResult:
    mode: str
    sent: int = 0
    failed: int = 0


class MarketingService:
    def __init__(
        self,
        repository: MarketingRepository,
        settings: Settings,
        gateway: MarketingGateway | None,
    ) -> None:
        self._repository = repository
        self._mode = settings.marketing_mode
        self._gateway = gateway

    async def dispatch(self, *, limit: int = 50) -> DispatchResult:
        if self._mode == "disabled" or self._gateway is None:
            return DispatchResult(mode=self._mode)
        sent = 0
        failed = 0
        for item in self._repository.dispatchable(limit=limit):
            try:
                await self._gateway.send(item.event)
            except MarketingGatewayError as error:
                self._repository.mark_retry(
                    item.id,
                    attempts=item.attempts,
                    error_code=safe_error_code(error),
                )
                failed += 1
            else:
                self._repository.mark_sent(item.id)
                sent += 1
        return DispatchResult(mode=self._mode, sent=sent, failed=failed)
