import asyncio
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.billing.fake import FakeBillingGateway
from app.billing.gateway import BillingProviderResponseError, ProviderTransaction
from app.billing.paypal import PayPalBillingGateway
from app.core.config import Settings
from app.main import create_app
from app.persistence.database import Database

AUTH = {"Authorization": "Bearer dev-session-token"}
SIGNED = {"x-fake-paypal-signature": "valid"}


def _app(tmp_path: Path) -> tuple[Any, Database, FakeBillingGateway]:
    path = tmp_path / "billing.db"
    database = Database(path)
    gateway = FakeBillingGateway()
    application = create_app(
        Settings(_env_file=None, environment="test", database_path=path),
        database=database,
        billing_gateway=gateway,
    )
    return application, database, gateway


def _payment(
    event_id: str,
    subscription_id: str,
    transaction_id: str,
    *,
    occurred_at: str = "2026-09-16T12:00:00Z",
    amount: str = "2.99",
    currency: str = "USD",
    merchant_id: str = "MERCHANT-FAKE",
) -> dict[str, Any]:
    return {
        "id": event_id,
        "event_type": "PAYMENT.SALE.COMPLETED",
        "create_time": occurred_at,
        "resource": {
            "id": transaction_id,
            "billing_agreement_id": subscription_id,
            "amount": {"total": amount, "currency": currency},
            "payee": {"merchant_id": merchant_id},
        },
    }


def _adjustment(
    event_id: str,
    transaction_id: str,
    parent_id: str,
    amount: str,
    *,
    event_type: str = "PAYMENT.SALE.REFUNDED",
    occurred_at: str = "2026-09-20T12:00:00Z",
) -> dict[str, Any]:
    return {
        "id": event_id,
        "event_type": event_type,
        "create_time": occurred_at,
        "resource": {
            "id": transaction_id,
            "sale_id": parent_id,
            "amount": {"total": amount, "currency": "USD"},
        },
    }


def _checkout(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/billing/checkout")
    assert response.status_code == 200
    return response.json()


def _webhook(client: TestClient, payload: dict[str, Any]) -> Any:
    return client.post(
        "/api/billing/webhooks/paypal", json=payload, headers=SIGNED
    )


def test_checkout_is_idempotent_and_browser_return_does_not_activate(
    tmp_path: Path,
) -> None:
    application, database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        first = _checkout(client)
        second = _checkout(client)
        quota = client.get("/api/account/quota").json()

        assert first == second
        assert len(gateway.create_calls) == 1
        assert quota["source"] == "trial"
        assert client.get("/api/account/billing").json()["subscription"]["status"] == (
            "approval_pending"
        )
        assert database.query_one("SELECT COUNT(*) AS count FROM usage_periods")[
            "count"
        ] == 1


def test_pending_checkout_is_transparently_replaced_before_returning_to_paypal(
    tmp_path: Path,
) -> None:
    application, database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        first = _checkout(client)
        first_subscription_id = first["approval_url"].rsplit("/", 1)[-1]

        replacement = client.post(
            "/api/billing/checkout", params={"replace_pending": "true"}
        )

        assert replacement.status_code == 200
        replacement_body = replacement.json()
        assert replacement_body["attempt_id"] != first["attempt_id"]
        assert replacement_body["approval_url"] != first["approval_url"]
        assert gateway.cancel_calls == [first_subscription_id]
        assert len(gateway.create_calls) == 2
        assert database.query_one(
            "SELECT status FROM billing_attempts WHERE id = ?",
            (first["attempt_id"],),
        )["status"] == "cancelled"
        assert database.query_one(
            "SELECT status FROM subscriptions WHERE provider_subscription_id = ?",
            (first_subscription_id,),
        )["status"] == "cancelled"
        assert database.query_one(
            "SELECT COUNT(*) AS count FROM billing_attempts "
            "WHERE status IN ('creating', 'approval_pending', 'uncertain')"
        )["count"] == 1


def test_pending_checkout_is_never_replaced_after_provider_approval(
    tmp_path: Path,
) -> None:
    application, _database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        first = _checkout(client)
        subscription_id = first["approval_url"].rsplit("/", 1)[-1]
        gateway.set_status(subscription_id, "active")

        response = client.post(
            "/api/billing/checkout", params={"replace_pending": "true"}
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "subscription_exists"
        assert gateway.cancel_calls == []
        assert len(gateway.create_calls) == 1


def test_missing_provider_checkout_is_replaced_without_blocking_user(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    application, database, gateway = _app(tmp_path)

    async def missing_subscription(
        _gateway: FakeBillingGateway, provider_subscription_id: str
    ) -> Any:
        del provider_subscription_id
        raise BillingProviderResponseError(
            "missing stale checkout", status_code=404
        )

    monkeypatch.setattr(FakeBillingGateway, "get_subscription", missing_subscription)
    with TestClient(application, headers=AUTH) as client:
        first = _checkout(client)
        replacement = client.post(
            "/api/billing/checkout", params={"replace_pending": "true"}
        )

        assert replacement.status_code == 200
        assert replacement.json()["attempt_id"] != first["attempt_id"]
        assert gateway.cancel_calls == []
        assert len(gateway.create_calls) == 2
        assert database.query_one(
            "SELECT status FROM billing_attempts WHERE id = ?",
            (first["attempt_id"],),
        )["status"] == "cancelled"


def test_uncancellable_pending_checkout_is_rechecked_then_replaced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    application, _database, gateway = _app(tmp_path)

    async def reject_cancel(
        fake_gateway: FakeBillingGateway,
        provider_subscription_id: str,
        *,
        request_id: str,
    ) -> None:
        del request_id
        fake_gateway.cancel_calls.append(provider_subscription_id)
        raise BillingProviderResponseError(
            "invalid status",
            status_code=422,
            issue_codes=frozenset({"SUBSCRIPTION_STATUS_INVALID"}),
        )

    monkeypatch.setattr(FakeBillingGateway, "cancel_subscription", reject_cancel)
    with TestClient(application, headers=AUTH) as client:
        first = _checkout(client)
        replacement = client.post(
            "/api/billing/checkout", params={"replace_pending": "true"}
        )

        assert replacement.status_code == 200
        assert replacement.json()["attempt_id"] != first["attempt_id"]
        assert len(gateway.cancel_calls) == 1
        assert len(gateway.create_calls) == 2


def test_cancel_race_rechecks_and_never_replaces_newly_active_subscription(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    application, _database, gateway = _app(tmp_path)
    reads = 0
    original_get = FakeBillingGateway.get_subscription

    async def activate_during_cancel(
        fake_gateway: FakeBillingGateway, provider_subscription_id: str
    ) -> Any:
        nonlocal reads
        reads += 1
        if reads == 2:
            fake_gateway.set_status(provider_subscription_id, "active")
        return await original_get(fake_gateway, provider_subscription_id)

    async def reject_cancel(
        _gateway: FakeBillingGateway,
        provider_subscription_id: str,
        *,
        request_id: str,
    ) -> None:
        del provider_subscription_id, request_id
        raise BillingProviderResponseError("status changed", status_code=422)

    monkeypatch.setattr(FakeBillingGateway, "get_subscription", activate_during_cancel)
    monkeypatch.setattr(FakeBillingGateway, "cancel_subscription", reject_cancel)
    with TestClient(application, headers=AUTH) as client:
        _checkout(client)
        response = client.post(
            "/api/billing/checkout", params={"replace_pending": "true"}
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "subscription_exists"
        assert len(gateway.create_calls) == 1


def test_verified_payment_activates_once_and_duplicate_transaction_is_safe(
    tmp_path: Path,
) -> None:
    application, database, _gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        subscription_id = _checkout(client)["approval_url"].rsplit("/", 1)[-1]
        payload = _payment("WH-PAY-1", subscription_id, "SALE-1")

        assert _webhook(client, payload).json()["status"] == "processed"
        assert _webhook(client, payload).json()["duplicate"] is True
        same_sale = _payment("WH-PAY-2", subscription_id, "SALE-1")
        assert _webhook(client, same_sale).json()["status"] == "processed"
        assert client.get("/api/account/quota").json()["source"] == "monthly"
        assert database.query_one("SELECT COUNT(*) AS count FROM payments")["count"] == 1
        assert database.query_one(
            "SELECT COUNT(*) AS count FROM usage_periods WHERE source = 'monthly'"
        )["count"] == 1


def test_invalid_signature_amount_currency_and_merchant_never_grant_access(
    tmp_path: Path,
) -> None:
    application, database, _gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        subscription_id = _checkout(client)["approval_url"].rsplit("/", 1)[-1]
        unsigned = client.post(
            "/api/billing/webhooks/paypal",
            json=_payment("WH-UNSIGNED", subscription_id, "SALE-U"),
        )
        assert unsigned.status_code == 401

        bad_events = (
            _payment("WH-AMOUNT", subscription_id, "SALE-A", amount="3.99"),
            _payment("WH-CURRENCY", subscription_id, "SALE-C", currency="EUR"),
            _payment(
                "WH-MERCHANT", subscription_id, "SALE-M", merchant_id="OTHER-MERCHANT"
            ),
        )
        for event in bad_events:
            response = _webhook(client, event)
            assert response.status_code == 200
            assert response.json()["status"] == "rejected"

        assert database.query_one("SELECT COUNT(*) AS count FROM payments")["count"] == 0


def test_cancellation_stops_renewal_but_preserves_the_paid_period(
    tmp_path: Path,
) -> None:
    application, _database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        subscription_id = _checkout(client)["approval_url"].rsplit("/", 1)[-1]
        _webhook(client, _payment("WH-PAY", subscription_id, "SALE-CANCEL"))
        ends_at = client.get("/api/account/quota").json()["ends_at"]

        response = client.post("/api/billing/cancel")

        assert response.status_code == 200
        assert response.json()["subscription"]["auto_renew"] is False
        assert response.json()["subscription"]["status"] == "cancelled"
        assert client.get("/api/account/quota").json()["ends_at"] == ends_at
        assert gateway.cancel_calls == [subscription_id]
        assert client.post("/api/billing/checkout").status_code == 409


def test_late_old_payment_and_refund_do_not_replace_or_revoke_newer_period(
    tmp_path: Path,
) -> None:
    application, database, _gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        subscription_id = _checkout(client)["approval_url"].rsplit("/", 1)[-1]
        _webhook(
            client,
            _payment(
                "WH-NEW", subscription_id, "SALE-NEW", occurred_at="2026-09-16T12:00:00Z"
            ),
        )
        current_id = client.get("/api/account/quota").json()["period_id"]
        _webhook(
            client,
            _payment(
                "WH-OLD", subscription_id, "SALE-OLD", occurred_at="2026-08-16T12:00:00Z"
            ),
        )
        _webhook(client, _adjustment("WH-REFUND-OLD", "REF-OLD", "SALE-OLD", "2.99"))

        assert client.get("/api/account/quota").json()["period_id"] == current_id
        old_period = database.query_one(
            """SELECT up.status FROM usage_periods up JOIN payments p
            ON p.usage_period_id = up.id WHERE p.provider_transaction_id = 'SALE-OLD'"""
        )
        assert old_period["status"] == "replaced"


def test_total_and_partial_refunds_have_distinct_access_effects(tmp_path: Path) -> None:
    application, database, _gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        subscription_id = _checkout(client)["approval_url"].rsplit("/", 1)[-1]
        _webhook(client, _payment("WH-PAY", subscription_id, "SALE-REFUND"))

        partial = _webhook(
            client, _adjustment("WH-PARTIAL", "REF-P", "SALE-REFUND", "1.00")
        )
        assert partial.json()["status"] == "processed"
        assert client.get("/api/account/quota").status_code == 200
        assert database.query_one("SELECT status FROM billing_adjustments")["status"] == (
            "needs_manual_review"
        )

        total = _webhook(
            client, _adjustment("WH-TOTAL", "REF-T", "SALE-REFUND", "1.99")
        )
        assert total.json()["status"] == "processed"
        expired = client.get("/api/account/quota")
        assert expired.status_code == 403
        assert expired.json()["error"]["code"] == "access_expired"


def test_reconciliation_grants_a_missing_payment_without_browser_return(
    tmp_path: Path,
) -> None:
    application, _database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        subscription_id = _checkout(client)["approval_url"].rsplit("/", 1)[-1]
        gateway.set_status(subscription_id, "active")
        gateway.add_transaction(
            subscription_id,
            ProviderTransaction(
                provider_transaction_id="SALE-RECONCILED",
                occurred_at="2026-09-16T12:00:00Z",
                amount_minor=299,
                currency="USD",
            ),
        )

        result = asyncio.run(application.state.billing_service.reconcile())

        assert result.transactions_processed == 1
        assert client.get("/api/account/quota").json()["source"] == "monthly"


def test_authenticated_return_confirms_payment_immediately_and_idempotently(
    tmp_path: Path,
) -> None:
    application, database, gateway = _app(tmp_path)
    with TestClient(application, headers=AUTH) as client:
        subscription_id = _checkout(client)["approval_url"].rsplit("/", 1)[-1]
        gateway.set_status(subscription_id, "active")
        gateway.add_transaction(
            subscription_id,
            ProviderTransaction(
                provider_transaction_id="SALE-RETURN",
                occurred_at="2026-09-16T12:00:00Z",
                amount_minor=299,
                currency="USD",
            ),
        )

        first = client.post("/api/billing/confirm")
        second = client.post("/api/billing/confirm")

        assert first.status_code == 200
        assert first.json()["subscription"]["access_ends_at"] is not None
        assert second.status_code == 200
        assert client.get("/api/account/quota").json()["source"] == "monthly"
        assert database.query_one("SELECT COUNT(*) AS count FROM payments")["count"] == 1


def test_fake_billing_is_rejected_outside_development_and_test() -> None:
    with pytest.raises(ValidationError, match="BILLING_MODE=fake"):
        Settings(
            _env_file=None,
            environment="production",
            auth_mode="clerk",
            clerk_secret_key="secret",
            clerk_jwt_key="jwt",
            frontend_origin="https://example.com",
        )

    with pytest.raises(ValidationError, match="must use FRONTEND_ORIGIN"):
        Settings(
            _env_file=None,
            billing_return_url="https://untrusted.example/return",
        )


@respx.mock
async def test_sandbox_adapter_uses_sandbox_and_stable_request_id() -> None:
    token = respx.post("https://api-m.sandbox.paypal.com/v1/oauth2/token").mock(
        return_value=httpx.Response(200, json={"access_token": "sandbox-token"})
    )
    create = respx.post(
        "https://api-m.sandbox.paypal.com/v1/billing/subscriptions"
    ).mock(
        return_value=httpx.Response(
            201,
            json={
                "id": "I-SANDBOX",
                "status": "APPROVAL_PENDING",
                "links": [
                    {"rel": "approve", "href": "https://www.sandbox.paypal.com/approve"}
                ],
            },
        )
    )
    details = respx.get(
        "https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-SANDBOX"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "I-SANDBOX",
                "plan_id": "plan-id",
                "status": "ACTIVE",
                "billing_info": {"next_billing_time": "2026-10-16T12:00:00Z"},
            },
        )
    )
    gateway = PayPalBillingGateway(
        Settings(
            _env_file=None,
            environment="test",
            billing_mode="paypal_sandbox",
            paypal_client_id="client-id",
            paypal_client_secret="client-secret",
            paypal_webhook_id="webhook-id",
            paypal_plan_id="plan-id",
            paypal_merchant_id="merchant-id",
        )
    )

    checkout = await gateway.create_subscription(
        request_id="stable-request-id",
        custom_id="attempt-id",
        plan_id="plan-id",
        return_url="https://example.com/return",
        cancel_url="https://example.com/cancel",
    )

    assert token.called
    assert checkout.provider_subscription_id == "I-SANDBOX"
    assert create.calls.last.request.headers["PayPal-Request-Id"] == "stable-request-id"
    subscription = await gateway.get_subscription("I-SANDBOX")
    assert details.called
    assert subscription.plan_id == "plan-id"


@respx.mock
async def test_paypal_response_error_preserves_status_and_issue_codes() -> None:
    respx.post("https://api-m.sandbox.paypal.com/v1/oauth2/token").mock(
        return_value=httpx.Response(200, json={"access_token": "sandbox-token"})
    )
    respx.post(
        "https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-PENDING/cancel"
    ).mock(
        return_value=httpx.Response(
            422,
            json={
                "name": "UNPROCESSABLE_ENTITY",
                "details": [{"issue": "SUBSCRIPTION_STATUS_INVALID"}],
            },
        )
    )
    gateway = PayPalBillingGateway(
        Settings(
            _env_file=None,
            environment="test",
            billing_mode="paypal_sandbox",
            paypal_client_id="client-id",
            paypal_client_secret="client-secret",
            paypal_webhook_id="webhook-id",
            paypal_plan_id="plan-id",
            paypal_merchant_id="merchant-id",
        )
    )

    with pytest.raises(BillingProviderResponseError) as raised:
        await gateway.cancel_subscription("I-PENDING", request_id="request-id")

    assert raised.value.status_code == 422
    assert raised.value.issue_codes == frozenset({"SUBSCRIPTION_STATUS_INVALID"})
    assert raised.value.uncertain is False
