import { loadSpeechProvider } from '../../shared/speech/storage';
import type { ScenarioType, SpeechProviderType, VoiceFeedback } from './protocol';

export const VOICE_STORAGE_KEY = 'vslingo:voice';

export interface VoiceStoredState {
  version: 1;
  scenario: ScenarioType;
}

export const SCENARIO_LABELS: Record<ScenarioType, string> = {
  daily_standup: 'Daily Standup',
  system_design: 'System Design / Technical Interview',
  salary_negotiation: 'Salary Negotiation',
  free: 'Libre / Explorar',
};

export interface TurnRecord {
  turnId: string;
  userText: string;
  assistantText: string;
  feedback?: VoiceFeedback;
}

export interface ActiveTurnState {
  turnId: string;
  generation: number;
  userText?: string;
  streamingAssistantText: string;
  conversationState: 'idle' | 'streaming' | 'done' | 'error' | 'cancelled';
  feedbackState: 'idle' | 'pending' | 'ready' | 'error';
  feedback?: VoiceFeedback;
  conversationErrorMsg?: string;
  feedbackErrorMsg?: string;
}

export type InputSubstate =
  | 'idle'
  | 'initializing_vad'
  | 'vad_ready'
  | 'listening'
  | 'speech'
  | 'encoding'
  | 'fallback_ptt'
  | 'permission_denied'
  | 'input_error'
  | 'interrupted';

export const ACCESSIBLE_INPUT_LABELS: Record<InputSubstate, string> = {
  idle: 'Inactivo',
  initializing_vad: 'Inicializando micrófono...',
  vad_ready: 'Listo',
  listening: 'Escuchando',
  speech: 'Te escucho',
  encoding: 'Procesando',
  fallback_ptt: 'Modo manual (PTT)',
  permission_denied: 'Permiso de micrófono denegado',
  input_error: 'Error de entrada de audio',
  interrupted: 'Interrumpido',
};

export interface VoiceState {
  scenario: ScenarioType;
  speechProvider: SpeechProviderType;
  turnHistory: TurnRecord[];
  activeTurn: ActiveTurnState | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'recording';
  inputState: InputSubstate;
  audioState: 'idle' | 'playing' | 'interrupted';
}


export function loadVoicePreferences(): ScenarioType {
  try {
    const raw = localStorage.getItem(VOICE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && typeof parsed.scenario === 'string') {
        if (parsed.scenario in SCENARIO_LABELS) {
          return parsed.scenario as ScenarioType;
        }
      }
    }
  } catch {
    // Ignore storage errors
  }
  return 'daily_standup';
}

export function saveVoicePreferences(scenario: ScenarioType): void {
  try {
    const data: VoiceStoredState = { version: 1, scenario };
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

export function createInitialVoiceState(): VoiceState {
  return {
    scenario: loadVoicePreferences(),
    speechProvider: loadSpeechProvider(),
    turnHistory: [],
    activeTurn: null,
    status: 'disconnected',
    inputState: 'idle',
    audioState: 'idle',
  };
}
