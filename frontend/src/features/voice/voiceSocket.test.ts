import { describe, expect, it } from 'vitest';

import { resolveVoiceWebSocketUrl } from './voiceSocket';

describe('resolveVoiceWebSocketUrl', () => {
  it('maps http API base to ws path', () => {
    expect(resolveVoiceWebSocketUrl('http://127.0.0.1:8000')).toBe(
      'ws://127.0.0.1:8000/api/voice/ws',
    );
  });

  it('maps https API base to wss path', () => {
    expect(resolveVoiceWebSocketUrl('https://api.example.com/')).toBe(
      'wss://api.example.com/api/voice/ws',
    );
  });

  it('accepts bare host and defaults to https/wss', () => {
    expect(resolveVoiceWebSocketUrl('api.example.com')).toBe(
      'wss://api.example.com/api/voice/ws',
    );
  });

  it('preserves explicit ws urls', () => {
    expect(resolveVoiceWebSocketUrl('wss://api.example.com/api/voice/ws')).toBe(
      'wss://api.example.com/api/voice/ws',
    );
  });
});
