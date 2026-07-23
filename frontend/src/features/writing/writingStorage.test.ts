import { beforeEach, describe, expect, it } from 'vitest';

import type { CorrectionResponse } from './types';
import {
  EMPTY_WRITING_STATE,
  WRITING_STORAGE_KEY,
  loadWritingState,
  saveWritingState,
} from './writingStorage';

const RESULT: CorrectionResponse = {
  original_text: 'I agree with the proposal.',
  corrected_text: 'I agree with the proposal.',
  has_corrections: false,
  corrections: [],
  general_feedback: 'La oración es correcta y natural.',
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('writingStorage', () => {
  it('round-trips the current versioned state', () => {
    const state = { draft: RESULT.original_text, result: RESULT };

    saveWritingState(state);

    expect(loadWritingState()).toEqual(state);
    expect(JSON.parse(window.localStorage.getItem(WRITING_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: 1,
    });
  });

  it('migrates the approved legacy shape to version 1', () => {
    window.localStorage.setItem(
      WRITING_STORAGE_KEY,
      JSON.stringify({
        version: 0,
        inputText: RESULT.original_text,
        lastResult: RESULT,
      }),
    );

    expect(loadWritingState()).toEqual({
      draft: RESULT.original_text,
      result: RESULT,
    });
    expect(JSON.parse(window.localStorage.getItem(WRITING_STORAGE_KEY) ?? '{}').version).toBe(1);
  });

  it('falls back safely when persisted data is malformed or unsupported', () => {
    window.localStorage.setItem(
      WRITING_STORAGE_KEY,
      JSON.stringify({ version: 99, state: { draft: 'stale' } }),
    );

    expect(loadWritingState()).toEqual(EMPTY_WRITING_STATE);

    window.localStorage.setItem(WRITING_STORAGE_KEY, '{broken');
    expect(loadWritingState()).toEqual(EMPTY_WRITING_STATE);
  });
});


it('keeps the feature usable when browser storage access is blocked', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  if (!descriptor) {
    throw new Error('jsdom must expose a configurable localStorage descriptor');
  }

  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage access denied', 'SecurityError');
      },
    });

    expect(loadWritingState()).toEqual(EMPTY_WRITING_STATE);
    expect(() => saveWritingState({ draft: 'Still usable.', result: null })).not.toThrow();
  } finally {
    Object.defineProperty(window, 'localStorage', descriptor);
  }
});
