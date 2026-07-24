"""Safe structured operational telemetry with an explicit metadata allowlist."""

import json
import logging
from math import isfinite
from typing import Final

LOGGER = logging.getLogger("vslingo.telemetry")
_ALLOWED_FIELDS: Final = frozenset(
    {
        "event",
        "session_id",
        "turn_id",
        "generation",
        "stage",
        "latency_ms",
        "provider",
        "error_code",
        "status_code",
        "usage_seconds",
        "usage_tokens",
        "cost_usd",
        "estimated",
    }
)


def log_operational_event(**fields: object) -> None:
    """Emit only finite primitive telemetry fields; never log user/provider content."""

    safe: dict[str, object] = {}
    for key, value in fields.items():
        if key not in _ALLOWED_FIELDS or not _is_safe_value(value):
            continue
        safe[key] = value
    LOGGER.info("telemetry=%s", json.dumps(safe, separators=(",", ":"), sort_keys=True))


def _is_safe_value(value: object) -> bool:
    if value is None or isinstance(value, (str, bool, int)):
        return True
    return isinstance(value, float) and isfinite(value)


def safe_error_code(error: object) -> str:
    """Return a stable exception type marker rather than an exception message."""

    return type(error).__name__
