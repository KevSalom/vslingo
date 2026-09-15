import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { TranscriptViewMode, VideoLibraryItem, VideoNote } from './types';
import {
  deleteNoteHistory,
  HistoryRequestError,
  saveNoteHistory,
  updateNoteHistory,
} from '../../shared/history/historyClient';
import {
  addVideoNote,
  addVideoToLibrary,
  EMPTY_VIDEO_STATE,
  loadVideoState,
  MAX_LIBRARY_ITEMS,
  MAX_NOTES,
  removeVideoFromLibrary,
  removeVideoNote,
  saveVideoState,
  updateVideoNote,
  type VideoState,
} from './videoStorage';

type OpenVideoHandler = (item: VideoLibraryItem) => void;

type VideoLabContextValue = {
  storageReady: boolean;
  syncMessage: string | null;
  state: VideoState;
  setViewMode: (viewMode: TranscriptViewMode) => void;
  saveLibraryItem: (item: VideoLibraryItem) => string | null;
  removeLibraryItem: (id: string) => void;
  saveNote: (note: VideoNote) => string | null;
  editNote: (
    id: string,
    patch: Pick<VideoNote, 'title' | 'text'> & { timestamp?: number },
  ) => void;
  deleteNote: (id: string) => void;
  openLibraryItem: (item: VideoLibraryItem) => void;
  registerOpenVideo: (handler: OpenVideoHandler | null) => void;
};

const VideoLabContext = createContext<VideoLabContextValue | null>(null);

export function VideoLabProvider({ children }: { children: ReactNode }) {
  const [storageReady, setStorageReady] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [state, setState] = useState<VideoState>(EMPTY_VIDEO_STATE);
  const stateRef = useRef(state);
  const openVideoRef = useRef<OpenVideoHandler | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setState(loadVideoState());
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (storageReady) {
      saveVideoState(state);
    }
  }, [storageReady, state]);

  const setViewMode = useCallback((viewMode: TranscriptViewMode) => {
    setState((current) => ({ ...current, viewMode }));
  }, []);

  const saveLibraryItem = useCallback((item: VideoLibraryItem) => {
    const next = addVideoToLibrary(stateRef.current, item);
    if (next === null) {
      return `La biblioteca admite hasta ${MAX_LIBRARY_ITEMS} videos.`;
    }
    setState(next);
    return null;
  }, []);

  const removeLibraryItem = useCallback((id: string) => {
    setState((current) => removeVideoFromLibrary(current, id));
  }, []);

  const saveNote = useCallback((note: VideoNote) => {
    const next = addVideoNote(stateRef.current, note);
    if (next === null) {
      return `Puedes guardar hasta ${MAX_NOTES} notas locales.`;
    }
    setState(next);
    return null;
  }, []);

  const editNote = useCallback(
    (
      id: string,
      patch: Pick<VideoNote, 'title' | 'text'> & { timestamp?: number },
    ) => {
      const existing = stateRef.current.notes.find((note) => note.id === id);
      setState((current) => updateVideoNote(current, id, patch));
      if (existing?.version === undefined) return;
      setSyncMessage('Guardando cambios…');
      void updateNoteHistory(id, { ...patch, version: existing.version })
        .then((saved) => {
          setState((current) => updateVideoNote(current, id, {
            title: saved.title,
            text: saved.text,
            ...(saved.timestamp !== null ? { timestamp: saved.timestamp } : {}),
            version: saved.version,
          }));
          setSyncMessage('Nota guardada en tu cuenta.');
        })
        .catch((error: unknown) => {
          if (error instanceof HistoryRequestError && error.code === 'note_conflict') {
            const copyId = createConflictCopyId();
            void saveNoteHistory({
              client_id: copyId,
              title: conflictCopyTitle(patch.title),
              text: patch.text,
              ...(patch.timestamp !== undefined ? { timestamp: patch.timestamp } : {}),
            }).then((saved) => {
              setState((current) => {
                const withoutOriginal = removeVideoNote(current, id);
                return addVideoNote(withoutOriginal, {
                  id: saved.id,
                  title: saved.title,
                  text: saved.text,
                  createdAt: saved.created_at,
                  ...(saved.timestamp !== null ? { timestamp: saved.timestamp } : {}),
                  version: saved.version,
                }) ?? withoutOriginal;
              });
              setSyncMessage('Había cambios en otro dispositivo. Guardamos tu versión como una copia separada.');
            }).catch(() => {
              setSyncMessage('Había cambios en otro dispositivo. Tu versión sigue guardada localmente.');
            });
            return;
          }
          setSyncMessage(
            'No se pudieron sincronizar los cambios. La copia local sigue disponible.',
          );
        });
    },
    [],
  );

  const deleteNote = useCallback((id: string) => {
    const existing = stateRef.current.notes.find((note) => note.id === id);
    setState((current) => removeVideoNote(current, id));
    if (existing?.version === undefined) return;
    setSyncMessage('Eliminando nota…');
    void deleteNoteHistory(id)
      .then(() => setSyncMessage('Nota eliminada.'))
      .catch(() => setSyncMessage('La nota se quitó de este dispositivo, pero no de tu cuenta.'));
  }, []);

  const registerOpenVideo = useCallback((handler: OpenVideoHandler | null) => {
    openVideoRef.current = handler;
  }, []);

  const openLibraryItem = useCallback((item: VideoLibraryItem) => {
    openVideoRef.current?.(item);
  }, []);

  const value = useMemo(
    () => ({
      storageReady,
      syncMessage,
      state,
      setViewMode,
      saveLibraryItem,
      removeLibraryItem,
      saveNote,
      editNote,
      deleteNote,
      openLibraryItem,
      registerOpenVideo,
    }),
    [
      storageReady,
      syncMessage,
      state,
      setViewMode,
      saveLibraryItem,
      removeLibraryItem,
      saveNote,
      editNote,
      deleteNote,
      openLibraryItem,
      registerOpenVideo,
    ],
  );

  return (
    <VideoLabContext.Provider value={value}>{children}</VideoLabContext.Provider>
  );
}

function createConflictCopyId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `note-${crypto.randomUUID()}`;
  }
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function conflictCopyTitle(title: string): string {
  const suffix = ' (copia)';
  return `${title.slice(0, 200 - suffix.length).trimEnd()}${suffix}`;
}

export function useVideoLab(): VideoLabContextValue {
  const context = useContext(VideoLabContext);
  if (!context) {
    throw new Error('useVideoLab must be used within VideoLabProvider');
  }
  return context;
}
