"""Voice Protocol v1 schemas and discriminators for WebSocket communication."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.domain.feedback import VoiceFeedback


class BaseVoiceMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# Client Messages
class SessionStartMessage(BaseVoiceMessage):
    type: Literal["session.start"] = "session.start"
    protocol_version: Literal[1] = 1


ScenarioType = Literal["daily_standup", "system_design", "salary_negotiation", "free"]
SpeechProviderType = Literal["aws_polly", "edge_tts"]


class SessionConfigMessage(BaseVoiceMessage):
    type: Literal["session.config"] = "session.config"
    scenario: ScenarioType = "daily_standup"
    speech_provider: SpeechProviderType = "aws_polly"


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


class SessionEndMessage(BaseVoiceMessage):
    type: Literal["session.end"] = "session.end"


ClientVoiceMessage = Annotated[
    SessionStartMessage
    | SessionConfigMessage
    | SpeechStartedMessage
    | UtteranceBeginMessage
    | ResponseCancelMessage
    | SessionEndMessage,
    Field(discriminator="type"),
]


# Server Messages
class SessionReadyMessage(BaseVoiceMessage):
    type: Literal["session.ready"] = "session.ready"
    protocol_version: Literal[1] = 1
    session_id: str
    generation: int = 0


class SessionConfiguredMessage(BaseVoiceMessage):
    type: Literal["session.configured"] = "session.configured"
    scenario: ScenarioType
    speech_provider: SpeechProviderType
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


class FeedbackReadyMessage(BaseVoiceMessage):
    type: Literal["feedback.ready"] = "feedback.ready"
    turn_id: str
    generation: int = Field(ge=1)
    feedback: VoiceFeedback


class ResponseCancelledMessage(BaseVoiceMessage):
    type: Literal["response.cancelled"] = "response.cancelled"
    turn_id: str
    generation: int = Field(ge=1)


ErrorCodeType = Literal[
    "invalid_event",
    "invalid_generation",
    "unsupported_protocol",
    "invalid_audio",
    "audio_too_large",
    "turn_timeout",
    "queue_full",
    "provider_not_configured",
    "provider_unavailable",
    "invalid_provider_response",
    "internal_error",
    "feedback_unavailable",
    "conversation_unavailable",
]


class ErrorMessage(BaseVoiceMessage):
    type: Literal["error"] = "error"
    code: ErrorCodeType
    message: str
    retryable: bool
    fatal: bool
    turn_id: str | None = None
    generation: int | None = None


ServerVoiceMessage = Annotated[
    SessionReadyMessage
    | SessionConfiguredMessage
    | TranscriptFinalMessage
    | AssistantDeltaMessage
    | AssistantDoneMessage
    | FeedbackReadyMessage
    | ResponseCancelledMessage
    | ErrorMessage,
    Field(discriminator="type"),
]

client_adapter: TypeAdapter[ClientVoiceMessage] = TypeAdapter(ClientVoiceMessage)
server_adapter: TypeAdapter[ServerVoiceMessage] = TypeAdapter(ServerVoiceMessage)
