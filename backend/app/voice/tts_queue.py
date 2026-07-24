"""TTS Queue and Consumer for synthesizing sentence segments in order per session."""

import asyncio
import contextlib
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from app.domain.speech import SpeechProvider, SpeechRequest, SpeechServiceError
from app.domain.voice_protocol import (
    AudioBeginMessage,
    AudioEndMessage,
    ErrorMessage,
    SpeechProviderType,
)

MAX_AUDIO_SEGMENT_BYTES = 2_000_000


@dataclass(frozen=True)
class TTSSegmentItem:
    turn_id: str
    generation: int
    segment_index: int
    text: str
    provider: SpeechProviderType
    segment_id: str = field(default_factory=lambda: str(uuid.uuid4()))


class TTSConsumer:
    """Synthesize queued sentences in order and discard every obsolete result."""

    def __init__(
        self,
        speech_service: Any,
        outbound_writer: Callable[[str | bytes], Awaitable[None]],
        max_queue_size: int = 8,
        outbound_audio_writer: Callable[[str, bytes, str], Awaitable[None]] | None = None,
    ) -> None:
        self._speech_service = speech_service
        self._outbound_writer = outbound_writer
        self._outbound_audio_writer = outbound_audio_writer
        self._queue: asyncio.Queue[TTSSegmentItem] = asyncio.Queue(maxsize=max_queue_size)
        self._consumer_task: asyncio.Task[None] | None = None
        self._active_synthesis_task: asyncio.Task[Any] | None = None
        self._active_item: TTSSegmentItem | None = None
        self._cancelled_generations: set[int] = set()

    def start(self) -> None:
        if self._consumer_task is None or self._consumer_task.done():
            self._consumer_task = asyncio.create_task(self._consume_loop())

    async def stop(self) -> None:
        if self._active_synthesis_task and not self._active_synthesis_task.done():
            self._active_synthesis_task.cancel()
        if self._consumer_task and not self._consumer_task.done():
            self._consumer_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._consumer_task
        self.clear()

    def mark_generation_cancelled(self, generation: int) -> None:
        self._cancelled_generations.add(generation)
        if (
            self._active_item is not None
            and self._active_item.generation == generation
            and self._active_synthesis_task is not None
            and not self._active_synthesis_task.done()
        ):
            self._active_synthesis_task.cancel()
        self.clear_generation(generation)

    def clear_generation(self, generation: int) -> None:
        retained: list[TTSSegmentItem] = []
        while True:
            try:
                item = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            self._queue.task_done()
            if item.generation != generation:
                retained.append(item)
        for item in retained:
            self._queue.put_nowait(item)

    def clear(self) -> None:
        while True:
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            self._queue.task_done()

    async def enqueue(self, item: TTSSegmentItem, active_generation: int) -> bool:
        if item.generation in self._cancelled_generations or item.generation != active_generation:
            return False
        await self._queue.put(item)
        return item.generation not in self._cancelled_generations

    async def _write_audio_frame(
        self, begin_message: str, audio_bytes: bytes, end_message: str
    ) -> None:
        if self._outbound_audio_writer is not None:
            await self._outbound_audio_writer(begin_message, audio_bytes, end_message)
            return
        await self._outbound_writer(begin_message)
        await self._outbound_writer(audio_bytes)
        await self._outbound_writer(end_message)

    async def _write_failure(
        self,
        item: TTSSegmentItem,
        *,
        retryable: bool,
        message: str,
    ) -> None:
        error = ErrorMessage(
            code="speech_unavailable",
            message=message,
            retryable=retryable,
            fatal=False,
            turn_id=item.turn_id,
            generation=item.generation,
        )
        await self._outbound_writer(error.model_dump_json())

    async def _consume_loop(self) -> None:
        failed_generations: set[int] = set()

        while True:
            item = await self._queue.get()
            try:
                if (
                    item.generation in self._cancelled_generations
                    or item.generation in failed_generations
                ):
                    continue

                try:
                    request = SpeechRequest(
                        text=item.text,
                        provider=SpeechProvider(item.provider),
                    )
                    self._active_item = item
                    self._active_synthesis_task = asyncio.create_task(
                        self._speech_service.synthesize(request)
                    )
                    result = await self._active_synthesis_task
                    audio_bytes = result.audio
                except asyncio.CancelledError:
                    if item.generation in self._cancelled_generations:
                        continue
                    raise
                except SpeechServiceError as exc:
                    failed_generations.add(item.generation)
                    await self._write_failure(
                        item,
                        retryable=exc.retryable,
                        message="La síntesis de voz no está disponible para esta respuesta.",
                    )
                    continue
                except Exception:
                    failed_generations.add(item.generation)
                    await self._write_failure(
                        item,
                        retryable=True,
                        message="La síntesis de voz no está disponible para esta respuesta.",
                    )
                    continue
                finally:
                    self._active_item = None
                    self._active_synthesis_task = None

                if item.generation in self._cancelled_generations:
                    continue
                if not audio_bytes or len(audio_bytes) > MAX_AUDIO_SEGMENT_BYTES:
                    failed_generations.add(item.generation)
                    await self._write_failure(
                        item,
                        retryable=True,
                        message="El proveedor devolvió un segmento de audio inválido.",
                    )
                    continue

                begin = AudioBeginMessage(
                    turn_id=item.turn_id,
                    generation=item.generation,
                    segment_id=item.segment_id,
                    segment_index=item.segment_index,
                    media_type="audio/mpeg",
                    byte_length=len(audio_bytes),
                )
                end = AudioEndMessage(
                    turn_id=item.turn_id,
                    generation=item.generation,
                    segment_id=item.segment_id,
                    segment_index=item.segment_index,
                )
                await self._write_audio_frame(
                    begin.model_dump_json(),
                    audio_bytes,
                    end.model_dump_json(),
                )
            finally:
                self._queue.task_done()
