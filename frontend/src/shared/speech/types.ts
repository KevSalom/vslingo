export type SpeechProvider = 'edge_tts';
export type EdgeVoiceId =
  | 'en-US-AriaNeural'
  | 'en-US-GuyNeural'
  | 'en-GB-SoniaNeural'
  | 'en-GB-RyanNeural';

export type SpeechState = 'idle' | 'synthesizing' | 'playing' | 'error';

export type SpeechApiError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type SpeechErrorResponse = {
  error: SpeechApiError;
};

export type SpeechStorageState = {
  version: 2;
  state: {
    provider: SpeechProvider;
    voice: EdgeVoiceId;
  };
};
