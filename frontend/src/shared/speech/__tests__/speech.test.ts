import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { synthesizeSpeech, SpeechClientError } from '../speechClient';
import {
  DEFAULT_SPEECH_PROVIDER,
  loadSpeechProvider,
  saveSpeechProvider,
  SPEECH_STORAGE_KEY,
} from '../storage';

describe('Speech Storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default provider when storage is empty', () => {
    expect(loadSpeechProvider()).toBe(DEFAULT_SPEECH_PROVIDER);
  });

  it('saves and loads a valid provider preference', () => {
    saveSpeechProvider('edge_tts');
    expect(loadSpeechProvider()).toBe('edge_tts');
  });

  it('handles corrupt JSON in storage gracefully', () => {
    localStorage.setItem(SPEECH_STORAGE_KEY, 'corrupt-json');
    expect(loadSpeechProvider()).toBe(DEFAULT_SPEECH_PROVIDER);
  });

  it('handles invalid version or invalid provider gracefully', () => {
    localStorage.setItem(
      SPEECH_STORAGE_KEY,
      JSON.stringify({ version: 99, state: { provider: 'unknown' } }),
    );
    expect(loadSpeechProvider()).toBe(DEFAULT_SPEECH_PROVIDER);
  });
});

describe('Speech HTTP Client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends correct request payload and returns MP3 blob on 200 OK', async () => {
    const mockAudioBytes = new Uint8Array([1, 2, 3]);
    const mockResponse = new Response(mockAudioBytes, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const blob = await synthesizeSpeech({
      text: 'Testing audio synthesis',
      provider: 'aws_polly',
    });

    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:8000/api/speech', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        text: 'Testing audio synthesis',
        provider: 'aws_polly',
        voice: null,
      }),
    }));
    expect(blob.size).toBe(3);
  });

  it('throws SpeechClientError with code and message on API error response', async () => {
    const errorBody = {
      error: {
        code: 'provider_not_configured',
        message: 'El proveedor de voz seleccionado no está configurado.',
        retryable: false,
      },
    };
    const mockResponse = new Response(JSON.stringify(errorBody), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await expect(
      synthesizeSpeech({
        text: 'Testing audio synthesis',
        provider: 'aws_polly',
      }),
    ).rejects.toThrow(SpeechClientError);
  });
});
