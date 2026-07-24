import { beforeEach, describe, expect, it } from 'vitest';

import type { VideoLibraryItem, VideoNote } from './types';
import {
  addVideoNote,
  addVideoToLibrary,
  EMPTY_VIDEO_STATE,
  MAX_LIBRARY_ITEMS,
  MAX_NOTES,
  VIDEO_STORAGE_KEY,
  loadVideoState,
  removeVideoFromLibrary,
  removeVideoNote,
  saveVideoState,
  type VideoState,
} from './videoStorage';

const STATE: VideoState = {
  library: [libraryItem(1)],
  notes: [videoNote(1)],
  viewMode: 'line',
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('videoStorage', () => {
  it('round-trips the versioned library, notes and view preference', () => {
    saveVideoState(STATE);

    expect(loadVideoState()).toEqual(STATE);
    expect(JSON.parse(window.localStorage.getItem(VIDEO_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: 2,
    });
  });

  it('migrates v1 notes without videoId into titled notes', () => {
    window.localStorage.setItem(
      VIDEO_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          library: STATE.library,
          notes: [
            {
              id: 'note-legacy',
              videoId: 'aircAruvnKk',
              timestamp: 65,
              text: 'Review the layer transformation carefully.',
              createdAt: '2026-07-23T10:00:00.000Z',
            },
          ],
          viewMode: 'line',
        },
      }),
    );

    const loaded = loadVideoState();
    expect(loaded.notes[0]).toMatchObject({
      id: 'note-legacy',
      title: 'Review the layer transformation caref…',
      text: 'Review the layer transformation carefully.',
      timestamp: 65,
    });
    expect(loaded.notes[0]).not.toHaveProperty('videoId');
    expect(JSON.parse(window.localStorage.getItem(VIDEO_STORAGE_KEY) ?? '{}').version).toBe(2);
  });

  it('migrates the approved v0 names through to version 2', () => {
    window.localStorage.setItem(
      VIDEO_STORAGE_KEY,
      JSON.stringify({
        version: 0,
        savedVideos: STATE.library,
        savedNotes: [
          {
            id: 'note-0',
            videoId: '00000000000',
            timestamp: 12,
            text: 'Legacy note body',
            createdAt: '2026-07-23T10:00:00.000Z',
          },
        ],
        transcriptView: 'line',
      }),
    );

    const loaded = loadVideoState();
    expect(loaded.library).toEqual(STATE.library);
    expect(loaded.notes[0]).toMatchObject({
      title: 'Legacy note body',
      text: 'Legacy note body',
      timestamp: 12,
    });
    expect(JSON.parse(window.localStorage.getItem(VIDEO_STORAGE_KEY) ?? '{}').version).toBe(2);
  });

  it('rejects additions at the explicit library and note limits', () => {
    const fullState: VideoState = {
      library: Array.from({ length: MAX_LIBRARY_ITEMS }, (_, index) =>
        libraryItem(index),
      ),
      notes: Array.from({ length: MAX_NOTES }, (_, index) => videoNote(index)),
      viewMode: 'paragraph',
    };

    expect(addVideoToLibrary(fullState, libraryItem(999))).toBeNull();
    expect(addVideoNote(fullState, videoNote(999))).toBeNull();
  });

  it('removes library items without touching notes', () => {
    const next = removeVideoFromLibrary(STATE, STATE.library[0].id);
    expect(next.library).toHaveLength(0);
    expect(next.notes).toEqual(STATE.notes);
  });

  it('removes notes without touching library', () => {
    const next = removeVideoNote(STATE, STATE.notes[0].id);
    expect(next.notes).toHaveLength(0);
    expect(next.library).toEqual(STATE.library);
  });

  it('keeps the newest valid entries when persisted legacy data exceeds limits', () => {
    window.localStorage.setItem(
      VIDEO_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state: {
          library: Array.from({ length: MAX_LIBRARY_ITEMS + 1 }, (_, index) =>
            libraryItem(index),
          ),
          notes: Array.from({ length: MAX_NOTES + 1 }, (_, index) =>
            videoNote(index),
          ),
          viewMode: 'paragraph',
        },
      }),
    );

    const loaded = loadVideoState();

    expect(loaded.library).toHaveLength(MAX_LIBRARY_ITEMS);
    expect(loaded.notes).toHaveLength(MAX_NOTES);
    expect(loaded.library[0].id).toBe('video-0');
    expect(loaded.notes[0].id).toBe('note-0');
  });

  it('falls back safely for malformed data or blocked storage', () => {
    window.localStorage.setItem(VIDEO_STORAGE_KEY, '{broken');
    expect(loadVideoState()).toEqual(EMPTY_VIDEO_STATE);

    const blockedStorage = {
      getItem() {
        throw new DOMException('Denied', 'SecurityError');
      },
      setItem() {
        throw new DOMException('Denied', 'SecurityError');
      },
      removeItem() {},
      clear() {},
      key() {
        return null;
      },
      length: 0,
    } satisfies Storage;

    expect(loadVideoState(blockedStorage)).toEqual(EMPTY_VIDEO_STATE);
    expect(() => saveVideoState(STATE, blockedStorage)).not.toThrow();
  });
});

function libraryItem(index: number): VideoLibraryItem {
  return {
    id: `video-${index}`,
    title: `Technical video ${index}`,
    url: `https://youtu.be/${videoId(index)}`,
    videoId: videoId(index),
    source: 'youtube',
  };
}

function videoNote(index: number): VideoNote {
  return {
    id: `note-${index}`,
    title: `Review note ${index}`,
    text: `Review note ${index}.`,
    createdAt: '2026-07-23T10:00:00.000Z',
    timestamp: index,
  };
}

function videoId(index: number): string {
  return index.toString().padStart(11, '0');
}
