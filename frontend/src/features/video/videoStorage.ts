import {
  deriveNoteTitle,
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
const VIDEO_STORAGE_VERSION = 2;

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

export function removeVideoFromLibrary(
  state: VideoState,
  id: string,
): VideoState {
  return {
    ...state,
    library: state.library.filter((item) => item.id !== id),
  };
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

export function updateVideoNote(
  state: VideoState,
  id: string,
  patch: Pick<VideoNote, 'title' | 'text'> & { timestamp?: number },
): VideoState {
  return {
    ...state,
    notes: state.notes.map((note) =>
      note.id === id
        ? {
            ...note,
            title: patch.title,
            text: patch.text,
            ...(patch.timestamp !== undefined
              ? { timestamp: patch.timestamp }
              : {}),
          }
        : note,
    ),
  };
}

export function removeVideoNote(state: VideoState, id: string): VideoState {
  return {
    ...state,
    notes: state.notes.filter((note) => note.id !== id),
  };
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

  if (persisted.version === 1 && isRecord(persisted.state)) {
    const migrated = migrateFromV1(persisted.state);
    if (migrated) {
      saveVideoState(migrated, storage);
      return migrated;
    }
  }

  if (persisted.version === 0) {
    const migrated = migrateFromV1({
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

function migrateFromV1(value: unknown): VideoState | null {
  if (!isRecord(value) || !Array.isArray(value.library) || !Array.isArray(value.notes)) {
    return null;
  }

  const notes = value.notes
    .map(migrateNoteFromLegacy)
    .filter((note): note is VideoNote => note !== null)
    .slice(0, MAX_NOTES);

  const state: VideoState = {
    library: value.library
      .filter(isVideoLibraryItem)
      .slice(0, MAX_LIBRARY_ITEMS),
    notes,
    viewMode: value.viewMode === 'line' ? 'line' : 'paragraph',
  };
  return isValidState(state) ? state : null;
}

function migrateNoteFromLegacy(value: unknown): VideoNote | null {
  if (isVideoNote(value)) {
    return value;
  }
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.text !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    return null;
  }

  const text = value.text.trim();
  if (text.length === 0 || text.length > 2_000) {
    return null;
  }

  const timestamp =
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    value.timestamp >= 0
      ? value.timestamp
      : undefined;

  const titleSource =
    typeof value.title === 'string' && value.title.trim().length > 0
      ? value.title.trim()
      : deriveNoteTitle(text, timestamp);

  const title =
    titleSource.length <= 200 ? titleSource : titleSource.slice(0, 200);

  if (title.trim().length === 0 || value.id.trim().length === 0 || value.id.length > 100) {
    return null;
  }

  return {
    id: value.id,
    title,
    text,
    createdAt: value.createdAt,
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
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
