import {
  isRecord,
  isVideoLibraryItem,
  isVideoNote,
  type TranscriptViewMode,
  type VideoLibraryItem,
  type VideoNote,
} from './types';

export const VIDEO_STORAGE_KEY = 'vslingo:video';
export const MAX_LIBRARY_ITEMS = 50;
export const MAX_NOTES = 500;
const VIDEO_STORAGE_VERSION = 1;

export type VideoState = {
  readonly library: readonly VideoLibraryItem[];
  readonly notes: readonly VideoNote[];
  readonly viewMode: TranscriptViewMode;
};

export const EMPTY_VIDEO_STATE: VideoState = {
  library: [],
  notes: [],
  viewMode: 'paragraph',
};

export function addVideoToLibrary(
  state: VideoState,
  item: VideoLibraryItem,
): VideoState | null {
  const remaining = state.library.filter(
    (saved) => saved.videoId !== item.videoId,
  );
  if (remaining.length >= MAX_LIBRARY_ITEMS) {
    return null;
  }
  return { ...state, library: [item, ...remaining] };
}

export function addVideoNote(
  state: VideoState,
  note: VideoNote,
): VideoState | null {
  if (state.notes.length >= MAX_NOTES) {
    return null;
  }
  return { ...state, notes: [note, ...state.notes] };
}

export function loadVideoState(
  storage: Storage | undefined = browserStorage(),
): VideoState {
  if (!storage) {
    return EMPTY_VIDEO_STATE;
  }

  let persisted: unknown;
  try {
    const raw = storage.getItem(VIDEO_STORAGE_KEY);
    if (!raw) {
      return EMPTY_VIDEO_STATE;
    }
    persisted = JSON.parse(raw);
  } catch {
    return EMPTY_VIDEO_STATE;
  }

  if (!isRecord(persisted)) {
    return EMPTY_VIDEO_STATE;
  }

  if (persisted.version === VIDEO_STORAGE_VERSION) {
    return parseState(persisted.state) ?? EMPTY_VIDEO_STATE;
  }

  if (persisted.version === 0) {
    const migrated = parseState({
      library: persisted.savedVideos,
      notes: persisted.savedNotes,
      viewMode: persisted.transcriptView,
    });
    if (migrated) {
      saveVideoState(migrated, storage);
      return migrated;
    }
  }

  return EMPTY_VIDEO_STATE;
}

export function saveVideoState(
  state: VideoState,
  storage: Storage | undefined = browserStorage(),
): void {
  if (!storage || !isValidState(state)) {
    return;
  }
  try {
    storage.setItem(
      VIDEO_STORAGE_KEY,
      JSON.stringify({ version: VIDEO_STORAGE_VERSION, state }),
    );
  } catch {
    // Video Lab remains usable if localStorage is blocked or full.
  }
}

export function clearVideoState(
  storage: Storage | undefined = browserStorage(),
): void {
  try {
    storage?.removeItem(VIDEO_STORAGE_KEY);
  } catch {
    // Clearing visible state must not depend on storage availability.
  }
}

function parseState(value: unknown): VideoState | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.library) ||
    !Array.isArray(value.notes)
  ) {
    return null;
  }

  const state: VideoState = {
    library: value.library
      .filter(isVideoLibraryItem)
      .slice(0, MAX_LIBRARY_ITEMS),
    notes: value.notes.filter(isVideoNote).slice(0, MAX_NOTES),
    viewMode: value.viewMode === 'line' ? 'line' : 'paragraph',
  };
  return isValidState(state) ? state : null;
}

function isValidState(state: VideoState): boolean {
  return (
    state.library.length <= MAX_LIBRARY_ITEMS &&
    state.notes.length <= MAX_NOTES &&
    state.library.every(isVideoLibraryItem) &&
    state.notes.every(isVideoNote) &&
    (state.viewMode === 'paragraph' || state.viewMode === 'line')
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
