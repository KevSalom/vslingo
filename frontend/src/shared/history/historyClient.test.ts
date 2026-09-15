import { describe, expect, it, vi } from 'vitest';

import type { CorrectionResponse } from '../../features/writing/types';
import {
  HistoryRequestError,
  saveWritingHistory,
  updateNoteHistory,
} from './historyClient';

const RESULT: CorrectionResponse = {
  original_text: 'She go.',
  corrected_text: 'She goes.',
  has_corrections: true,
  corrections: [{
    original: 'go', corrected: 'goes', explanation: 'Concordancia.', category: 'grammar',
  }],
  general_feedback: 'Bien.',
};

describe('history client', () => {
  it('persists a writing result with a stable operation id and authenticated transport', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'entry-a', operation_id: 'op-a', ...RESULT }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(saveWritingHistory(RESULT, 'op-a', {
      baseUrl: 'https://api.test/', fetcher,
    })).resolves.toMatchObject({ id: 'entry-a' });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      operation_id: 'op-a', ...RESULT,
    });
  });

  it('keeps a useful recoverable error when persistence is unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    await expect(saveWritingHistory(RESULT, 'op-a', { fetcher })).rejects.toEqual(
      expect.objectContaining<Partial<HistoryRequestError>>({ code: 'history_failed' }),
    );
  });

  it('surfaces an optimistic note conflict without overwriting either version', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        error: { code: 'note_conflict' },
        current: { id: 'note-a', version: 2, text: 'Remote text' },
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(updateNoteHistory('note-a', {
      title: 'Draft', text: 'Local text', version: 1,
    }, { baseUrl: 'https://api.test', fetcher })).rejects.toEqual(
      expect.objectContaining<Partial<HistoryRequestError>>({ code: 'note_conflict' }),
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
