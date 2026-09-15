import type { EdgeVoiceId } from './types';

export const EDGE_VOICES: readonly { id: EdgeVoiceId; label: string; locale: string }[] = [
  { id: 'en-US-AriaNeural', label: 'Aria · Estados Unidos', locale: 'en-US' },
  { id: 'en-US-GuyNeural', label: 'Guy · Estados Unidos', locale: 'en-US' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia · Reino Unido', locale: 'en-GB' },
  { id: 'en-GB-RyanNeural', label: 'Ryan · Reino Unido', locale: 'en-GB' },
];
