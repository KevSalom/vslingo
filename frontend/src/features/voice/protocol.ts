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
  | 'internal_error'
  | 'feedback_unavailable'
  | 'conversation_unavailable'
  | 'speech_unavailable';

export type CorrectionCategoryType = 'grammar' | 'vocabulary' | 'clarity' | 'tone';

export type CorrectionItem = {
  category: CorrectionCategoryType;
  original: string;
  corrected: string;
  explanation_es: string;
};

export type VocabularyItem = {
  term: string;
  meaning_es: string;
  example_en: string;
};

export type VoiceFeedback = {
  summary_es: string;
  strengths: string[];
  corrections: CorrectionItem[];
  vocabulary: VocabularyItem[];
};

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

export type AssistantDeltaMessage = {
  type: 'assistant.delta';
  turn_id: string;
  generation: number;
  delta: string;
};

export type AssistantDoneMessage = {
  type: 'assistant.done';
  turn_id: string;
  generation: number;
  text: string;
};

export type FeedbackReadyMessage = {
  type: 'feedback.ready';
  turn_id: string;
  generation: number;
  feedback: VoiceFeedback;
};

export type ResponseCancelledMessage = {
  type: 'response.cancelled';
  turn_id: string;
  generation: number;
};

export type AudioBeginMessage = {
  type: 'audio.begin';
  turn_id: string;
  generation: number;
  segment_id: string;
  segment_index: number;
  media_type: 'audio/mpeg';
  byte_length: number;
};

export type AudioEndMessage = {
  type: 'audio.end';
  turn_id: string;
  generation: number;
  segment_id: string;
  segment_index: number;
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
  | AssistantDeltaMessage
  | AssistantDoneMessage
  | FeedbackReadyMessage
  | ResponseCancelledMessage
  | AudioBeginMessage
  | AudioEndMessage
  | ErrorMessage;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SCENARIOS: ReadonlySet<ScenarioType> = new Set([
  'daily_standup',
  'system_design',
  'salary_negotiation',
  'free',
]);
const SPEECH_PROVIDERS: ReadonlySet<SpeechProviderType> = new Set(['aws_polly', 'edge_tts']);
const ERROR_CODES: ReadonlySet<ErrorCodeType> = new Set([
  'invalid_event',
  'invalid_generation',
  'unsupported_protocol',
  'invalid_audio',
  'audio_too_large',
  'turn_timeout',
  'queue_full',
  'provider_not_configured',
  'provider_unavailable',
  'invalid_provider_response',
  'internal_error',
  'feedback_unavailable',
  'conversation_unavailable',
  'speech_unavailable',
]);

function isIntegerInRange(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
          isNonEmptyId(raw.session_id) &&
          isIntegerInRange(raw.generation, 0)
        ) {
          return raw as SessionReadyMessage;
        }
        return null;

      case 'session.configured':
        if (
          SCENARIOS.has(raw.scenario as ScenarioType) &&
          SPEECH_PROVIDERS.has(raw.speech_provider as SpeechProviderType) &&
          isIntegerInRange(raw.config_revision, 1)
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

      case 'assistant.delta':
        if (
          typeof raw.turn_id === 'string' &&
          typeof raw.generation === 'number' &&
          typeof raw.delta === 'string'
        ) {
          return raw as AssistantDeltaMessage;
        }
        return null;

      case 'assistant.done':
        if (
          typeof raw.turn_id === 'string' &&
          typeof raw.generation === 'number' &&
          typeof raw.text === 'string'
        ) {
          return raw as AssistantDoneMessage;
        }
        return null;

      case 'feedback.ready':
        if (
          typeof raw.turn_id === 'string' &&
          typeof raw.generation === 'number' &&
          isRecord(raw.feedback) &&
          typeof raw.feedback.summary_es === 'string'
        ) {
          return raw as FeedbackReadyMessage;
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

      case 'audio.begin':
        if (
          isNonEmptyId(raw.turn_id) &&
          isIntegerInRange(raw.generation, 1) &&
          isNonEmptyId(raw.segment_id) &&
          isIntegerInRange(raw.segment_index, 0) &&
          raw.media_type === 'audio/mpeg' &&
          isIntegerInRange(raw.byte_length, 1, 2_000_000)
        ) {
          return raw as AudioBeginMessage;
        }
        return null;

      case 'audio.end':
        if (
          isNonEmptyId(raw.turn_id) &&
          isIntegerInRange(raw.generation, 1) &&
          isNonEmptyId(raw.segment_id) &&
          isIntegerInRange(raw.segment_index, 0)
        ) {
          return raw as AudioEndMessage;
        }
        return null;

      case 'error':
        if (
          ERROR_CODES.has(raw.code as ErrorCodeType) &&
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
