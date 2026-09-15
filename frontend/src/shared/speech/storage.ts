import type { EdgeVoiceId, SpeechProvider, SpeechStorageState } from './types';

export const SPEECH_STORAGE_KEY = 'vslingo:speech';
export const DEFAULT_SPEECH_PROVIDER: SpeechProvider = 'edge_tts';
export const DEFAULT_SPEECH_VOICE: EdgeVoiceId = 'en-US-AriaNeural';

const VALID_PROVIDERS: ReadonlySet<SpeechProvider> = new Set(['edge_tts']);
const VALID_VOICES: ReadonlySet<EdgeVoiceId> = new Set([
  'en-US-AriaNeural',
  'en-US-GuyNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
]);

export function loadSpeechProvider(): SpeechProvider {
  if (typeof window === 'undefined') {
    return DEFAULT_SPEECH_PROVIDER;
  }
  try {
    const raw = window.localStorage.getItem(SPEECH_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SPEECH_PROVIDER;
    }
    const parsed = JSON.parse(raw) as SpeechStorageState;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === 2 &&
      parsed.state &&
      VALID_PROVIDERS.has(parsed.state.provider)
    ) {
      return parsed.state.provider;
    }
  } catch {
    // Return default on storage access or parse failure
  }
  return DEFAULT_SPEECH_PROVIDER;
}

export function saveSpeechProvider(provider: SpeechProvider): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (!VALID_PROVIDERS.has(provider)) {
      return;
    }
    const data: SpeechStorageState = {
      version: 2,
      state: { provider, voice: loadSpeechVoice() },
    };
    window.localStorage.setItem(SPEECH_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota or write errors
  }
}

export function loadSpeechVoice(): EdgeVoiceId {
  if (typeof window === 'undefined') return DEFAULT_SPEECH_VOICE;
  try {
    const raw = window.localStorage.getItem(SPEECH_STORAGE_KEY);
    if (!raw) return DEFAULT_SPEECH_VOICE;
    const parsed = JSON.parse(raw) as SpeechStorageState;
    if (parsed.version === 2 && VALID_VOICES.has(parsed.state?.voice)) {
      return parsed.state.voice;
    }
  } catch {
    // Return the stable default when storage is unavailable or invalid.
  }
  return DEFAULT_SPEECH_VOICE;
}

export function saveSpeechVoice(voice: EdgeVoiceId): void {
  if (typeof window === 'undefined' || !VALID_VOICES.has(voice)) return;
  try {
    const data: SpeechStorageState = {
      version: 2,
      state: { provider: DEFAULT_SPEECH_PROVIDER, voice },
    };
    window.localStorage.setItem(SPEECH_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Preferences are best-effort until account persistence arrives in F2/F3.
  }
}
