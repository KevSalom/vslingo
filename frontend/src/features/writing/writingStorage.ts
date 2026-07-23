import {
  isCorrectionResponse,
  isRecord,
  MAX_CORRECTION_TEXT_LENGTH,
  type CorrectionResponse,
} from './types';

export const WRITING_STORAGE_KEY = 'vslingo:writing';
const WRITING_STORAGE_VERSION = 1;

export type WritingState = {
  readonly draft: string;
  readonly result: CorrectionResponse | null;
};

export const EMPTY_WRITING_STATE: WritingState = {
  draft: '',
  result: null,
};

export function loadWritingState(
  storage: Storage | undefined = browserStorage(),
): WritingState {
  if (!storage) {
    return EMPTY_WRITING_STATE;
  }

  let persisted: unknown;
  try {
    const raw = storage.getItem(WRITING_STORAGE_KEY);
    if (!raw) {
      return EMPTY_WRITING_STATE;
    }
    persisted = JSON.parse(raw);
  } catch {
    return EMPTY_WRITING_STATE;
  }

  if (!isRecord(persisted)) {
    return EMPTY_WRITING_STATE;
  }

  if (persisted.version === WRITING_STORAGE_VERSION) {
    return parseState(persisted.state) ?? EMPTY_WRITING_STATE;
  }

  if (persisted.version === 0) {
    const migrated = parseState({
      draft: persisted.inputText,
      result: persisted.lastResult,
    });
    if (migrated) {
      saveWritingState(migrated, storage);
      return migrated;
    }
  }

  return EMPTY_WRITING_STATE;
}

export function saveWritingState(
  state: WritingState,
  storage: Storage | undefined = browserStorage(),
): void {
  if (!storage || !isValidState(state)) {
    return;
  }

  try {
    storage.setItem(
      WRITING_STORAGE_KEY,
      JSON.stringify({ version: WRITING_STORAGE_VERSION, state }),
    );
  } catch {
    // The workspace remains usable when storage is unavailable or full.
  }
}

export function clearWritingState(
  storage: Storage | undefined = browserStorage(),
): void {
  try {
    storage?.removeItem(WRITING_STORAGE_KEY);
  } catch {
    // Clearing the visible workspace must not depend on storage availability.
  }
}

function parseState(value: unknown): WritingState | null {
  if (!isRecord(value)) {
    return null;
  }

  const state: WritingState = {
    draft: typeof value.draft === 'string' ? value.draft : '',
    result: isCorrectionResponse(value.result) ? value.result : null,
  };
  return isValidState(state) ? state : null;
}

function isValidState(state: WritingState): boolean {
  return (
    state.draft.length <= MAX_CORRECTION_TEXT_LENGTH &&
    (state.result === null || isCorrectionResponse(state.result))
  );
}

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
