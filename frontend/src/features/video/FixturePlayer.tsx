import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { SAMPLE_TRANSCRIPT } from './fixture';
import { PLAYBACK_POLL_INTERVAL_MS } from './playbackClock';
import { formatTimestamp } from './sync';
import type { YouTubePlayerProps, VideoPlayerHandle } from './YouTubePlayer';

const FIXTURE_DURATION_SECONDS = Math.max(
  ...SAMPLE_TRANSCRIPT.segments.map(
    (segment) => segment.start + segment.duration,
  ),
);
const FIXTURE_TICK_SECONDS = PLAYBACK_POLL_INTERVAL_MS / 1_000;

/** A network-free clock that preserves sync, seek, views and notes in the demo. */
export const FixturePlayer = forwardRef<VideoPlayerHandle, YouTubePlayerProps>(
  function FixturePlayer({ onTimeChange }, forwardedRef) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const currentTimeRef = useRef(0);
    const onTimeChangeRef = useRef(onTimeChange);

    useEffect(() => {
      onTimeChangeRef.current = onTimeChange;
    }, [onTimeChange]);

    const seekTo = useCallback((seconds: number) => {
      const bounded = Math.min(
        FIXTURE_DURATION_SECONDS,
        Math.max(0, seconds),
      );
      currentTimeRef.current = bounded;
      setCurrentTime(bounded);
      onTimeChangeRef.current(bounded);
    }, []);

    useImperativeHandle(forwardedRef, () => ({ seekTo }), [seekTo]);

    useEffect(() => {
      if (!isPlaying) {
        return;
      }

      const timer = setInterval(() => {
        const next = Math.min(
          FIXTURE_DURATION_SECONDS,
          currentTimeRef.current + FIXTURE_TICK_SECONDS,
        );
        currentTimeRef.current = next;
        setCurrentTime(next);
        onTimeChangeRef.current(next);
        if (next >= FIXTURE_DURATION_SECONDS) {
          setIsPlaying(false);
        }
      }, PLAYBACK_POLL_INTERVAL_MS);

      return () => clearInterval(timer);
    }, [isPlaying]);

    return (
      <div
        aria-label="Reproductor de demo local"
        className="absolute inset-0 flex flex-col justify-between bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_45%),linear-gradient(145deg,#020617,#172033)] p-5 text-slate-100 sm:p-7"
        role="region"
      >
        <div>
          <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-violet-300">
            Demo local / deterministic clock
          </p>
          <h2 className="mt-3 max-w-md text-xl font-semibold tracking-tight sm:text-3xl">
            Neural network signal path
          </h2>
          <p className="mt-2 max-w-md text-xs leading-5 text-slate-400 sm:text-sm">
            Este simulador no carga YouTube. Conserva el recorrido de sincronización,
            seek, vistas y notas cuando la red o el proveedor no están disponibles.
          </p>
        </div>

        <div className="space-y-3">
          <div aria-hidden="true" className="flex h-12 items-end gap-1.5">
            {[35, 58, 82, 48, 70, 42, 88, 62, 76, 50, 68, 38].map(
              (height, index) => (
                <span
                  className={`w-full rounded-t-sm ${
                    index / 12 <= currentTime / FIXTURE_DURATION_SECONDS
                      ? 'bg-cyan-300'
                      : 'bg-slate-700'
                  }`}
                  key={`${height}-${index}`}
                  style={{ height: `${height}%` }}
                />
              ),
            )}
          </div>
          <input
            aria-label="Posición de la demo local"
            className="w-full accent-cyan-300"
            max={FIXTURE_DURATION_SECONDS}
            min={0}
            onChange={(event) => seekTo(Number(event.currentTarget.value))}
            step={0.1}
            type="range"
            value={currentTime}
          />
          <div className="flex items-center justify-between gap-3">
            <button
              className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
              onClick={() => {
                if (currentTimeRef.current >= FIXTURE_DURATION_SECONDS) {
                  seekTo(0);
                }
                setIsPlaying((playing) => !playing);
              }}
              type="button"
            >
              {isPlaying ? 'Pausar demo local' : 'Reproducir demo local'}
            </button>
            <span className="font-mono text-xs text-slate-300">
              {formatTimestamp(currentTime)} /{' '}
              {formatTimestamp(FIXTURE_DURATION_SECONDS)}
            </span>
          </div>
        </div>
      </div>
    );
  },
);
