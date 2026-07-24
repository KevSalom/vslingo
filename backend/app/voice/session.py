"""VoiceSession handling WebSocket v1 lifecycle, actor tasks, and T06 conversation/feedback."""

import asyncio
import json
import logging
import struct
from collections.abc import AsyncIterator, Callable
from time import monotonic
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.core.config import Settings
from app.core.observability import log_operational_event, safe_error_code
from app.core.protection import ProviderBusyError, ProviderGates
from app.domain.errors import IntegrationError, IntegrationErrorCode
from app.domain.history import ConversationHistory
from app.domain.models import ChatMessage, ProviderUsage
from app.domain.ports import LanguageModelPort, SpeechToTextPort, VoiceFeedbackPort
from app.domain.voice_protocol import (
    MetricsStageMessage,
    ScenarioType,
    SpeechProviderType,
    UtteranceBeginMessage,
    client_adapter,
)
from app.prompts.voice import get_voice_system_prompt
from app.voice.accumulator import SentenceAccumulator
from app.voice.tts_queue import TTSConsumer, TTSSegmentItem

logger = logging.getLogger(__name__)

# WAV header constants for 16kHz Mono 16-bit PCM
WAV_FORMAT_PCM = 1
WAV_CHANNELS_MONO = 1
WAV_SAMPLE_RATE_16K = 16000
WAV_BITS_PER_SAMPLE_16 = 16


def validate_wav_pcm_16k_mono(audio_bytes: bytes) -> bool:
    """Validate that audio_bytes is a valid RIFF/WAVE PCM 16-bit 16kHz mono audio file."""
    if len(audio_bytes) < 44:
        return False
    if not audio_bytes.startswith(b"RIFF") or audio_bytes[8:12] != b"WAVE":
        return False

    offset = 12
    fmt_found = False
    data_found = False

    while offset + 8 <= len(audio_bytes):
        chunk_id = audio_bytes[offset : offset + 4]
        chunk_size = struct.unpack("<I", audio_bytes[offset + 4 : offset + 8])[0]

        if chunk_id == b"fmt ":
            if chunk_size < 16 or offset + 8 + 16 > len(audio_bytes):
                return False
            fmt_data = audio_bytes[offset + 8 : offset + 24]
            audio_format, channels, sample_rate, _, _, bits_per_sample = struct.unpack(
                "<HHIIHH", fmt_data
            )
            if (
                audio_format != WAV_FORMAT_PCM
                or channels != WAV_CHANNELS_MONO
                or sample_rate != WAV_SAMPLE_RATE_16K
                or bits_per_sample != WAV_BITS_PER_SAMPLE_16
            ):
                return False
            fmt_found = True
        elif chunk_id == b"data":
            data_found = True
            break

        offset += 8 + chunk_size
        if chunk_size % 2 == 1:
            offset += 1

    return fmt_found and data_found


class VoiceSession:
    """Manages actor-like lifecycle for a single WebSocket Voice connection."""

    def __init__(
        self,
        websocket: WebSocket,
        stt_provider: SpeechToTextPort,
        llm_provider: LanguageModelPort | None = None,
        feedback_provider: VoiceFeedbackPort | None = None,
        speech_service: object | None = None,
        *,
        settings: Settings | None = None,
        gates: ProviderGates | None = None,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self.websocket = websocket
        self.stt_provider = stt_provider
        self.llm_provider = llm_provider
        self.feedback_provider = feedback_provider
        self.speech_service = speech_service
        self.settings = settings or Settings()
        self.gates = gates
        self._clock = clock

        self.session_id = str(uuid4())
        self.current_generation = 0
        self.config_revision = 0
        self.scenario: ScenarioType = "daily_standup"
        self.speech_provider: SpeechProviderType = "aws_polly"
        self.active_turn_id: str | None = None
        self.active_scenario: ScenarioType = self.scenario
        self.active_speech_provider: SpeechProviderType = self.speech_provider
        self.cancelled_turns: set[tuple[str, int]] = set()

        self.history = ConversationHistory()
        self.started = False
        self.ended = False
        self.pending_begin: UtteranceBeginMessage | None = None
        self.begin_timeout_task: asyncio.Task[None] | None = None
        self.active_stt_task: asyncio.Task[None] | None = None
        self.active_generation_tasks: list[asyncio.Task[None]] = []
        self.session_limit_task: asyncio.Task[None] | None = None
        self.turn_count = 0
        self._turn_t0: dict[tuple[str, int], float] = {}
        self._first_audio_segments: dict[tuple[str, int], str] = {}
        self._playback_confirmed: set[tuple[str, int]] = set()
        self._tts_metrics_emitted: set[tuple[str, int]] = set()
        self.session_cost_usd = 0.0
        self.session_cost_estimated = False

        self.outbound_queue: asyncio.Queue[
            str | bytes | tuple[str, bytes, str]
        ] = asyncio.Queue(maxsize=32)
        self.writer_task: asyncio.Task[None] | None = None
        self.tts_consumer: TTSConsumer | None = None
        if self.speech_service is not None:
            self.tts_consumer = TTSConsumer(
                speech_service=self.speech_service,
                outbound_writer=self._enqueue_raw_message,
                outbound_audio_writer=self._enqueue_audio_frame,
                on_audio_ready=self._on_tts_ready,
            )
            self.tts_consumer.start()


    async def run(self) -> None:
        """Main loop managing reader and writer actor tasks."""
        self.writer_task = asyncio.create_task(self._outbound_writer())
        try:
            while True:
                message = await self.websocket.receive()
                message_type = message.get("type")

                if message_type == "websocket.disconnect":
                    break

                if "text" in message and message["text"] is not None:
                    await self._handle_text(message["text"])
                    if self.ended:
                        break
                elif "bytes" in message and message["bytes"] is not None:
                    await self._handle_bytes(message["bytes"])

        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.error("voice_session_failed error_code=%s", safe_error_code(exc))
            await self._send_error(
                code="internal_error",
                message="An internal server error occurred.",
                retryable=True,
                fatal=True,
            )
        finally:
            await self._cleanup()

    def _cancel_generation(self, generation: int) -> None:
        if generation <= 0:
            return
        if self.tts_consumer:
            self.tts_consumer.mark_generation_cancelled(generation)
        for task in self.active_generation_tasks:
            if not task.done():
                task.cancel()
        self.active_generation_tasks.clear()


    async def _handle_text(self, text_data: str) -> None:
        try:
            raw_json = json.loads(text_data)
        except Exception:
            await self._send_error(
                code="invalid_event",
                message="JSON malformado recibido.",
                retryable=False,
                fatal=True,
            )
            return

        try:
            parsed_msg = client_adapter.validate_python(raw_json)
        except ValidationError:
            await self._send_error(
                code="invalid_event",
                message="Estructura o tipo de evento no soportado.",
                retryable=False,
                fatal=False,
            )
            return

        if not self.started:
            if parsed_msg.type == "session.start":
                self.started = True
                self.session_limit_task = asyncio.create_task(self._enforce_session_limit())
                await self._enqueue_message({
                    "type": "session.ready",
                    "protocol_version": 1,
                    "session_id": self.session_id,
                    "generation": self.current_generation,
                })
            else:
                await self._send_error(
                    code="invalid_event",
                    message="session.start debe ser el primer evento de la sesión.",
                    retryable=False,
                    fatal=True,
                )
            return

        if parsed_msg.type == "session.start":
            await self._send_error(
                code="invalid_event",
                message="session.start sólo se permite una vez al inicio.",
                retryable=False,
                fatal=False,
            )
        elif parsed_msg.type == "session.config":
            if self.active_turn_id is not None:
                cancelled_turn = (self.active_turn_id, self.current_generation)
                if self.active_stt_task and not self.active_stt_task.done():
                    self.active_stt_task.cancel()
                self._cancel_generation(self.current_generation)
                if self.begin_timeout_task and not self.begin_timeout_task.done():
                    self.begin_timeout_task.cancel()
                if cancelled_turn not in self.cancelled_turns:
                    self.cancelled_turns.add(cancelled_turn)
                    await self._enqueue_message({
                        "type": "response.cancelled",
                        "turn_id": cancelled_turn[0],
                        "generation": cancelled_turn[1],
                    })
                self.pending_begin = None
                self.active_turn_id = None

            if parsed_msg.scenario != self.scenario:
                self.history.clear()

            self.scenario = parsed_msg.scenario
            self.speech_provider = parsed_msg.speech_provider
            self.config_revision += 1
            await self._enqueue_message({
                "type": "session.configured",
                "scenario": self.scenario,
                "speech_provider": self.speech_provider,
                "config_revision": self.config_revision,
            })

        elif parsed_msg.type == "speech.started":
            if parsed_msg.generation != self.current_generation + 1:
                gen_err_msg = (
                    f"Generación inválida propuesta ({parsed_msg.generation}). "
                    f"Esperada: {self.current_generation + 1}."
                )
                await self._send_error(
                    code="invalid_generation",
                    message=gen_err_msg,
                    retryable=False,
                    fatal=False,
                    turn_id=parsed_msg.turn_id,
                    generation=parsed_msg.generation,
                )
                return

            previous_generation = self.current_generation
            if previous_generation > 0:
                self._cancel_generation(previous_generation)

            self.current_generation = parsed_msg.generation
            self.active_turn_id = parsed_msg.turn_id
            self.active_scenario = self.scenario
            self.active_speech_provider = self.speech_provider
            if self.active_stt_task and not self.active_stt_task.done():
                self.active_stt_task.cancel()

            if self.begin_timeout_task and not self.begin_timeout_task.done():
                self.begin_timeout_task.cancel()
            self.pending_begin = None

        elif parsed_msg.type == "utterance.begin":
            if (
                parsed_msg.generation != self.current_generation
                or parsed_msg.turn_id != self.active_turn_id
            ):
                await self._send_error(
                    code="invalid_generation",
                    message="Generación obsoleta o inconsistente en utterance.begin.",
                    retryable=False,
                    fatal=False,
                    turn_id=parsed_msg.turn_id,
                    generation=parsed_msg.generation,
                )
                return
            if (
                parsed_msg.byte_length > self.settings.max_audio_bytes
                or parsed_msg.duration_ms > self.settings.max_audio_seconds * 1000
            ):
                await self._send_error(
                    code="audio_too_large",
                    message="El audio supera el límite permitido para este turno.",
                    retryable=False,
                    fatal=False,
                    turn_id=parsed_msg.turn_id,
                    generation=parsed_msg.generation,
                )
                return
            if self.turn_count >= self.settings.max_voice_turns:
                await self._close_for_limit(
                    code="turn_limit_reached",
                    message="La sesión alcanzó el máximo de turnos permitido.",
                    turn_id=parsed_msg.turn_id,
                    generation=parsed_msg.generation,
                )
                return

            self.turn_count += 1
            self.pending_begin = parsed_msg
            if self.begin_timeout_task and not self.begin_timeout_task.done():
                self.begin_timeout_task.cancel()
            self.begin_timeout_task = asyncio.create_task(
                self._handle_begin_timeout(parsed_msg.turn_id, parsed_msg.generation)
            )

        elif parsed_msg.type == "response.cancel":
            cancelled_turn = (parsed_msg.turn_id, parsed_msg.generation)
            is_active = (
                parsed_msg.generation == self.current_generation
                and parsed_msg.turn_id == self.active_turn_id
            )
            if is_active:
                if self.pending_begin and self.pending_begin.turn_id == parsed_msg.turn_id:
                    if self.begin_timeout_task and not self.begin_timeout_task.done():
                        self.begin_timeout_task.cancel()
                    self.pending_begin = None

                if self.active_stt_task and not self.active_stt_task.done():
                    self.active_stt_task.cancel()
                self._cancel_generation(parsed_msg.generation)
                self.active_turn_id = None

            if cancelled_turn not in self.cancelled_turns:
                self.cancelled_turns.add(cancelled_turn)
                await self._enqueue_message({
                    "type": "response.cancelled",
                    "turn_id": parsed_msg.turn_id,
                    "generation": parsed_msg.generation,
                })

        elif parsed_msg.type == "playback.started":
            key = (parsed_msg.turn_id, parsed_msg.generation)
            if (
                parsed_msg.generation != self.current_generation
                or parsed_msg.turn_id != self.active_turn_id
                or self._first_audio_segments.get(key) != parsed_msg.segment_id
                or key in self._playback_confirmed
            ):
                await self._send_error(
                    code="invalid_event",
                    message="La confirmación de reproducción no corresponde al audio activo.",
                    retryable=False,
                    fatal=False,
                    turn_id=parsed_msg.turn_id,
                    generation=parsed_msg.generation,
                )
                return
            self._playback_confirmed.add(key)
            await self._emit_metric(
                turn_id=parsed_msg.turn_id,
                generation=parsed_msg.generation,
                stage="playback_started",
                provider=None,
            )

        elif parsed_msg.type == "session.end":
            self.ended = True
            await self.websocket.close(code=1000)

    async def _handle_bytes(self, audio_bytes: bytes) -> None:
        if not self.pending_begin:
            await self._send_error(
                code="invalid_event",
                message="Frame binario recibido sin un utterance.begin previo aceptado.",
                retryable=False,
                fatal=False,
            )
            return

        begin = self.pending_begin
        self.pending_begin = None
        if self.begin_timeout_task and not self.begin_timeout_task.done():
            self.begin_timeout_task.cancel()

        if len(audio_bytes) != begin.byte_length:
            len_err_msg = (
                f"Longitud de audio real ({len(audio_bytes)}) difiere "
                f"de byte_length declarado ({begin.byte_length})."
            )
            await self._send_error(
                code="invalid_audio",
                message=len_err_msg,
                retryable=False,
                fatal=False,
                turn_id=begin.turn_id,
                generation=begin.generation,
            )
            return

        if not validate_wav_pcm_16k_mono(audio_bytes):
            await self._send_error(
                code="invalid_audio",
                message="El audio no es un WAV PCM 16kHz mono de 16 bits válido.",
                retryable=False,
                fatal=False,
                turn_id=begin.turn_id,
                generation=begin.generation,
            )
            return

        if self.active_stt_task and not self.active_stt_task.done():
            self.active_stt_task.cancel()

        self._turn_t0[(begin.turn_id, begin.generation)] = self._clock()
        await self._emit_metric(
            turn_id=begin.turn_id,
            generation=begin.generation,
            stage="speech_end",
            provider=None,
        )
        self.active_stt_task = asyncio.create_task(
            self._process_stt(begin.turn_id, begin.generation, audio_bytes, begin.duration_ms)
        )

    async def _process_stt(
        self, turn_id: str, generation: int, audio_bytes: bytes, duration_ms: int
    ) -> None:
        try:
            if self.gates is None:
                result = await self.stt_provider.transcribe(audio_bytes, media_type="audio/wav")
            else:
                async with self.gates.stt.slot():
                    result = await self.stt_provider.transcribe(audio_bytes, media_type="audio/wav")
            if generation != self.current_generation:
                return

            await self._emit_metric(
                turn_id=turn_id,
                generation=generation,
                stage="stt_final",
                provider="openrouter",
                usage_seconds=result.duration_seconds,
                cost_usd=result.cost_usd,
                estimated=False,
            )

            await self._enqueue_message({
                "type": "transcript.final",
                "turn_id": turn_id,
                "generation": generation,
                "text": result.text,
                "duration_seconds": round(duration_ms / 1000.0, 2),
            })

            # Launch parallel conversation and feedback tasks if configured
            if self.llm_provider is not None:
                conv_task = asyncio.create_task(
                    self._process_conversation(
                        turn_id,
                        generation,
                        result.text,
                        self.active_scenario,
                        self.active_speech_provider,
                    )
                )
                self.active_generation_tasks.append(conv_task)

            if self.feedback_provider is not None:
                fb_task = asyncio.create_task(
                    self._process_feedback(
                        turn_id, generation, result.text, self.active_scenario
                    )
                )
                self.active_generation_tasks.append(fb_task)

        except asyncio.CancelledError:
            pass
        except ProviderBusyError:
            if generation != self.current_generation:
                return
            await self._send_error(
                code="provider_busy",
                message="El proveedor de transcripción está ocupado. Inténtalo de nuevo pronto.",
                retryable=True,
                fatal=False,
                turn_id=turn_id,
                generation=generation,
            )
        except IntegrationError as exc:
            if generation != self.current_generation:
                return
            code_map = {
                IntegrationErrorCode.NOT_CONFIGURED: "provider_not_configured",
                IntegrationErrorCode.INVALID_REQUEST: "invalid_audio",
                IntegrationErrorCode.TIMEOUT: "turn_timeout",
                IntegrationErrorCode.UNAVAILABLE: "provider_unavailable",
                IntegrationErrorCode.INVALID_RESPONSE: "invalid_provider_response",
            }
            mapped_code = code_map.get(exc.code, "provider_unavailable")
            retryable = exc.code in (
                IntegrationErrorCode.TIMEOUT,
                IntegrationErrorCode.UNAVAILABLE,
            )
            await self._send_error(
                code=mapped_code,
                message="La transcripción no está disponible para este turno.",
                retryable=retryable,
                fatal=False,
                turn_id=turn_id,
                generation=generation,
            )
        except Exception:
            if generation != self.current_generation:
                return
            await self._send_error(
                code="internal_error",
                message="Error durante el procesamiento STT.",
                retryable=True,
                fatal=False,
                turn_id=turn_id,
                generation=generation,
            )

    async def _process_conversation(
        self,
        turn_id: str,
        generation: int,
        user_text: str,
        scenario: ScenarioType,
        speech_provider: SpeechProviderType,
    ) -> None:
        if not self.llm_provider:
            return
        full_assistant_text = ""
        sys_prompt = get_voice_system_prompt(scenario)
        messages = [
            ChatMessage(role="system", content=sys_prompt),
            *self.history.get_messages(),
            ChatMessage(role="user", content=user_text),
        ]
        accumulator = SentenceAccumulator()
        segment_index = 0
        tts_character_count = 0
        active_speech_provider = speech_provider

        try:
            first_delta_sent = False
            async for delta in self._stream_llm(messages):
                if generation != self.current_generation:
                    return
                if not delta:
                    continue
                if not first_delta_sent:
                    first_delta_sent = True
                    await self._emit_metric(
                        turn_id=turn_id,
                        generation=generation,
                        stage="llm_first_token",
                        provider="openrouter",
                    )
                full_assistant_text += delta
                await self._enqueue_message({
                    "type": "assistant.delta",
                    "turn_id": turn_id,
                    "generation": generation,
                    "delta": delta,
                })

                chunks = accumulator.feed(delta)
                for chunk in chunks:
                    if self.tts_consumer:
                        tts_character_count += len(chunk)
                        item = TTSSegmentItem(
                            turn_id=turn_id,
                            generation=generation,
                            segment_index=segment_index,
                            text=chunk,
                            provider=active_speech_provider,
                        )
                        await self.tts_consumer.enqueue(
                            item, active_generation=self.current_generation
                        )
                        segment_index += 1

            if generation != self.current_generation:
                return

            if full_assistant_text:
                flushed_chunks = accumulator.flush()
                for chunk in flushed_chunks:
                    if self.tts_consumer:
                        tts_character_count += len(chunk)
                        item = TTSSegmentItem(
                            turn_id=turn_id,
                            generation=generation,
                            segment_index=segment_index,
                            text=chunk,
                            provider=active_speech_provider,
                        )
                        await self.tts_consumer.enqueue(
                            item, active_generation=self.current_generation
                        )
                        segment_index += 1

                await self._enqueue_message({
                    "type": "assistant.done",
                    "turn_id": turn_id,
                    "generation": generation,
                    "text": full_assistant_text,
                })
                llm_usage = self._consume_provider_usage(self.llm_provider)
                await self._emit_metric(
                    turn_id=turn_id,
                    generation=generation,
                    stage="llm_done",
                    provider="openrouter",
                    usage_seconds=llm_usage.seconds if llm_usage else None,
                    usage_tokens=llm_usage.tokens if llm_usage else None,
                    cost_usd=llm_usage.cost_usd if llm_usage else None,
                )
                if self.tts_consumer and active_speech_provider == "aws_polly":
                    await self._emit_metric(
                        turn_id=turn_id,
                        generation=generation,
                        stage="llm_done",
                        provider="aws_polly",
                        cost_usd=(
                            tts_character_count
                            * self.settings.polly_usd_per_million_chars
                            / 1_000_000
                        ),
                        estimated=True,
                    )
                self.history.add_completed_turn(user_text, full_assistant_text)

            else:
                await self._send_error(
                    code="conversation_unavailable",
                    message="La conversación no devolvió respuesta válida.",
                    retryable=True,
                    fatal=False,
                    turn_id=turn_id,
                    generation=generation,
                )
        except asyncio.CancelledError:
            pass
        except ProviderBusyError:
            if generation != self.current_generation:
                return
            await self._send_error(
                code="provider_busy",
                message="El proveedor de conversación está ocupado. Inténtalo de nuevo pronto.",
                retryable=True,
                fatal=False,
                turn_id=turn_id,
                generation=generation,
            )
        except Exception as exc:
            if generation != self.current_generation:
                return
            logger.warning("conversation_failed error_code=%s", safe_error_code(exc))
            await self._send_error(
                code="conversation_unavailable",
                message="La conversación no está disponible.",
                retryable=True,
                fatal=False,
                turn_id=turn_id,
                generation=generation,
            )

    async def _process_feedback(
        self, turn_id: str, generation: int, user_text: str, scenario: ScenarioType
    ) -> None:
        if not self.feedback_provider:
            return
        try:
            if self.gates is None:
                feedback = await self.feedback_provider.generate(user_text, scenario)
            else:
                async with self.gates.llm.slot():
                    feedback = await self.feedback_provider.generate(user_text, scenario)
            if generation != self.current_generation:
                return
            await self._enqueue_message({
                "type": "feedback.ready",
                "turn_id": turn_id,
                "generation": generation,
                "feedback": feedback.model_dump(),
            })
            feedback_usage = self._consume_provider_usage(self.feedback_provider)
            await self._emit_metric(
                turn_id=turn_id,
                generation=generation,
                stage="feedback_done",
                provider="openrouter",
                usage_seconds=feedback_usage.seconds if feedback_usage else None,
                usage_tokens=feedback_usage.tokens if feedback_usage else None,
                cost_usd=feedback_usage.cost_usd if feedback_usage else None,
            )
        except asyncio.CancelledError:
            pass
        except ProviderBusyError:
            if generation != self.current_generation:
                return
            await self._send_error(
                code="provider_busy",
                message="El proveedor de feedback está ocupado. Inténtalo de nuevo pronto.",
                retryable=True,
                fatal=False,
                turn_id=turn_id,
                generation=generation,
            )
        except Exception as exc:
            if generation != self.current_generation:
                return
            logger.warning("feedback_failed error_code=%s", safe_error_code(exc))
            await self._send_error(
                code="feedback_unavailable",
                message="El feedback no está disponible.",
                retryable=True,
                fatal=False,
                turn_id=turn_id,
                generation=generation,
            )

    @staticmethod
    def _consume_provider_usage(provider: object) -> ProviderUsage | None:
        """Read optional provider usage without requiring it from fakes or generic ports."""

        getter = getattr(provider, "consume_usage", None)
        usage = getter() if callable(getter) else None
        return usage if isinstance(usage, ProviderUsage) else None

    async def _stream_llm(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        """Iterate chat output while holding one shared LLM slot for the stream lifetime."""

        if self.llm_provider is None:
            return
        if self.gates is None:
            async for delta in self.llm_provider.stream_chat(messages):
                yield delta
            return
        async with self.gates.llm.slot():
            async for delta in self.llm_provider.stream_chat(messages):
                yield delta

    async def _emit_metric(
        self,
        *,
        turn_id: str,
        generation: int,
        stage: str,
        provider: str | None,
        usage_seconds: float | None = None,
        usage_tokens: int | None = None,
        cost_usd: float | None = None,
        estimated: bool = False,
    ) -> None:
        """Emit a content-free cumulative latency event and retain only a session total."""

        t0 = self._turn_t0.get((turn_id, generation))
        if t0 is None:
            return
        latency_ms = min(3_600_000, max(0, round((self._clock() - t0) * 1000)))
        if cost_usd is not None:
            self.session_cost_usd += cost_usd
            self.session_cost_estimated = self.session_cost_estimated or estimated
        metric = MetricsStageMessage(
            turn_id=turn_id,
            generation=generation,
            stage=stage,  # type: ignore[arg-type]
            latency_ms=latency_ms,
            provider=provider,  # type: ignore[arg-type]
            usage_seconds=usage_seconds,
            usage_tokens=usage_tokens,
            cost_usd=cost_usd,
            estimated=estimated,
        )
        await self._enqueue_message(metric.model_dump(mode="json"))
        log_operational_event(
            event="voice_stage_completed",
            session_id=self.session_id,
            turn_id=turn_id,
            generation=generation,
            stage=stage,
            latency_ms=latency_ms,
            provider=provider,
            usage_seconds=usage_seconds,
            usage_tokens=usage_tokens,
            cost_usd=cost_usd,
            estimated=estimated,
        )

    async def _on_tts_ready(self, item: TTSSegmentItem) -> None:
        """Record only the first valid MP3; Polly's full estimate is known at LLM completion."""

        key = (item.turn_id, item.generation)
        self._first_audio_segments.setdefault(key, item.segment_id)
        if key in self._tts_metrics_emitted:
            return
        self._tts_metrics_emitted.add(key)
        await self._emit_metric(
            turn_id=item.turn_id,
            generation=item.generation,
            stage="tts_first_byte",
            provider=item.provider,
        )

    async def _enforce_session_limit(self) -> None:
        """Close an idle or active session at the configured monotonic lifetime boundary."""

        try:
            await asyncio.sleep(self.settings.max_voice_session_seconds)
            if self.started and not self.ended:
                await self._close_for_limit(
                    code="session_limit_reached",
                    message="La sesión alcanzó el tiempo máximo permitido.",
                    turn_id=self.active_turn_id,
                    generation=self.current_generation if self.current_generation else None,
                )
        except asyncio.CancelledError:
            return

    async def _close_for_limit(
        self,
        *,
        code: str,
        message: str,
        turn_id: str | None,
        generation: int | None,
    ) -> None:
        """Cancel work, issue a fatal typed event, and reserve 1008 for policy limits."""

        self.ended = True
        if self.active_stt_task and not self.active_stt_task.done():
            self.active_stt_task.cancel()
        self._cancel_generation(self.current_generation)
        await self._send_error(
            code=code,
            message=message,
            retryable=False,
            fatal=True,
            turn_id=turn_id,
            generation=generation,
        )

    async def _handle_begin_timeout(self, turn_id: str, generation: int) -> None:
        await asyncio.sleep(5.0)
        if self.pending_begin and self.pending_begin.turn_id == turn_id:
            self.pending_begin = None
            await self._send_error(
                code="turn_timeout",
                message="Timeout esperando el frame de audio binario.",
                retryable=True,
                fatal=False,
                turn_id=turn_id,
                generation=generation,
            )

    async def _send_error(
        self,
        *,
        code: str,
        message: str,
        retryable: bool,
        fatal: bool,
        turn_id: str | None = None,
        generation: int | None = None,
    ) -> None:
        err_payload: dict[str, object] = {
            "type": "error",
            "code": code,
            "message": message,
            "retryable": retryable,
            "fatal": fatal,
        }
        if turn_id is not None:
            err_payload["turn_id"] = turn_id
        if generation is not None:
            err_payload["generation"] = generation

        await self._enqueue_message(err_payload)
        if fatal:
            self.ended = True
            await self.websocket.close(code=1008)

    async def _enqueue_message(self, msg: dict[str, object]) -> None:
        await self._enqueue_raw_message(json.dumps(msg))

    async def _enqueue_raw_message(self, data: str | bytes) -> None:
        await self.outbound_queue.put(data)

    async def _enqueue_audio_frame(
        self, begin: str, audio: bytes, end: str
    ) -> None:
        await self.outbound_queue.put((begin, audio, end))

    async def _outbound_writer(self) -> None:
        try:
            while True:
                msg = await self.outbound_queue.get()
                if isinstance(msg, tuple):
                    begin, audio, end = msg
                    await self.websocket.send_text(begin)
                    await self.websocket.send_bytes(audio)
                    await self.websocket.send_text(end)
                elif isinstance(msg, bytes):
                    await self.websocket.send_bytes(msg)
                else:
                    await self.websocket.send_text(msg)
                self.outbound_queue.task_done()
        except (asyncio.CancelledError, WebSocketDisconnect):
            pass
        except Exception as exc:
            logger.warning("outbound_writer_failed error_code=%s", safe_error_code(exc))

    async def _cleanup(self) -> None:
        if self.tts_consumer:
            await self.tts_consumer.stop()
        if self.begin_timeout_task and not self.begin_timeout_task.done():
            self.begin_timeout_task.cancel()
        if self.session_limit_task and not self.session_limit_task.done():
            self.session_limit_task.cancel()
        if self.active_stt_task and not self.active_stt_task.done():
            self.active_stt_task.cancel()
        self._cancel_generation(self.current_generation)
        self.active_turn_id = None
        if self.writer_task and not self.writer_task.done():
            self.writer_task.cancel()
