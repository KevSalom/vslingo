"""Minimal Meta Conversions API adapter with a fixed Graph API version."""

from typing import Any

import httpx

from app.core.config import Settings
from app.marketing.gateway import MarketingEvent, MarketingGatewayError


class MetaMarketingGateway:
    def __init__(self, settings: Settings) -> None:
        if settings.marketing_mode not in {"meta_test", "meta_live"}:
            raise ValueError("Meta gateway requires meta_test or meta_live mode.")
        if not settings.meta_configured:
            raise ValueError("Meta gateway is not configured.")
        assert settings.meta_dataset_id is not None
        assert settings.meta_access_token is not None
        self._url = (
            f"https://graph.facebook.com/{settings.meta_graph_version}/"
            f"{settings.meta_dataset_id}/events"
        )
        self._access_token = settings.meta_access_token.get_secret_value().strip()
        self._test_event_code = (
            settings.meta_test_event_code
            if settings.marketing_mode == "meta_test"
            else None
        )
        self._timeout = settings.provider_timeout_seconds

    async def send(self, event: MarketingEvent) -> None:
        server_event: dict[str, Any] = {
            "event_name": event.event_name,
            "event_id": event.event_id,
            "action_source": event.action_source,
            **event.payload,
        }
        body: dict[str, Any] = {
            "data": [server_event],
            "access_token": self._access_token,
        }
        if self._test_event_code is not None:
            body["test_event_code"] = self._test_event_code
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(self._url, json=body)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise MarketingGatewayError("Meta delivery failed.") from exc
