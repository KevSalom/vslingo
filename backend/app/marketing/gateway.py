"""Provider-neutral marketing delivery contract."""

from dataclasses import dataclass
from typing import Any, Literal, Protocol

MarketingMode = Literal["disabled", "fake", "meta_test", "meta_live"]


class MarketingGatewayError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class MarketingEvent:
    event_name: Literal["PageView", "Lead", "Purchase"]
    event_id: str
    action_source: Literal["website", "system_generated"]
    payload: dict[str, Any]


class MarketingGateway(Protocol):
    async def send(self, event: MarketingEvent) -> None: ...
