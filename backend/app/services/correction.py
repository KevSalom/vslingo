"""Writing correction orchestration."""

import logging
from dataclasses import dataclass

from pydantic import ValidationError

from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.ports import CorrectionProviderPort
from app.domain.writing import (
    MAX_CORRECTION_TEXT_LENGTH,
    CorrectionResult,
    WritingInputError,
    WritingInputErrorCode,
)

MAX_CORRECTION_ATTEMPTS = 2
_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class CorrectionService:
    """Validate one text and delegate its structured correction."""

    provider: CorrectionProviderPort

    async def correct(self, text: str) -> CorrectionResult:
        """Return a consistent correction or a typed input/provider error."""

        if not text.strip():
            raise WritingInputError(WritingInputErrorCode.EMPTY_TEXT)
        if len(text) > MAX_CORRECTION_TEXT_LENGTH:
            raise WritingInputError(WritingInputErrorCode.TEXT_TOO_LONG)

        canonical_text = text.rstrip("\r\n")

        for attempt in range(1, MAX_CORRECTION_ATTEMPTS + 1):
            try:
                result = await self.provider.correct(canonical_text)
            except IntegrationError as error:
                if error.code != IntegrationErrorCode.INVALID_RESPONSE:
                    raise
                _log_invalid_response(error, attempt=attempt)
                if attempt == MAX_CORRECTION_ATTEMPTS:
                    raise
                continue

            if result.original_text == canonical_text:
                return result

            mismatch_error = IntegrationError(
                "writing_correction",
                IntegrationErrorCode.INVALID_RESPONSE,
                "The correction provider changed the submitted original text.",
            )
            _log_invalid_response(
                mismatch_error,
                attempt=attempt,
                cause_type="OriginalTextMismatch",
            )
            if attempt == MAX_CORRECTION_ATTEMPTS:
                raise mismatch_error

        raise RuntimeError("The correction retry loop ended unexpectedly.")


def _log_invalid_response(
    error: IntegrationError,
    *,
    attempt: int,
    cause_type: str | None = None,
) -> None:
    """Log only structural diagnostics that cannot contain submitted content."""

    cause = error.__cause__
    validation_errors: list[dict[str, object]] = []
    if isinstance(cause, ValidationError):
        validation_errors = [
            {"type": detail["type"], "loc": detail["loc"]}
            for detail in cause.errors(include_input=False, include_url=False)
        ]

    _LOGGER.warning(
        "Writing correction provider returned invalid structured data.",
        extra={
            "provider": error.provider,
            "code": error.code.value,
            "attempt": attempt,
            "cause_type": cause_type
            or (type(cause).__name__ if cause is not None else type(error).__name__),
            "validation_errors": validation_errors,
        },
    )
