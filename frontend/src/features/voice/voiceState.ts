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

export interface VoiceState {
  scenario: ScenarioType;
  speechProvider: SpeechProviderType;
  turnHistory: TurnRecord[];
  activeTurn: ActiveTurnState | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'recording';
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
    speechProvider: 'aws_polly',
    turnHistory: [],
    activeTurn: null,
    status: 'disconnected',
  };
}
