import asyncio
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app
from app.marketing.fake import FakeMarketingGateway
from app.marketing.gateway import MarketingEvent, MarketingGatewayError
from app.marketing.meta import MetaMarketingGateway
from app.persistence.database import Database

AUTH = {"Authorization": "Bearer dev-session-token"}
SIGNED = {"x-fake-paypal-signature": "valid"}


def _app(
    tmp_path: Path, *, mode: str = "fake"
) -> tuple[Any, Database, FakeMarketingGateway]:
    path = tmp_path / "marketing.db"
    database = Database(path)
    gateway = FakeMarketingGateway()
    application = create_app(
        Settings(
            _env_file=None,
            environment="test",
            database_path=path,
            marketing_mode=mode,
        ),
        database=database,
        marketing_gateway=gateway,
    )
    return application, database, gateway


def _payment(
    event_id: str,
    subscription_id: str,
    transaction_id: str,
    occurred_at: str,
) -> dict[str, Any]:
    return {
        "id": event_id,
        "event_type": "PAYMENT.SALE.COMPLETED",
        "create_time": occurred_at,
        "resource": {
            "id": transaction_id,
            "billing_agreement_id": subscription_id,
            "amount": {"total": "2.99", "currency": "USD"},
            "payee": {"merchant_id": "MERCHANT-FAKE"},
        },
    }


def _subscribe(client: TestClient) -> str:
    checkout = client.post("/api/billing/checkout")
    assert checkout.status_code == 200
    return checkout.json()["approval_url"].rsplit("/", 1)[-1]


def _pay(
    client: TestClient,
    subscription_id: str,
    *,
    event_id: str = "WH-PAY-1",
    transaction_id: str = "SALE-1",
    occurred_at: str = "2026-09-16T12:00:00Z",
) -> None:
    response = client.post(
        "/api/billing/webhooks/paypal",
        json=_payment(event_id, subscription_id, transaction_id, occurred_at),
        headers=SIGNED,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "processed"


def test_verified_registration_queues_one_lead_but_no_consent_sends_nothing(
    tmp_path: Path,
) -> None:
    application, database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        assert client.get("/api/account/quota").status_code == 200
        assert client.get("/api/account/quota").status_code == 200
        consent = client.get("/api/account/marketing-consent").json()

        result = asyncio.run(application.state.marketing_service.dispatch())

        assert consent["status"] == "pending"
        assert result.sent == 0
        assert gateway.events == []
        assert database.query_one(
            "SELECT COUNT(*) AS count FROM marketing_outbox WHERE event_name = 'Lead'"
        )["count"] == 1


def test_rejection_blocks_lead_and_purchase_without_blocking_paid_access(
    tmp_path: Path,
) -> None:
    application, database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        client.put(
            "/api/account/marketing-consent", json={"analytics_allowed": True}
        )
        rejected = client.put(
            "/api/account/marketing-consent", json={"analytics_allowed": False}
        )
        subscription_id = _subscribe(client)
        _pay(client, subscription_id)

        result = asyncio.run(application.state.marketing_service.dispatch())

        assert rejected.json()["status"] == "rejected"
        assert client.get("/api/account/quota").json()["source"] == "monthly"
        assert result.sent == 0
        assert gateway.events == []
        assert database.query_one(
            "SELECT COUNT(*) AS count FROM marketing_outbox WHERE event_name = 'Purchase'"
        )["count"] == 1


def test_meta_failure_retries_without_rolling_back_payment_or_changing_event_id(
    tmp_path: Path,
) -> None:
    application, database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        client.put("/api/account/marketing-consent", json={"analytics_allowed": True})
        subscription_id = _subscribe(client)
        _pay(client, subscription_id)
        before = database.query_all(
            "SELECT event_id FROM marketing_outbox ORDER BY event_name"
        )
        gateway.error = MarketingGatewayError("synthetic failure")

        result = asyncio.run(application.state.marketing_service.dispatch())
        after = database.query_all(
            "SELECT event_id, status, attempts FROM marketing_outbox ORDER BY event_name"
        )

        assert result.failed == 2
        assert [row["event_id"] for row in before] == [row["event_id"] for row in after]
        assert {row["status"] for row in after} == {"retry"}
        assert {row["attempts"] for row in after} == {1}
        assert client.get("/api/account/quota").json()["source"] == "monthly"
        summary = application.state.marketing_repository.operator_summary()
        assert summary["payments"] == 1
        assert summary["gross_minor"] == 299
        assert "user_id" not in summary


def test_page_view_requires_current_consent_and_allowlisted_route(tmp_path: Path) -> None:
    application, database, _gateway = _app(tmp_path)
    visitor_id = str(uuid4())
    event_id = str(uuid4())
    with TestClient(application) as client:
        no_consent = client.post(
            "/api/marketing/page-view",
            json={"visitor_id": visitor_id, "event_id": event_id, "route": "/"},
        )
        client.post(
            "/api/marketing/visitor-consent",
            json={"visitor_id": visitor_id, "analytics_allowed": True},
        )
        queued = client.post(
            "/api/marketing/page-view",
            json={"visitor_id": visitor_id, "event_id": event_id, "route": "/"},
        )
        duplicate = client.post(
            "/api/marketing/page-view",
            json={"visitor_id": visitor_id, "event_id": event_id, "route": "/"},
        )
        invalid = client.post(
            "/api/marketing/page-view",
            json={
                "visitor_id": visitor_id,
                "event_id": str(uuid4()),
                "route": "/app/private?token=secret",
            },
        )

        assert no_consent.json()["status"] == "not_allowed"
        assert queued.json()["status"] == duplicate.json()["status"] == "queued"
        assert invalid.status_code == 422
        row = database.query_one(
            "SELECT payload_json FROM marketing_outbox WHERE event_name = 'PageView'"
        )
        assert database.query_one(
            "SELECT COUNT(*) AS count FROM marketing_outbox WHERE event_name = 'PageView'"
        )["count"] == 1
        assert "token" not in row["payload_json"]


def test_first_payment_and_renewal_have_unique_purchase_ids_and_sources(
    tmp_path: Path,
) -> None:
    application, database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        client.put("/api/account/marketing-consent", json={"analytics_allowed": True})
        subscription_id = _subscribe(client)
        _pay(client, subscription_id)
        _pay(
            client,
            subscription_id,
            event_id="WH-PAY-2",
            transaction_id="SALE-2",
            occurred_at="2026-10-16T12:00:00Z",
        )

        result = asyncio.run(application.state.marketing_service.dispatch())
        purchase_events = [event for event in gateway.events if event.event_name == "Purchase"]

        assert result.sent == 3
        assert [event.event_id for event in purchase_events] == [
            "purchase:SALE-1",
            "purchase:SALE-2",
        ]
        assert [event.action_source for event in purchase_events] == [
            "website",
            "system_generated",
        ]
        assert database.query_one("SELECT COUNT(*) AS count FROM payments")["count"] == 2


def test_disabled_mode_keeps_recoverable_outbox_without_delivery(tmp_path: Path) -> None:
    application, database, gateway = _app(tmp_path, mode="disabled")
    with TestClient(application, headers=AUTH) as client:
        client.put("/api/account/marketing-consent", json={"analytics_allowed": True})
        result = asyncio.run(application.state.marketing_service.dispatch())

        assert result.mode == "disabled"
        assert result.sent == 0
        assert gateway.events == []
        assert database.query_one("SELECT COUNT(*) AS count FROM marketing_outbox")[
            "count"
        ] == 1


@respx.mock
async def test_meta_test_adapter_sends_dedupe_id_and_test_code() -> None:
    route = respx.post("https://graph.facebook.com/v25.0/dataset-id/events").mock(
        return_value=httpx.Response(200, json={"events_received": 1})
    )
    gateway = MetaMarketingGateway(
        Settings(
            _env_file=None,
            environment="test",
            marketing_mode="meta_test",
            meta_dataset_id="dataset-id",
            meta_access_token="test-token",
            meta_test_event_code="TEST123",
        )
    )
    event = MarketingEvent(
        event_name="Lead",
        event_id="lead:stable-id",
        action_source="website",
        payload={"event_time": 1, "user_data": {"external_id": ["hash"]}},
    )

    await gateway.send(event)

    body = route.calls.last.request.read().decode()
    assert '"event_id":"lead:stable-id"' in body
    assert '"test_event_code":"TEST123"' in body
    assert '"access_token":"test-token"' in body


def test_meta_modes_fail_closed_when_configuration_is_incomplete() -> None:
    with pytest.raises(ValidationError, match="dataset ID and access token"):
        Settings(_env_file=None, marketing_mode="meta_live")
    with pytest.raises(ValidationError, match="META_TEST_EVENT_CODE"):
        Settings(
            _env_file=None,
            marketing_mode="meta_test",
            meta_dataset_id="dataset",
            meta_access_token="token",
        )
