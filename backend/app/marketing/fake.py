"""Deterministic Meta CAPI replacement for development and tests."""

from dataclasses import dataclass, field

from app.marketing.gateway import MarketingEvent, MarketingGatewayError


@dataclass(slots=True)
class FakeMarketingGateway:
    events: list[MarketingEvent] = field(default_factory=list)
    error: MarketingGatewayError | None = None

    async def send(self, event: MarketingEvent) -> None:
        if self.error is not None:
            raise self.error
        self.events.append(event)
