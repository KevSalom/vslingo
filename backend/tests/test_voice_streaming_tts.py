"""Latency-oriented tests for sentence-level Voice TTS streaming."""

import asyncio
from collections.abc import AsyncIterator, Sequence

import pytest

from app.domain.models import ChatMessage, SynthesizedSpeech
from app.domain.speech import SpeechRequest
from app.providers.fakes import FakeSpeechToText
from app.voice.session import VoiceSession


class GatedLanguageModel:
    """Keep the stream open after yielding one confirmed sentence."""

    def __init__(self) -> None:
        self.release_second_sentence = asyncio.Event()

    async def stream_chat(self, messages: Sequence[ChatMessage]) -> AsyncIterator[str]:
        assert messages
        yield "That is good progress. "
        await self.release_second_sentence.wait()
        yield "What will you work on next?"


class ObservedSpeechService:
    def __init__(self) -> None:
        self.first_synthesis_started = asyncio.Event()
        self.texts: list[str] = []

    async def synthesize(self, request: SpeechRequest) -> SynthesizedSpeech:
        self.texts.append(request.text)
        self.first_synthesis_started.set()
        return SynthesizedSpeech(audio=b"ID3-early-audio")


class StubWebSocket:
    async def close(self, code: int = 1000) -> None:
        del code


@pytest.mark.asyncio
async def test_first_sentence_reaches_tts_before_llm_stream_finishes() -> None:
    llm = GatedLanguageModel()
    speech = ObservedSpeechService()
    session = VoiceSession(
        StubWebSocket(),  # type: ignore[arg-type]
        FakeSpeechToText(),
        llm_provider=llm,
        speech_service=speech,
    )
    session.current_generation = 1
    session.active_turn_id = "turn-1"

    conversation = asyncio.create_task(
        session._process_conversation(
            "turn-1",
            1,
            "I finished the API.",
            "daily_standup",
            "aws_polly",
        )
    )
    try:
        await asyncio.wait_for(speech.first_synthesis_started.wait(), timeout=1)
        assert conversation.done() is False
        assert speech.texts == ["That is good progress."]
    finally:
        llm.release_second_sentence.set()
        await conversation
        await session._cleanup()
