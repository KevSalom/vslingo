"""OpenRouter adapter for streaming chat responses (T06)."""

import json
from collections.abc import AsyncIterator, Sequence

import httpx

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.models import ChatMessage


class OpenRouterChatLanguageModel:
    """Stream chat completion chunks from OpenRouter."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _api_key(self) -> str:
        if not self._settings.openrouter_api_key:
            raise IntegrationError(
                "openrouter_chat",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OPENROUTER_API_KEY is required for chat streaming.",
            )
        api_key = self._settings.openrouter_api_key.get_secret_value().strip()
        if not api_key:
            raise IntegrationError(
                "openrouter_chat",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OPENROUTER_API_KEY is required for chat streaming.",
            )
        return api_key

    async def stream_chat(self, messages: Sequence[ChatMessage]) -> AsyncIterator[str]:
        """Stream chunks, capping total response at 600 characters."""
        api_key = self._api_key()
        model = self._settings.openrouter_llm_model.strip()
        if not model:
            raise IntegrationError(
                "openrouter_chat",
                IntegrationErrorCode.NOT_CONFIGURED,
                "OPENROUTER_LLM_MODEL is required for chat streaming.",
            )

        url = f"{str(self._settings.openrouter_base_url).rstrip('/')}/chat/completions"
        request_payload = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "temperature": 0.7,
            "max_tokens": 300,
        }

        accumulated_len = 0
        max_allowed = 600

        try:
            async with httpx.AsyncClient(  # noqa: SIM117
                timeout=self._settings.provider_timeout_seconds
            ) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=request_payload,
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line or not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break
                        try:
                            payload = json.loads(data_str)
                            choices = payload.get("choices", [])
                            if not choices:
                                continue
                            delta_obj = choices[0].get("delta", {})
                            content = delta_obj.get("content")
                            if content:
                                # Check length limit
                                remaining = max_allowed - accumulated_len
                                if remaining <= 0:
                                    break
                                if len(content) > remaining:
                                    content = content[:remaining]
                                    accumulated_len += len(content)
                                    yield content
                                    break
                                accumulated_len += len(content)
                                yield content
                        except json.JSONDecodeError:
                            continue
        except httpx.TimeoutException as exc:
            raise IntegrationError(
                "openrouter_chat",
                IntegrationErrorCode.TIMEOUT,
                "Chat streaming timed out.",
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise IntegrationError(
                "openrouter_chat",
                IntegrationErrorCode.UNAVAILABLE,
                f"OpenRouter chat stream returned status {exc.response.status_code}.",
            ) from exc
        except Exception as exc:
            if isinstance(exc, IntegrationError):
                raise
            raise IntegrationError(
                "openrouter_chat",
                IntegrationErrorCode.UNAVAILABLE,
                f"OpenRouter chat stream failed: {exc}",
            ) from exc
