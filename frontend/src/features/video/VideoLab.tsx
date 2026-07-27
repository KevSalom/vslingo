import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react';

import {
  SAMPLE_TRANSCRIPT,
  SAMPLE_VIDEO_TITLE,
  SAMPLE_VIDEO_URL,
} from './fixture';
import { FixturePlayer } from './FixturePlayer';
import { findActiveSegmentIndex, formatTimestamp } from './sync';
import type {
  TranscriptResponse,
  VideoLibraryItem,
  VideoNote,
} from './types';
import { deriveNoteTitle } from './types';
import { fetchVideoTranscript } from './videoApi';
import { VideoFileTree } from './VideoFileTree';
import { useVideoLab } from './VideoLabContext';
import { VsCodeModal } from './VsCodeModal';
import {
  YouTubePlayer,
  type VideoPlayerHandle,
  type YouTubePlayerProps,
} from './YouTubePlayer';

type VideoPlayerComponent = ForwardRefExoticComponent<
  YouTubePlayerProps & RefAttributes<VideoPlayerHandle>
>;

type TranscriptLoadOptions = {
  signal?: AbortSignal;
};

type VideoLabProps = {
  loadTranscript?: (
    url: string,
    options?: TranscriptLoadOptions,
  ) => Promise<TranscriptResponse>;
  PlayerComponent?: VideoPlayerComponent;
};

type NoteDraftModal = {
  title: string;
  text: string;
  timestamp?: number;
};

export function VideoLab({
  loadTranscript = fetchVideoTranscript,
  PlayerComponent = YouTubePlayer,
}: VideoLabProps) {
  const { state: videoState, setViewMode, saveLibraryItem, saveNote, registerOpenVideo } =
    useVideoLab();
  const [url, setUrl] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [result, setResult] = useState<TranscriptResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [saveVideoOpen, setSaveVideoOpen] = useState(false);
  const [libraryTitle, setLibraryTitle] = useState('');
  const [noteDraft, setNoteDraft] = useState<NoteDraftModal | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [copyFlashId, setCopyFlashId] = useState<number | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const requestGenerationRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const scrollAnimRef = useRef<number>(0);
  const videoPanelRef = useRef<HTMLDivElement>(null);
  const [videoPanelHeight, setVideoPanelHeight] = useState(0);

  const openTranscript = useCallback(
    (transcript: TranscriptResponse, nextUrl: string, title?: string) => {
      setResult(transcript);
      setCurrentUrl(nextUrl);
      setUrl(nextUrl);
      setActiveIndex(-1);
      setPlaybackTime(0);
      setLibraryTitle(title ?? `Video ${transcript.video_id}`);
      setError(null);
      setStatus(null);
    },
    [],
  );

  const openFixture = useCallback((title = SAMPLE_VIDEO_TITLE) => {
    requestGenerationRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setIsLoading(false);
    openTranscript(SAMPLE_TRANSCRIPT, SAMPLE_VIDEO_URL, title);
  }, [openTranscript]);

  const requestTranscript = useCallback(
    async (nextUrl: string, title?: string) => {
      const generation = requestGenerationRef.current + 1;
      requestGenerationRef.current = generation;
      activeRequestRef.current?.abort();
      const controller = new AbortController();
      activeRequestRef.current = controller;
      setIsLoading(true);
      setError(null);
      setStatus(null);
      try {
        const transcript = await loadTranscript(nextUrl, {
          signal: controller.signal,
        });
        if (generation === requestGenerationRef.current) {
          openTranscript(transcript, nextUrl, title);
        }
      } catch (cause) {
        if (
          generation === requestGenerationRef.current &&
          !isAbortError(cause)
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'No se pudo cargar la transcripción. Usa la demo técnica.',
          );
        }
      } finally {
        if (generation === requestGenerationRef.current) {
          activeRequestRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [loadTranscript, openTranscript],
  );

  const handleOpenSavedVideo = useCallback(
    (item: VideoLibraryItem) => {
      if (item.source === 'fixture') {
        openFixture(item.title);
        return;
      }
      void requestTranscript(item.url, item.title);
    },
    [openFixture, requestTranscript],
  );

  useEffect(() => {
    registerOpenVideo(handleOpenSavedVideo);
    return () => registerOpenVideo(null);
  }, [handleOpenSavedVideo, registerOpenVideo]);

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
      activeRequestRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const el = videoPanelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setVideoPanelHeight(
          entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height,
        );
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [result]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const container = transcriptRef.current;
    if (!container) return;
    const element = container.querySelector<HTMLElement>(
      `[data-segment-index="${activeIndex}"]`,
    );
    if (!element) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const absoluteTop =
      elementRect.top - containerRect.top + container.scrollTop;
    const targetScroll =
      absoluteTop - container.clientHeight * 0.45 + elementRect.height / 2;

    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);

    const start = container.scrollTop;
    const change = targetScroll - start;
    const duration = 750;
    let startTime: number | null = null;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      container.scrollTop = start + change * ease;
      if (elapsed < duration) {
        scrollAnimRef.current = requestAnimationFrame(animate);
      }
    };
    scrollAnimRef.current = requestAnimationFrame(animate);
  }, [activeIndex, videoState.viewMode]);

  const handleTimeChange = useCallback(
    (seconds: number) => {
      setPlaybackTime(seconds);
      setActiveIndex(
        result ? findActiveSegmentIndex(result.segments, seconds) : -1,
      );
    },
    [result],
  );

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isLoading && url.trim()) {
      void requestTranscript(url.trim());
    }
  };

  const handleSeek = (seconds: number) => {
    playerRef.current?.seekTo(seconds);
    handleTimeChange(seconds);
  };

  const handleConfirmSaveVideo = () => {
    if (!result || !libraryTitle.trim()) {
      return;
    }
    const item: VideoLibraryItem = {
      id: createLocalId('video'),
      title: libraryTitle.trim(),
      url: currentUrl,
      videoId: result.video_id,
      source: result.source,
    };
    const message = saveLibraryItem(item);
    if (message) {
      setStatus(message);
    } else {
      setStatus('Video guardado en este navegador.');
    }
    setSaveVideoOpen(false);
  };

  const handleConfirmSaveNote = () => {
    if (!noteDraft) {
      return;
    }
    const title = noteDraft.title.trim();
    const text = noteDraft.text.trim();
    if (!title || !text) {
      return;
    }
    const note: VideoNote = {
      id: createLocalId('note'),
      title,
      text,
      createdAt: new Date().toISOString(),
      ...(noteDraft.timestamp !== undefined
        ? { timestamp: noteDraft.timestamp }
        : {}),
    };
    const message = saveNote(note);
    if (message) {
      setStatus(message);
    } else {
      setStatus('Nota guardada en este navegador.');
    }
    setNoteDraft(null);
  };

  const handleCopySegment = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFlashId(index);
      window.setTimeout(() => {
        setCopyFlashId((current) => (current === index ? null : current));
      }, 1200);
    } catch {
      setStatus('No se pudo copiar al portapapeles.');
    }
  };

  return (
    <section aria-labelledby="video-lab-title" className="video-lab mx-auto w-full max-w-[92rem]">
      <header className="video-lab-header">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="video-lab-kicker">
            Video / playback.clock
          </p>
          <div className="flex items-center gap-2">
            <button
              className="video-explorer-toggle"
              onClick={() => setExplorerOpen(true)}
              type="button"
            >
              Explorer
            </button>
            <span className="video-lab-meta">
              Sincronización cada 200 ms
            </span>
          </div>
        </div>
        <h1
          className="video-lab-title-heading"
          id="video-lab-title"
          tabIndex={-1}
        >
          Video Lab
        </h1>
        <p className="video-lab-description">
          Estudia inglés técnico con subtítulos navegables. Biblioteca y notas viven
          en el explorador lateral; aquí sólo el material de estudio.
        </p>
      </header>

      <form
        aria-busy={isLoading}
        className="video-url-form"
        onSubmit={handleSubmit}
      >
        <label className="video-url-label" htmlFor="video-url">
          URL de YouTube
        </label>
        <div className="mt-2 flex flex-col gap-2 lg:flex-row">
          <input
            className="video-url-input"
            disabled={isLoading}
            id="video-url"
            onChange={(event) => {
              setUrl(event.currentTarget.value);
              setError(null);
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            type="url"
            value={url}
          />
          <div className="flex items-center gap-2">
            <button
              className="video-url-submit"
              disabled={isLoading || !url.trim()}
              type="submit"
            >
              {isLoading ? 'Buscando subtítulos…' : 'Cargar transcripción'}
            </button>
            <button
              aria-label="Guardar video"
              className="video-url-bookmark"
              disabled={!result}
              onClick={() => setSaveVideoOpen(true)}
              title="Guardar video"
              type="button"
            >
              <BookmarkIcon />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="video-url-fixture"
            onClick={() => openFixture()}
            type="button"
          >
            Abrir demo técnica
          </button>
        </div>
      </form>

      {error ? (
        <div
          className="video-url-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {status ? (
        <p
          aria-live="polite"
          className="video-url-status"
        >
          {status}
        </p>
      ) : null}

      {result ? (
        <div className="mt-6">
          <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)] lg:items-start">
            <div
              className="video-player-frame"
              ref={videoPanelRef}
            >
              <div className="relative aspect-video w-full overflow-hidden [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0">
                {result.source === 'fixture' ? (
                  <FixturePlayer
                    key={`fixture-${result.video_id}`}
                    onPlayerError={setError}
                    onTimeChange={handleTimeChange}
                    ref={playerRef}
                    videoId={result.video_id}
                  />
                ) : (
                  <PlayerComponent
                    key={result.video_id}
                    onPlayerError={setError}
                    onTimeChange={handleTimeChange}
                    ref={playerRef}
                    videoId={result.video_id}
                  />
                )}
              </div>
              <div className="video-player-bar">
                <span className="video-player-playhead">
                  playhead {formatTimestamp(playbackTime)}
                </span>
                <span
                  className={`video-player-source-badge ${
                    result.source === 'fixture'
                      ? 'video-player-source-badge--fixture'
                      : 'video-player-source-badge--youtube'
                  }`}
                >
                  {result.source === 'fixture' ? 'Fixture local' : 'YouTube'}
                </span>
              </div>
            </div>

            <section
              className="video-transcript-panel"
              style={
                videoPanelHeight > 0
                  ? { maxHeight: `${videoPanelHeight}px` }
                  : undefined
              }
            >
              <header className="video-transcript-header">
                <div>
                  <p className="video-transcript-kicker">
                    Transcript
                  </p>
                  <h2 className="video-transcript-count">
                    {result.segments.length} segmentos
                  </h2>
                </div>
                <div className="video-view-toggle">
                  <button
                    aria-pressed={videoState.viewMode === 'paragraph'}
                    className={`video-view-toggle-btn${videoState.viewMode === 'paragraph' ? ' is-active' : ''}`}
                    onClick={() => setViewMode('paragraph')}
                    type="button"
                  >
                    Vista párrafo
                  </button>
                  <button
                    aria-pressed={videoState.viewMode === 'line'}
                    className={`video-view-toggle-btn${videoState.viewMode === 'line' ? ' is-active' : ''}`}
                    onClick={() => setViewMode('line')}
                    type="button"
                  >
                    Vista línea a línea
                  </button>
                </div>
              </header>

              <div
                className="video-transcript-scroll"
                ref={transcriptRef}
                style={{
                  maskImage:
                    'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
                  WebkitMaskImage:
                    'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
                }}
              >
                {videoState.viewMode === 'paragraph' ? (
                  <div className="video-paragraph-view">
                    {result.segments.map((segment, index) => {
                      const isActive =
                        activeIndex >= 0 && index <= activeIndex + 1;
                      return (
                        <span
                          aria-current={isActive ? 'true' : undefined}
                          className={`video-paragraph-word${isActive ? ' is-active' : ''}`}
                          data-segment-index={index}
                          key={`${segment.start}-${index}`}
                          onClick={() => handleSeek(segment.start)}
                        >
                          {segment.text}{' '}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <ol className="space-y-2">
                    {result.segments.map((segment, index) => {
                      const isActive =
                        activeIndex >= 0 && index <= activeIndex + 1;
                      return (
                        <li
                          className={`video-line-row group${isActive ? ' is-active' : ''}`}
                          data-segment-index={index}
                          key={`${segment.start}-${index}`}
                        >
                          <span className="video-line-timestamp">
                            {formatTimestamp(segment.start)}
                          </span>
                          <button
                            aria-current={isActive ? 'true' : undefined}
                            aria-label={segment.text}
                            className="video-line-text"
                            onClick={() => handleSeek(segment.start)}
                            type="button"
                          >
                            {segment.text}
                          </button>
                          <div className="video-line-actions flex items-start gap-0.5 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                            <button
                              aria-label={`Copiar frase: ${segment.text}`}
                              className="video-line-icon"
                              onClick={() =>
                                void handleCopySegment(segment.text, index)
                              }
                              type="button"
                            >
                              {copyFlashId === index ? (
                                <CheckIcon />
                              ) : (
                                <CopyIcon />
                              )}
                            </button>
                            <button
                              aria-label={`Guardar frase como nota: ${segment.text}`}
                              className="video-line-icon"
                              onClick={() =>
                                setNoteDraft({
                                  title: deriveNoteTitle(
                                    segment.text,
                                    segment.start,
                                  ),
                                  text: segment.text,
                                  timestamp: segment.start,
                                })
                              }
                              type="button"
                            >
                              <NoteIcon />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {saveVideoOpen ? (
        <VsCodeModal
          confirmDisabled={!libraryTitle.trim()}
          confirmLabel="Guardar"
          description="Se almacenará como fichero en videos/ del explorador."
          onCancel={() => setSaveVideoOpen(false)}
          onConfirm={handleConfirmSaveVideo}
          title="Guardar video"
        >
          <label className="vsc-field-label" htmlFor="video-library-title">
            Nombre del video
          </label>
          <input
            className="vsc-field-input"
            id="video-library-title"
            maxLength={200}
            onChange={(event) => setLibraryTitle(event.target.value)}
            value={libraryTitle}
          />
        </VsCodeModal>
      ) : null}

      {noteDraft ? (
        <VsCodeModal
          confirmDisabled={!noteDraft.title.trim() || !noteDraft.text.trim()}
          confirmLabel="Guardar nota"
          description="La nota no depende de ningún video guardado."
          onCancel={() => setNoteDraft(null)}
          onConfirm={handleConfirmSaveNote}
          title="Guardar frase como nota"
        >
          <label className="vsc-field-label" htmlFor="video-phrase-title">
            Nombre
          </label>
          <input
            className="vsc-field-input"
            id="video-phrase-title"
            maxLength={200}
            onChange={(event) => {
              const value = event.target.value;
              setNoteDraft((current) =>
                current ? { ...current, title: value } : null,
              );
            }}
            value={noteDraft.title}
          />
          <label className="vsc-field-label" htmlFor="video-phrase-body">
            Contenido
          </label>
          <textarea
            className="vsc-field-textarea"
            id="video-phrase-body"
            maxLength={2_000}
            onChange={(event) => {
              const value = event.target.value;
              setNoteDraft((current) =>
                current ? { ...current, text: value } : null,
              );
            }}
            rows={4}
            value={noteDraft.text}
          />
        </VsCodeModal>
      ) : null}

      {explorerOpen ? (
        <div className="video-explorer-drawer-root">
          <button
            aria-label="Cerrar explorador"
            className="video-explorer-drawer-backdrop"
            onClick={() => setExplorerOpen(false)}
            type="button"
          />
          <aside
            aria-label="Explorador de Video Lab"
            className="video-explorer-drawer"
          >
            <div className="video-explorer-drawer-header">
              <p className="explorer-title">Explorer</p>
              <button
                aria-label="Cerrar"
                className="video-tree-action"
                onClick={() => setExplorerOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <VideoFileTree
              compact
              onRequestClose={() => setExplorerOpen(false)}
            />
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError';
}

function createLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16" width="14" height="14">
      <rect height="9" rx="1" stroke="currentColor" strokeWidth="1.3" width="9" x="5" y="2" />
      <path
        d="M3 5.5h-.5A1 1 0 0 0 1.5 6.5v6A1 1 0 0 0 2.5 13.5h6a1 1 0 0 0 1-1V12"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16" width="14" height="14">
      <path
        d="m3.5 8.5 2.8 2.8 6.2-6.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16" width="14" height="14">
      <path
        d="M3.5 2.75h6.2L12.5 5.6v7.65h-9z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
      <path d="M9.5 2.9v2.8h2.8M5.5 8.5h5M5.5 10.75h3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16" width="14" height="14">
      <path
        d="M3.75 3A1.25 1.25 0 0 1 5 1.75h6A1.25 1.25 0 0 1 12.25 3v11.25l-4.25-2.5-4.25 2.5V3z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}
