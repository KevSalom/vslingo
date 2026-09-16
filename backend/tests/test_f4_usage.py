from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.product import ProductConfig
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.main import create_app
from app.persistence.database import Database
from app.persistence.identity import IdentityRepository
from app.persistence.usage import (
    QuotaExhaustedError,
    UsageAccessExpiredError,
    UsageRepository,
)
from app.providers.fakes import FakeCorrectionProvider, FakeTranscriptProvider
from app.services.correction import CorrectionService
from app.services.video import VideoService

AUTH = {"Authorization": "Bearer dev-session-token"}


def _usage(tmp_path: Path, **settings_overrides: object) -> tuple[Database, UsageRepository]:
    database = Database(tmp_path / "usage.db")
    database.migrate()
    IdentityRepository(database).ensure_user("user_development")
    settings = Settings(_env_file=None, environment="test", **settings_overrides)
    return database, UsageRepository(database, ProductConfig.from_settings(settings))


def test_public_plan_and_authenticated_trial_snapshot(tmp_path: Path) -> None:
    path = tmp_path / "api.db"
    client = TestClient(
        create_app(
            Settings(_env_file=None, environment="test", database_path=path),
            database=Database(path),
        )
    )

    plan = client.get("/api/plan")
    assert plan.status_code == 200
    assert plan.json()["price_minor"] == 299
    assert plan.json()["trial"] == {
        "voice_seconds": 600,
        "voice_turns": 30,
        "writings": 10,
        "videos": 3,
    }
    assert client.get("/api/account/quota").status_code == 401
    quota = client.get("/api/account/quota", headers=AUTH)
    assert quota.status_code == 200
    assert quota.json()["remaining"] == plan.json()["trial"]


def test_two_tabs_cannot_reserve_the_last_writing_credit_twice(tmp_path: Path) -> None:
    _database, usage = _usage(tmp_path, trial_writings=1)

    def reserve(operation_id: str) -> str:
        try:
            usage.reserve("user_development", operation_id, "writing")
        except QuotaExhaustedError:
            return "exhausted"
        return "reserved"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(reserve, ("tab-a", "tab-b")))

    assert sorted(results) == ["exhausted", "reserved"]
    assert usage.quota("user_development")["reserved"]["writings"] == 1


def test_writing_endpoint_replays_then_exposes_exhausted_balance(tmp_path: Path) -> None:
    path = tmp_path / "writing-api.db"
    client = TestClient(
        create_app(
            Settings(
                _env_file=None,
                environment="test",
                database_path=path,
                trial_writings=1,
            ),
            database=Database(path),
            correction_service=CorrectionService(FakeCorrectionProvider()),
        ),
        headers=AUTH,
    )
    payload = {"text": "This is correct.", "operation_id": "writing-api-a"}

    assert client.post("/api/writing/correct", json=payload).status_code == 200
    assert client.post("/api/writing/correct", json=payload).status_code == 200
    exhausted = client.post(
        "/api/writing/correct",
        json={"text": "Another text.", "operation_id": "writing-api-b"},
    )

    assert exhausted.status_code == 402
    assert exhausted.json()["error"]["code"] == "quota_exhausted"
    assert client.get("/api/account/quota").json()["used"]["writings"] == 1


def test_known_provider_failure_releases_reserved_credit(tmp_path: Path) -> None:
    path = tmp_path / "released-api.db"
    provider = FakeCorrectionProvider(
        error=IntegrationError(
            "fake", IntegrationErrorCode.TIMEOUT, "synthetic timeout"
        )
    )
    client = TestClient(
        create_app(
            Settings(
                _env_file=None,
                environment="test",
                database_path=path,
                trial_writings=1,
            ),
            database=Database(path),
            correction_service=CorrectionService(provider),
        ),
        headers=AUTH,
    )

    failed = client.post(
        "/api/writing/correct",
        json={"text": "Review this.", "operation_id": "writing-failed"},
    )
    quota = client.get("/api/account/quota").json()

    assert failed.status_code == 504
    assert quota["used"]["writings"] == 0
    assert quota["reserved"]["writings"] == 0
    assert quota["remaining"]["writings"] == 1


def test_result_replay_is_idempotent_and_does_not_consume_twice(tmp_path: Path) -> None:
    database, usage = _usage(tmp_path)
    result = {
        "original_text": "It works.",
        "corrected_text": "It works.",
        "has_corrections": False,
        "corrections": [],
        "general_feedback": "Correcto.",
    }
    usage.reserve("user_development", "writing-a", "writing")
    usage.mark_provider_started("user_development", "writing-a")
    usage.persist_result(
        "user_development", "writing-a", result, actual_primary=1
    )
    usage.settle("user_development", "writing-a")

    replay = usage.reserve("user_development", "writing-a", "writing")

    assert replay.result == result
    assert usage.quota("user_development")["used"]["writings"] == 1
    assert database.query_one(
        "SELECT result_json FROM usage_operation_results"
    )["result_json"] is not None
    operation_columns = database.query_all("PRAGMA table_info(usage_operations)")
    assert "result_json" not in {row["name"] for row in operation_columns}


def test_video_resource_claim_prevents_a_second_charge(tmp_path: Path) -> None:
    _database, usage = _usage(tmp_path)
    result = {
        "video_id": "aircAruvnKk",
        "source": "youtube",
        "segments": [{"text": "Patterns.", "start": 0, "duration": 1}],
    }
    usage.reserve(
        "user_development", "video-a", "video", resource_key="aircAruvnKk"
    )
    usage.mark_provider_started("user_development", "video-a")
    usage.persist_result("user_development", "video-a", result, actual_primary=1)
    usage.settle("user_development", "video-a")

    replay = usage.reserve(
        "user_development", "video-b", "video", resource_key="aircAruvnKk"
    )

    assert replay.result == result
    assert usage.quota("user_development")["used"]["videos"] == 1


def test_video_endpoint_reuses_first_result_for_the_same_video(tmp_path: Path) -> None:
    path = tmp_path / "video-api.db"
    provider = FakeTranscriptProvider()
    client = TestClient(
        create_app(
            Settings(_env_file=None, environment="test", database_path=path),
            database=Database(path),
            video_service=VideoService(provider),
        ),
        headers=AUTH,
    )
    url = "https://www.youtube.com/watch?v=aircAruvnKk"

    first = client.post(
        "/api/video/transcript", json={"url": url, "operation_id": "video-api-a"}
    )
    second = client.post(
        "/api/video/transcript", json={"url": url, "operation_id": "video-api-b"}
    )

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert provider.calls == ["aircAruvnKk"]
    assert client.get("/api/account/quota").json()["used"]["videos"] == 1


def test_limit_snapshot_is_not_reduced_by_new_configuration(tmp_path: Path) -> None:
    database, initial = _usage(tmp_path, trial_writings=10)
    assert initial.quota("user_development")["limits"]["writings"] == 10

    reduced = UsageRepository(
        database,
        ProductConfig.from_settings(
            Settings(_env_file=None, environment="test", trial_writings=1)
        ),
    )

    assert reduced.quota("user_development")["limits"]["writings"] == 10
    assert database.query_one("SELECT count(*) AS count FROM trial_grants")["count"] == 1


def test_an_ended_period_never_reactivates_the_one_time_trial(tmp_path: Path) -> None:
    database, usage = _usage(tmp_path)
    period_id = usage.quota("user_development")["period_id"]
    with database.transaction(immediate=True) as connection:
        connection.execute(
            "UPDATE usage_periods SET status = 'ended' WHERE id = ?", (period_id,)
        )

    with pytest.raises(UsageAccessExpiredError):
        usage.quota("user_development")
    assert database.query_one("SELECT count(*) AS count FROM usage_periods")["count"] == 1


def test_restart_reconciles_only_safe_operation_states(tmp_path: Path) -> None:
    _database, usage = _usage(tmp_path)
    usage.reserve("user_development", "abandoned", "writing")
    usage.reserve("user_development", "uncertain", "writing")
    usage.mark_provider_started("user_development", "uncertain")
    usage.reserve("user_development", "persisted", "writing")
    usage.mark_provider_started("user_development", "persisted")
    usage.persist_result(
        "user_development",
        "persisted",
        {"saved": True},
        actual_primary=1,
    )

    recovered = usage.reconcile_after_restart()
    quota = usage.quota("user_development")

    assert recovered == {"settled": 1, "released": 1, "uncertain": 1}
    assert quota["used"]["writings"] == 1
    assert quota["reserved"]["writings"] == 1


def test_provider_cost_is_recorded_in_integer_micro_dollars(tmp_path: Path) -> None:
    database, usage = _usage(tmp_path)
    usage.reserve("user_development", "cost-a", "writing")
    usage.add_cost_usd("user_development", "cost-a", 0.0001234)

    operation = database.query_one(
        "SELECT cost_micro_usd FROM usage_operations WHERE operation_id = 'cost-a'"
    )
    assert operation is not None
    assert operation["cost_micro_usd"] == 123


def test_trial_limits_must_be_positive() -> None:
    with pytest.raises(ValueError):
        Settings(_env_file=None, environment="test", trial_writings=0)
