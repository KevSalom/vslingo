export type ScenarioType = 'daily_standup' | 'system_design' | 'salary_negotiation' | 'free';
export type SpeechProviderType = 'aws_polly' | 'edge_tts';

export type ErrorCodeType =
  | 'invalid_event'
  | 'invalid_generation'
  | 'unsupported_protocol'
  | 'invalid_audio'
  | 'audio_too_large'
  | 'turn_timeout'
  | 'queue_full'
  | 'provider_not_configured'
  | 'provider_unavailable'
  | 'invalid_provider_response'
  | 'internal_error';

// Client Messages
export type SessionStartMessage = {
  type: 'session.start';
  protocol_version: 1;
};

export type SessionConfigMessage = {
  type: 'session.config';
  scenario: ScenarioType;
  speech_provider: SpeechProviderType;
};

export type SpeechStartedMessage = {
  type: 'speech.started';
  turn_id: string;
  generation: number;
};

export type UtteranceBeginMessage = {
  type: 'utterance.begin';
  turn_id: string;
  generation: number;
  media_type: 'audio/wav';
  byte_length: number;
  duration_ms: number;
};

export type ResponseCancelMessage = {
  type: 'response.cancel';
  turn_id: string;
  generation: number;
};

export type SessionEndMessage = {
  type: 'session.end';
};

export type ClientVoiceMessage =
  | SessionStartMessage
  | SessionConfigMessage
  | SpeechStartedMessage
  | UtteranceBeginMessage
  | ResponseCancelMessage
  | SessionEndMessage;

// Server Messages
export type SessionReadyMessage = {
  type: 'session.ready';
  protocol_version: 1;
  session_id: string;
  generation: number;
};

export type SessionConfiguredMessage = {
  type: 'session.configured';
  scenario: ScenarioType;
  speech_provider: SpeechProviderType;
  config_revision: number;
};

export type TranscriptFinalMessage = {
  type: 'transcript.final';
  turn_id: string;
  generation: number;
  text: string;
  duration_seconds: number;
};

export type ResponseCancelledMessage = {
  type: 'response.cancelled';
  turn_id: string;
  generation: number;
};

export type ErrorMessage = {
  type: 'error';
  code: ErrorCodeType;
  message: string;
  retryable: boolean;
  fatal: boolean;
  turn_id?: string;
  generation?: number;
};

export type ServerVoiceMessage =
  | SessionReadyMessage
  | SessionConfiguredMessage
  | TranscriptFinalMessage
  | ResponseCancelledMessage
  | ErrorMessage;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseServerMessage(data: string): ServerVoiceMessage | null {
  try {
    const raw = JSON.parse(data);
    if (!isRecord(raw) || typeof raw.type !== 'string') {
      return null;
    }

    switch (raw.type) {
      case 'session.ready':
        if (
          raw.protocol_version === 1 &&
          typeof raw.session_id === 'string' &&
          typeof raw.generation === 'number'
        ) {
          return raw as SessionReadyMessage;
        }
        return null;

      case 'session.configured':
        if (
          typeof raw.scenario === 'string' &&
          typeof raw.speech_provider === 'string' &&
          typeof raw.config_revision === 'number'
        ) {
          return raw as SessionConfiguredMessage;
        }
        return null;

      case 'transcript.final':
        if (
          typeof raw.turn_id === 'string' &&
          typeof raw.generation === 'number' &&
          typeof raw.text === 'string' &&
          typeof raw.duration_seconds === 'number'
        ) {
          return raw as TranscriptFinalMessage;
        }
        return null;

      case 'response.cancelled':
        if (
          typeof raw.turn_id === 'string' &&
          typeof raw.generation === 'number'
        ) {
          return raw as ResponseCancelledMessage;
        }
        return null;

      case 'error':
        if (
          typeof raw.code === 'string' &&
          typeof raw.message === 'string' &&
          typeof raw.retryable === 'boolean' &&
          typeof raw.fatal === 'boolean'
        ) {
          return raw as ErrorMessage;
        }
        return null;

      default:
        return null;
    }
  } catch {
    return null;
  }
}
