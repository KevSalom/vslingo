"""Normalized errors exposed by provider integrations."""

from enum import StrEnum


class IntegrationErrorCode(StrEnum):
    """Stable error categories shared by all provider adapters."""

    NOT_CONFIGURED = "not_configured"
    INVALID_REQUEST = "invalid_request"
    TIMEOUT = "timeout"
    UNAVAILABLE = "unavailable"
    INVALID_RESPONSE = "invalid_response"


class IntegrationError(RuntimeError):
    """A provider failure that is safe to surface without leaking secrets."""

    def __init__(self, provider: str, code: IntegrationErrorCode, message: str) -> None:
        self.provider = provider
        self.code = code
        super().__init__(message)
