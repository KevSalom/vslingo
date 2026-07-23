import { describe, expect, it, vi } from 'vitest';

import { MAX_TRANSCRIPT_SEGMENTS, type TranscriptResponse } from './types';
import { fetchVideoTranscript, VideoRequestError } from './videoApi';

const RESULT: TranscriptResponse = {
  video_id: 'aircAruvnKk',
  source: 'youtube',
  segments: [{ text: 'A typed transcript.', start: 0, duration: 2.5 }],
};

describe('fetchVideoTranscript', () => {
  it('posts the URL, forwards cancellation and validates the response', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(RESULT), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      fetchVideoTranscript('https://youtu.be/aircAruvnKk', {
        baseUrl: 'https://api.test/',
        fetcher,
        signal: controller.signal,
      }),
    ).resolves.toEqual(RESULT);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.test/api/video/transcript',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://youtu.be/aircAruvnKk' }),
        signal: controller.signal,
      }),
    );
  });

  it('preserves aborts instead of presenting them as network failures', async () => {
    const abort = new DOMException('Cancelled by a newer selection.', 'AbortError');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(abort);

    await expect(
      fetchVideoTranscript('https://youtu.be/aircAruvnKk', { fetcher }),
    ).rejects.toBe(abort);
  });

  it('preserves typed provider failures for actionable feedback', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'provider_blocked',
            message: 'YouTube bloqueó temporalmente la solicitud. Usa la demo técnica.',
            retryable: false,
          },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const request = fetchVideoTranscript('https://youtu.be/aircAruvnKk', {
      fetcher,
    });

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<VideoRequestError>>({
        code: 'provider_blocked',
        retryable: false,
      }),
    );
  });

  it('rejects malformed or oversized successful payloads', async () => {
    const malformedFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ ...RESULT, segments: [{ text: '', start: -1, duration: 0 }] }),
        { status: 200 },
      ),
    );
    const oversizedFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...RESULT,
          segments: Array.from(
            { length: MAX_TRANSCRIPT_SEGMENTS + 1 },
            (_, index) => ({ text: `Segment ${index}`, start: index, duration: 1 }),
          ),
        }),
        { status: 200 },
      ),
    );

    await expect(
      fetchVideoTranscript('https://youtu.be/aircAruvnKk', {
        fetcher: malformedFetcher,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      fetchVideoTranscript('https://youtu.be/aircAruvnKk', {
        fetcher: oversizedFetcher,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
