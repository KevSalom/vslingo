"""Voice Protocol v2 schemas and discriminators for WebSocket communication."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from app.domain.feedback import VoiceFeedback


class BaseVoiceMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# Client Messages
class SessionStartMessage(BaseVoiceMessage):
    type: Literal["session.start"] = "session.start"
    protocol_version: Literal[2] = 2
    conversation_id: str | None = Field(default=None, min_length=1, max_length=64)


ScenarioType = Literal["daily_standup", "system_design", "salary_negotiation", "free"]
SpeechProviderType = Literal["edge_tts"]
SpeechVoiceType = Literal[
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
]


class SessionConfigMessage(BaseVoiceMessage):
    type: Literal["session.config"] = "session.config"
    scenario: ScenarioType = "free"
    speech_provider: SpeechProviderType = "edge_tts"
    speech_voice: SpeechVoiceType = "en-US-AriaNeural"


class SpeechStartedMessage(BaseVoiceMessage):
    type: Literal["speech.started"] = "speech.started"
    turn_id: str
    generation: int = Field(ge=1)


class UtteranceBeginMessage(BaseVoiceMessage):
    type: Literal["utterance.begin"] = "utterance.begin"
    turn_id: str
    generation: int = Field(ge=1)
    media_type: Literal["audio/wav"] = "audio/wav"
    byte_length: int = Field(ge=1, le=2_000_044)
    duration_ms: int = Field(ge=100, le=60_000)


class ResponseCancelMessage(BaseVoiceMessage):
    type: Literal["response.cancel"] = "response.cancel"
    turn_id: str
    generation: int = Field(ge=1)


class PlaybackStartedMessage(BaseVoiceMessage):
    type: Literal["playback.started"] = "playback.started"
    turn_id: str
    generation: int = Field(ge=1)
    segment_id: str
    segment_index: int = Field(ge=0)
    engine: Literal["edge_tts", "browser"] = "edge_tts"


class SessionEndMessage(BaseVoiceMessage):
    type: Literal["session.end"] = "session.end"


ClientVoiceMessage = Annotated[
    SessionStartMessage
    | SessionConfigMessage
    | SpeechStartedMessage
    | UtteranceBeginMessage
    | ResponseCancelMessage
    | PlaybackStartedMessage
    | SessionEndMessage,
    Field(discriminator="type"),
]


# Server Messages
class SessionReadyMessage(BaseVoiceMessage):
    type: Literal["session.ready"] = "session.ready"
    protocol_version: Literal[2] = 2
    session_id: str
    generation: int = 0


class SessionConfiguredMessage(BaseVoiceMessage):
    type: Literal["session.configured"] = "session.configured"
    scenario: ScenarioType
    speech_provider: SpeechProviderType
    speech_voice: SpeechVoiceType
    config_revision: int = Field(ge=1)


class TranscriptFinalMessage(BaseVoiceMessage):
    type: Literal["transcript.final"] = "transcript.final"
    turn_id: str
    generation: int = Field(ge=1)
    text: str
    duration_seconds: float = Field(ge=0.0)


class AssistantDeltaMessage(BaseVoiceMessage):
    type: Literal["assistant.delta"] = "assistant.delta"
    turn_id: str
    generation: int = Field(ge=1)
    delta: str = Field(min_length=1, max_length=2000)


class AssistantDoneMessage(BaseVoiceMessage):
    type: Literal["assistant.done"] = "assistant.done"
    turn_id: str
    generation: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=600)


class AssistantSegmentMessage(BaseVoiceMessage):
    type: Literal["assistant.segment"] = "assistant.segment"
    turn_id: str
    generation: int = Field(ge=1)
    segment_id: str
    segment_index: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=600)


class FeedbackReadyMessage(BaseVoiceMessage):
    type: Literal["feedback.ready"] = "feedback.ready"
    turn_id: str
    generation: int = Field(ge=1)
    feedback: VoiceFeedback


class ResponseCancelledMessage(BaseVoiceMessage):
    type: Literal["response.cancelled"] = "response.cancelled"
    turn_id: str
    generation: int = Field(ge=1)


class AudioBeginMessage(BaseVoiceMessage):
    type: Literal["audio.begin"] = "audio.begin"
    turn_id: str
    generation: int = Field(ge=1)
    segment_id: str
    segment_index: int = Field(ge=0)
    media_type: Literal["audio/mpeg"] = "audio/mpeg"
    byte_length: int = Field(ge=1, le=2_000_000)


class AudioEndMessage(BaseVoiceMessage):
    type: Literal["audio.end"] = "audio.end"
    turn_id: str
    generation: int = Field(ge=1)
    segment_id: str
    segment_index: int = Field(ge=0)


MetricStage = Literal[
    "speech_end",
    "stt_final",
    "llm_first_token",
    "llm_done",
    "feedback_done",
    "tts_first_byte",
    "playback_started",
    "turn_cancelled",
]
MetricProvider = Literal["openrouter", "edge_tts"]


class MetricsStageMessage(BaseVoiceMessage):
    type: Literal["metrics.stage"] = "metrics.stage"
    turn_id: str
    generation: int = Field(ge=1)
    stage: MetricStage
    latency_ms: int = Field(ge=0, le=3_600_000)
    provider: MetricProvider | None = None
    usage_seconds: float | None = Field(default=None, ge=0.0, allow_inf_nan=False)
    usage_tokens: int | None = Field(default=None, ge=0)
    cost_usd: float | None = Field(default=None, ge=0.0, allow_inf_nan=False)
    estimated: bool = False

    @model_validator(mode="after")
    def validate_estimated_cost(self) -> "MetricsStageMessage":
        """Reject estimated provider costs until a verified Edge price exists."""

        if self.estimated:
            raise ValueError("Estimated TTS cost is not supported for Edge TTS.")
        return self


ErrorCodeType = Literal[
    "invalid_event",
    "invalid_generation",
    "unsupported_protocol",
    "invalid_audio",
    "audio_too_large",
    "turn_timeout",
    "queue_full",
    "provider_busy",
    "turn_limit_reached",
    "session_limit_reached",
    "provider_not_configured",
    "provider_unavailable",
    "invalid_provider_response",
    "internal_error",
    "feedback_unavailable",
    "conversation_unavailable",
    "history_unavailable",
    "history_not_found",
    "speech_unavailable",
]


class ErrorMessage(BaseVoiceMessage):
    type: Literal["error"] = "error"
    code: ErrorCodeType
    message: str
    retryable: bool
    fatal: bool
    turn_id: str | None = None
    generation: int | None = None
    segment_id: str | None = None
    segment_index: int | None = Field(default=None, ge=0)


ServerVoiceMessage = Annotated[
    SessionReadyMessage
    | SessionConfiguredMessage
    | TranscriptFinalMessage
    | AssistantDeltaMessage
    | AssistantDoneMessage
    | AssistantSegmentMessage
    | FeedbackReadyMessage
    | ResponseCancelledMessage
    | AudioBeginMessage
    | AudioEndMessage
    | MetricsStageMessage
    | ErrorMessage,
    Field(discriminator="type"),
]

client_adapter: TypeAdapter[ClientVoiceMessage] = TypeAdapter(ClientVoiceMessage)
server_adapter: TypeAdapter[ServerVoiceMessage] = TypeAdapter(ServerVoiceMessage)
