export type SpeechProvider = 'aws_polly' | 'edge_tts';

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
  version: 1;
  state: {
    provider: SpeechProvider;
  };
};
