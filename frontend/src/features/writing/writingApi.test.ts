import { describe, expect, it, vi } from 'vitest';

import type { CorrectionResponse } from './types';
import { correctWriting, WritingRequestError } from './writingApi';

const RESULT: CorrectionResponse = {
  original_text: 'This endpoint works.',
  corrected_text: 'This endpoint works.',
  has_corrections: false,
  corrections: [],
  general_feedback: 'La oración es correcta y natural.',
};

describe('correctWriting', () => {
  it('posts the typed request to the Writing endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(RESULT), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await correctWriting(RESULT.original_text, {
      baseUrl: 'https://api.test/',
      fetcher,
    });

    expect(response).toEqual(RESULT);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.test/api/writing/correct');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ text: RESULT.original_text });
  });

  it('preserves typed server errors for actionable UI feedback', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'provider_timeout',
            message: 'La corrección tardó demasiado. Inténtalo de nuevo.',
            retryable: true,
          },
        }),
        { status: 504, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const request = correctWriting('Review this.', {
      baseUrl: 'https://api.test',
      fetcher,
    });

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<WritingRequestError>>({
        code: 'provider_timeout',
        retryable: true,
      }),
    );
  });

  it.each([
    { corrected_text: 42 },
    {
      original_text: 'Check this text.',
      corrected_text: 'Check this text.',
      has_corrections: true,
      corrections: [
        {
          original: 'this',
          corrected: 'that',
          explanation: 'El cambio no aparece en el resultado final.',
          category: 'style',
        },
      ],
      general_feedback: 'Revisa el resultado.',
    },
  ])('rejects malformed or contradictory successful payloads', async (payload) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    await expect(
      correctWriting('Review this.', { baseUrl: 'https://api.test', fetcher }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
