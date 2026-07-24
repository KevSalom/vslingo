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
      setState((current) => updateVideoNote(current, id, patch));
    },
    [],
  );

  const deleteNote = useCallback((id: string) => {
    setState((current) => removeVideoNote(current, id));
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

export function useVideoLab(): VideoLabContextValue {
  const context = useContext(VideoLabContext);
  if (!context) {
    throw new Error('useVideoLab must be used within VideoLabProvider');
  }
  return context;
}
