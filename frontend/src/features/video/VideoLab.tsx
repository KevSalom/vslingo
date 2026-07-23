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
  TranscriptViewMode,
  VideoLibraryItem,
  VideoNote,
} from './types';
import { fetchVideoTranscript } from './videoApi';
import {
  addVideoNote,
  addVideoToLibrary,
  EMPTY_VIDEO_STATE,
  loadVideoState,
  MAX_LIBRARY_ITEMS,
  MAX_NOTES,
  saveVideoState,
  type VideoState,
} from './videoStorage';
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

export function VideoLab({
  loadTranscript = fetchVideoTranscript,
  PlayerComponent = YouTubePlayer,
}: VideoLabProps) {
  const [url, setUrl] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [result, setResult] = useState<TranscriptResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [libraryTitle, setLibraryTitle] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [videoState, setVideoState] = useState<VideoState>(EMPTY_VIDEO_STATE);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const requestGenerationRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setVideoState(loadVideoState());
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (storageReady) {
      saveVideoState(videoState);
    }
  }, [storageReady, videoState]);

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
      activeRequestRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }
    const element = transcriptRef.current?.querySelector<HTMLElement>(
      `[data-segment-index="${activeIndex}"]`,
    );
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeIndex, videoState.viewMode]);

  const openTranscript = useCallback(
    (transcript: TranscriptResponse, nextUrl: string, title?: string) => {
      setResult(transcript);
      setCurrentUrl(nextUrl);
      setUrl(nextUrl);
      setActiveIndex(-1);
      setPlaybackTime(0);
      setLibraryTitle(title ?? `Video ${transcript.video_id}`);
      setNoteDraft('');
      setError(null);
      setStatus(null);
    },
    [],
  );

  const handleTimeChange = useCallback(
    (seconds: number) => {
      setPlaybackTime(seconds);
      setActiveIndex(
        result ? findActiveSegmentIndex(result.segments, seconds) : -1,
      );
    },
    [result],
  );

  const openFixture = (title = SAMPLE_VIDEO_TITLE) => {
    requestGenerationRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setIsLoading(false);
    openTranscript(SAMPLE_TRANSCRIPT, SAMPLE_VIDEO_URL, title);
  };

  const requestTranscript = async (nextUrl: string, title?: string) => {
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
  };

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

  const handleViewMode = (viewMode: TranscriptViewMode) => {
    setVideoState((current) => ({ ...current, viewMode }));
  };

  const handleSaveVideo = () => {
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
    const nextState = addVideoToLibrary(videoState, item);
    if (nextState === null) {
      setStatus(`La biblioteca admite hasta ${MAX_LIBRARY_ITEMS} videos.`);
      return;
    }
    setVideoState(nextState);
    setStatus('Video guardado en este navegador.');
  };

  const handleOpenSavedVideo = (item: VideoLibraryItem) => {
    if (item.source === 'fixture') {
      openFixture(item.title);
      return;
    }
    void requestTranscript(item.url, item.title);
  };

  const handleRemoveSavedVideo = (id: string) => {
    setVideoState((current) => ({
      ...current,
      library: current.library.filter((item) => item.id !== id),
    }));
  };

  const handleSaveNote = () => {
    if (!result || !noteDraft.trim()) {
      return;
    }
    const note: VideoNote = {
      id: createLocalId('note'),
      videoId: result.video_id,
      timestamp: playbackTime,
      text: noteDraft.trim(),
      createdAt: new Date().toISOString(),
    };
    const nextState = addVideoNote(videoState, note);
    if (nextState === null) {
      setStatus(`Puedes guardar hasta ${MAX_NOTES} notas locales.`);
      return;
    }
    setVideoState(nextState);
    setNoteDraft('');
    setStatus(`Nota guardada en ${formatTimestamp(playbackTime)}.`);
  };

  const visibleNotes = result
    ? videoState.notes.filter((note) => note.videoId === result.video_id)
    : [];

  return (
    <section aria-labelledby="video-lab-title" className="mx-auto w-full max-w-6xl">
      <header className="mb-6 border-b border-slate-800 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Video / playback.clock
          </p>
          <span className="font-mono text-xs text-slate-500">
            Sincronización cada 200 ms
          </span>
        </div>
        <h1
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
          id="video-lab-title"
        >
          Video Lab
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
          Estudia inglés técnico con subtítulos navegables. El reloj sigue el video,
          cada frase permite saltar al instante exacto y tus notas permanecen en este
          navegador.
        </p>
      </header>

      <form
        aria-busy={isLoading}
        className="rounded-xl border border-slate-800 bg-slate-950/45 p-4 sm:p-5"
        onSubmit={handleSubmit}
      >
        <label className="text-sm font-semibold text-slate-200" htmlFor="video-url">
          URL de YouTube
        </label>
        <div className="mt-2 flex flex-col gap-2 lg:flex-row">
          <input
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-slate-100 outline-none placeholder:text-slate-600 focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30"
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
          <button
            className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            disabled={isLoading || !url.trim()}
            type="submit"
          >
            {isLoading ? 'Buscando subtítulos…' : 'Cargar transcripción'}
          </button>
          <button
            className="rounded-lg border border-violet-400/40 bg-violet-400/10 px-4 py-2.5 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-400/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
            onClick={() => openFixture()}
            type="button"
          >
            Abrir demo técnica
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Si YouTube limita el acceso a subtítulos, la demo incluida conserva todo el
          recorrido de práctica.
        </p>
      </form>

      {error ? (
        <div
          className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {status ? (
        <p
          aria-live="polite"
          className="mt-4 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-200"
        >
          {status}
        </p>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-5">
          <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-black shadow-xl shadow-black/20">
              <div className="relative aspect-video">
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
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950 px-4 py-3">
                <span className="font-mono text-xs text-slate-400">
                  playhead {formatTimestamp(playbackTime)}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] ${
                    result.source === 'fixture'
                      ? 'border-violet-400/30 bg-violet-400/10 text-violet-200'
                      : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200'
                  }`}
                >
                  {result.source === 'fixture' ? 'Fixture local' : 'YouTube'}
                </span>
              </div>
            </div>

            <section className="flex min-h-96 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/55">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-cyan-300">
                    Transcript
                  </p>
                  <h2 className="mt-1 text-sm font-semibold text-slate-100">
                    {result.segments.length} segmentos
                  </h2>
                </div>
                <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-1">
                  <button
                    aria-pressed={videoState.viewMode === 'paragraph'}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                      videoState.viewMode === 'paragraph'
                        ? 'bg-cyan-400 text-slate-950'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                    onClick={() => handleViewMode('paragraph')}
                    type="button"
                  >
                    Vista párrafo
                  </button>
                  <button
                    aria-pressed={videoState.viewMode === 'line'}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                      videoState.viewMode === 'line'
                        ? 'bg-cyan-400 text-slate-950'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                    onClick={() => handleViewMode('line')}
                    type="button"
                  >
                    Vista línea a línea
                  </button>
                </div>
              </header>

              <div
                className="max-h-[31rem] flex-1 overflow-y-auto px-4 py-5 [scrollbar-color:theme(colors.slate.600)_transparent]"
                ref={transcriptRef}
              >
                {videoState.viewMode === 'paragraph' ? (
                  <div className="text-left text-base leading-8 text-slate-400">
                    {result.segments.map((segment, index) => {
                      const isActive = index === activeIndex;
                      const isPast = index < activeIndex;
                      return (
                        <button
                          aria-current={isActive ? 'true' : undefined}
                          aria-label={segment.text}
                          className={`mr-1 inline rounded px-1 py-0.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
                            isActive
                              ? 'bg-cyan-300 text-slate-950 shadow-sm shadow-cyan-300/20'
                              : isPast
                                ? 'text-slate-200'
                                : 'hover:bg-slate-800 hover:text-white'
                          }`}
                          data-segment-index={index}
                          key={`${segment.start}-${index}`}
                          onClick={() => handleSeek(segment.start)}
                          type="button"
                        >
                          {segment.text}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <ol className="space-y-2">
                    {result.segments.map((segment, index) => {
                      const isActive = index === activeIndex;
                      return (
                        <li
                          className={`grid grid-cols-[3.25rem_1fr] gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                            isActive
                              ? 'border-cyan-300/50 bg-cyan-300/10'
                              : 'border-transparent hover:border-slate-700 hover:bg-slate-900'
                          }`}
                          data-segment-index={index}
                          key={`${segment.start}-${index}`}
                        >
                          <span className="pt-0.5 font-mono text-xs text-cyan-300">
                            {formatTimestamp(segment.start)}
                          </span>
                          <button
                            aria-current={isActive ? 'true' : undefined}
                            aria-label={segment.text}
                            className="text-left text-sm leading-6 text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                            onClick={() => handleSeek(segment.start)}
                            type="button"
                          >
                            {segment.text}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </section>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4 sm:p-5">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-cyan-300">
                Library / local
              </p>
              <label
                className="mt-3 block text-sm font-semibold text-slate-200"
                htmlFor="video-library-title"
              >
                Nombre en biblioteca
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30"
                  id="video-library-title"
                  maxLength={200}
                  onChange={(event) => setLibraryTitle(event.currentTarget.value)}
                  value={libraryTitle}
                />
                <button
                  className="rounded-lg border border-cyan-400/40 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  disabled={!libraryTitle.trim()}
                  onClick={handleSaveVideo}
                  type="button"
                >
                  Guardar en biblioteca
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4 sm:p-5">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-violet-300">
                Notes / {formatTimestamp(playbackTime)}
              </p>
              <label
                className="mt-3 block text-sm font-semibold text-slate-200"
                htmlFor="video-note"
              >
                Nota en {formatTimestamp(playbackTime)}
              </label>
              <div className="mt-2 flex gap-2">
                <textarea
                  className="min-h-20 min-w-0 flex-1 resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus-visible:border-violet-300 focus-visible:ring-2 focus-visible:ring-violet-300/30"
                  id="video-note"
                  maxLength={2_000}
                  onChange={(event) => setNoteDraft(event.currentTarget.value)}
                  placeholder="Anota vocabulario, una idea o una pregunta…"
                  value={noteDraft}
                />
                <button
                  className="self-end rounded-lg border border-violet-400/40 px-3 py-2 text-sm font-semibold text-violet-200 hover:bg-violet-400/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
                  disabled={!noteDraft.trim()}
                  onClick={handleSaveNote}
                  type="button"
                >
                  Guardar nota
                </button>
              </div>
            </div>
          </section>

          {visibleNotes.length > 0 ? (
            <section aria-labelledby="video-notes-title">
              <h2 className="text-base font-semibold" id="video-notes-title">
                Notas de este video
              </h2>
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {visibleNotes.map((note) => (
                  <li
                    className="rounded-lg border border-slate-800 bg-slate-950/45 p-4"
                    key={note.id}
                  >
                    <button
                      className="font-mono text-xs text-violet-300 hover:text-violet-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
                      onClick={() => handleSeek(note.timestamp)}
                      type="button"
                    >
                      Ir a {formatTimestamp(note.timestamp)}
                    </button>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{note.text}</p>
                    <button
                      className="mt-3 text-xs text-slate-500 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
                      onClick={() =>
                        setVideoState((current) => ({
                          ...current,
                          notes: current.notes.filter((item) => item.id !== note.id),
                        }))
                      }
                      type="button"
                    >
                      Eliminar nota
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="video-library-title" className="mt-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">
              Saved locally
            </p>
            <h2 className="mt-1 text-base font-semibold" id="video-library-title">
              Mi biblioteca
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-500">
            {videoState.library.length} guardados
          </span>
        </div>
        {videoState.library.length > 0 ? (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {videoState.library.map((item) => (
              <li
                className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"
                key={item.id}
              >
                <button
                  className="w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  onClick={() => handleOpenSavedVideo(item)}
                  type="button"
                >
                  <span className="block text-sm font-semibold text-slate-100">
                    {item.title}
                  </span>
                  <span className="mt-1 block font-mono text-xs text-slate-500">
                    {item.videoId}
                  </span>
                </button>
                <button
                  aria-label={`Eliminar ${item.title} de la biblioteca`}
                  className="mt-3 text-xs text-slate-500 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
                  onClick={() => handleRemoveSavedVideo(item.id)}
                  type="button"
                >
                  Eliminar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-slate-800 px-4 py-5 text-sm text-slate-500">
            Guarda un video para volver a estudiarlo sin perder tus notas.
          </p>
        )}
      </section>
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
