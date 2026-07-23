import type { SpeechProvider, SpeechStorageState } from './types';

export const SPEECH_STORAGE_KEY = 'vslingo:speech';
export const DEFAULT_SPEECH_PROVIDER: SpeechProvider = 'aws_polly';

const VALID_PROVIDERS: ReadonlySet<SpeechProvider> = new Set(['aws_polly', 'edge_tts']);

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
      parsed.version === 1 &&
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
      version: 1,
      state: { provider },
    };
    window.localStorage.setItem(SPEECH_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota or write errors
  }
}
