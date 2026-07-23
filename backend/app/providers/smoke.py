"""Explicit live smoke checks for provider integration boundaries.

This module is never imported by the normal test suite. Run one provider at a
 time through ``uv run vslingo-smoke`` only when credentials and cost approval
are available.
"""

import argparse
import asyncio
import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Final

import boto3
import edge_tts
import httpx
from botocore.config import Config
from botocore.exceptions import ConnectTimeoutError, ReadTimeoutError
from pydantic import SecretStr

from app.core.config import Settings
from app.domain.errors import IntegrationError, IntegrationErrorCode

SAMPLE_TEXT: Final = "VSLingo provider smoke check."


def _required_secret(
    settings_value: SecretStr | None, *, provider: str, name: str
) -> str:
    if settings_value is None:
        raise IntegrationError(
            provider,
            IntegrationErrorCode.NOT_CONFIGURED,
            f"{name} is required for this smoke check.",
        )
    value = str(settings_value.get_secret_value()).strip()
    if not value:
        raise IntegrationError(
            provider,
            IntegrationErrorCode.NOT_CONFIGURED,
            f"{name} is required for this smoke check.",
        )
    return value


def _chat_content(payload: object) -> str:
    """Extract one usable OpenRouter chat delta or reject an error event."""

    if not isinstance(payload, dict):
        return ""
    if payload.get("error") is not None:
        raise IntegrationError(
            "openrouter_chat",
            IntegrationErrorCode.UNAVAILABLE,
            "OpenRouter chat returned an error event.",
        )
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    choice = choices[0]
    if not isinstance(choice, dict):
        return ""
    delta = choice.get("delta")
    if not isinstance(delta, dict):
        return ""
    content = delta.get("content")
    return content if isinstance(content, str) else ""


async def smoke_openrouter_stt(settings: Settings, audio_path: Path) -> None:
    """Upload one local sample and verify OpenRouter returns transcript text."""

    api_key = _required_secret(
        settings.openrouter_api_key,
        provider="openrouter_stt",
        name="OPENROUTER_API_KEY",
    )
    try:
        audio = await asyncio.to_thread(audio_path.read_bytes)
    except OSError as exc:
        raise IntegrationError(
            "openrouter_stt",
            IntegrationErrorCode.INVALID_REQUEST,
            "The --audio path must point to a readable sample file.",
        ) from exc
    if not audio:
        raise IntegrationError(
            "openrouter_stt",
            IntegrationErrorCode.INVALID_REQUEST,
            "The --audio sample must not be empty.",
        )

    url = f"{str(settings.openrouter_base_url).rstrip('/')}/audio/transcriptions"
    try:
        async with httpx.AsyncClient(timeout=settings.provider_timeout_seconds) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                data={"model": settings.openrouter_stt_model},
                files={"file": (audio_path.name, audio, "audio/wav")},
            )
            response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise IntegrationError(
            "openrouter_stt", IntegrationErrorCode.TIMEOUT, "OpenRouter STT timed out."
        ) from exc
    except httpx.HTTPError as exc:
        raise IntegrationError(
            "openrouter_stt",
            IntegrationErrorCode.UNAVAILABLE,
            "OpenRouter STT request failed.",
        ) from exc

    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        raise IntegrationError(
            "openrouter_stt",
            IntegrationErrorCode.INVALID_RESPONSE,
            "OpenRouter STT returned invalid JSON.",
        ) from exc
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise IntegrationError(
            "openrouter_stt",
            IntegrationErrorCode.INVALID_RESPONSE,
            "OpenRouter STT returned no usable transcript text.",
        )


async def smoke_openrouter_chat(settings: Settings) -> None:
    """Verify that OpenRouter emits at least one usable streaming chat delta."""

    api_key = _required_secret(
        settings.openrouter_api_key,
        provider="openrouter_chat",
        name="OPENROUTER_API_KEY",
    )
    if not settings.openrouter_llm_model.strip():
        raise IntegrationError(
            "openrouter_chat",
            IntegrationErrorCode.NOT_CONFIGURED,
            "OPENROUTER_LLM_MODEL is required for this smoke check.",
        )

    url = f"{str(settings.openrouter_base_url).rstrip('/')}/chat/completions"
    content_size = 0
    try:
        async with (
            httpx.AsyncClient(timeout=settings.provider_timeout_seconds) as client,
            client.stream(
                "POST",
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.openrouter_llm_model,
                    "messages": [{"role": "user", "content": "Reply with: ready"}],
                    "stream": True,
                },
            ) as response,
        ):
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: ") and line != "data: [DONE]":
                    payload: object = json.loads(line.removeprefix("data: "))
                    content_size += len(_chat_content(payload))
    except httpx.TimeoutException as exc:
        raise IntegrationError(
            "openrouter_chat", IntegrationErrorCode.TIMEOUT, "OpenRouter chat timed out."
        ) from exc
    except json.JSONDecodeError as exc:
        raise IntegrationError(
            "openrouter_chat",
            IntegrationErrorCode.INVALID_RESPONSE,
            "OpenRouter chat returned invalid JSON.",
        ) from exc
    except httpx.HTTPError as exc:
        raise IntegrationError(
            "openrouter_chat",
            IntegrationErrorCode.UNAVAILABLE,
            "OpenRouter chat stream failed.",
        ) from exc

    if content_size == 0:
        raise IntegrationError(
            "openrouter_chat",
            IntegrationErrorCode.INVALID_RESPONSE,
            "OpenRouter chat returned no usable streaming text.",
        )


async def smoke_aws_polly(settings: Settings) -> None:
    """Synthesize a short in-memory MP3 with AWS Polly Neural."""

    access_key = _required_secret(
        settings.aws_access_key_id,
        provider="aws_polly",
        name="AWS_ACCESS_KEY_ID",
    )
    secret_key = _required_secret(
        settings.aws_secret_access_key,
        provider="aws_polly",
        name="AWS_SECRET_ACCESS_KEY",
    )
    try:
        client = boto3.client(
            "polly",
            region_name=settings.aws_region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(
                connect_timeout=settings.provider_timeout_seconds,
                read_timeout=settings.provider_timeout_seconds,
                retries={"max_attempts": 0, "mode": "standard"},
            ),
        )
    except Exception as exc:
        raise IntegrationError(
            "aws_polly",
            IntegrationErrorCode.NOT_CONFIGURED,
            "AWS Polly client configuration failed.",
        ) from exc

    audio = b""
    try:
        response = await asyncio.to_thread(
            client.synthesize_speech,
            Text=SAMPLE_TEXT,
            OutputFormat="mp3",
            VoiceId=settings.aws_polly_voice_id,
            Engine="neural",
        )
        audio_stream = response.get("AudioStream")
        if audio_stream is None:
            raise IntegrationError(
                "aws_polly",
                IntegrationErrorCode.INVALID_RESPONSE,
                "AWS Polly returned no audio stream.",
            )
        try:
            audio = await asyncio.to_thread(audio_stream.read)
        finally:
            audio_stream.close()
    except (ConnectTimeoutError, ReadTimeoutError) as exc:
        raise IntegrationError(
            "aws_polly", IntegrationErrorCode.TIMEOUT, "AWS Polly timed out."
        ) from exc
    except IntegrationError:
        raise
    except Exception as exc:
        raise IntegrationError(
            "aws_polly", IntegrationErrorCode.UNAVAILABLE, "AWS Polly request failed."
        ) from exc
    finally:
        client.close()

    if not audio:
        raise IntegrationError(
            "aws_polly",
            IntegrationErrorCode.INVALID_RESPONSE,
            "AWS Polly returned empty audio.",
        )


async def smoke_edge_tts(settings: Settings) -> None:
    """Synthesize a short in-memory MP3 with Microsoft Edge Neural."""

    if not settings.edge_tts_configured:
        raise IntegrationError(
            "edge_tts",
            IntegrationErrorCode.NOT_CONFIGURED,
            "EDGE_TTS_VOICE is required for this smoke check.",
        )

    audio_size = 0
    try:
        communicate = edge_tts.Communicate(SAMPLE_TEXT, settings.edge_tts_voice)
        async with asyncio.timeout(settings.provider_timeout_seconds):
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio":
                    data = chunk.get("data")
                    if isinstance(data, bytes):
                        audio_size += len(data)
    except TimeoutError as exc:
        raise IntegrationError(
            "edge_tts", IntegrationErrorCode.TIMEOUT, "Microsoft Edge Neural timed out."
        ) from exc
    except Exception as exc:
        raise IntegrationError(
            "edge_tts",
            IntegrationErrorCode.UNAVAILABLE,
            "Microsoft Edge Neural request failed.",
        ) from exc

    if audio_size == 0:
        raise IntegrationError(
            "edge_tts",
            IntegrationErrorCode.INVALID_RESPONSE,
            "Microsoft Edge Neural returned empty audio.",
        )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run one explicit VSLingo live provider smoke check."
    )
    parser.add_argument(
        "provider",
        choices=("openrouter-stt", "openrouter-chat", "aws-polly", "edge-tts"),
    )
    parser.add_argument(
        "--audio",
        type=Path,
        help="Local WAV sample required only by the openrouter-stt smoke.",
    )
    return parser


async def _run(provider: str, audio: Path | None, settings: Settings) -> None:
    checks: dict[str, Callable[[], Awaitable[None]]] = {
        "openrouter-chat": lambda: smoke_openrouter_chat(settings),
        "aws-polly": lambda: smoke_aws_polly(settings),
        "edge-tts": lambda: smoke_edge_tts(settings),
    }
    if provider == "openrouter-stt":
        if audio is None:
            raise IntegrationError(
                provider,
                IntegrationErrorCode.INVALID_REQUEST,
                "--audio is required for the openrouter-stt smoke.",
            )
        await smoke_openrouter_stt(settings, audio)
        return
    await checks[provider]()


def main() -> None:
    """CLI entrypoint that runs exactly one explicitly selected live check."""

    args = _build_parser().parse_args()
    try:
        asyncio.run(_run(str(args.provider), args.audio, Settings()))
    except IntegrationError as exc:
        raise SystemExit(f"{exc.provider}:{exc.code}: {exc}") from exc
    print(f"{args.provider}: ok")


if __name__ == "__main__":
    main()
