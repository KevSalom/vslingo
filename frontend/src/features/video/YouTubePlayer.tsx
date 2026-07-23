import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import { createPlaybackClock, type PlaybackClock } from './playbackClock';

export const YOUTUBE_API_LOAD_TIMEOUT_MS = 10_000;

export type VideoPlayerHandle = {
  seekTo: (seconds: number) => void;
};

export type YouTubePlayerProps = {
  videoId: string;
  onTimeChange: (seconds: number) => void;
  onPlayerError?: (message: string) => void;
};

type PlayerStateEvent = { data: number };
type PlayerErrorEvent = { data: number };

type YouTubePlayerInstance = {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  destroy: () => void;
};

type YouTubeNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: {
        playsinline: number;
        rel: number;
        modestbranding: number;
      };
      events: {
        onStateChange: (event: PlayerStateEvent) => void;
        onError: (event: PlayerErrorEvent) => void;
      };
    },
  ) => YouTubePlayerInstance;
};

type YouTubeWindow = Window &
  typeof globalThis & {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  };

const YOUTUBE_API_SCRIPT_SELECTOR = 'script[data-vslingo-youtube-api]';
let apiPromise: Promise<YouTubeNamespace> | null = null;
let apiReady = false;

export const YouTubePlayer = forwardRef<VideoPlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer(
    { videoId, onTimeChange, onPlayerError },
    forwardedRef,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<YouTubePlayerInstance | null>(null);
    const onTimeChangeRef = useRef(onTimeChange);
    const onPlayerErrorRef = useRef(onPlayerError);

    useEffect(() => {
      onTimeChangeRef.current = onTimeChange;
      onPlayerErrorRef.current = onPlayerError;
    }, [onPlayerError, onTimeChange]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        seekTo(seconds: number) {
          playerRef.current?.seekTo(seconds, true);
        },
      }),
      [],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      let disposed = false;
      let clock: PlaybackClock | null = null;

      void loadYouTubeApi()
        .then((youtube) => {
          if (disposed) {
            return;
          }

          const player = new youtube.Player(container, {
            videoId,
            playerVars: {
              playsinline: 1,
              rel: 0,
              modestbranding: 1,
            },
            events: {
              onStateChange(event) {
                if (event.data === 1) {
                  clock?.start();
                } else {
                  clock?.stop();
                }
              },
              onError() {
                clock?.stop();
                onPlayerErrorRef.current?.(
                  'No se pudo reproducir este video de YouTube.',
                );
              },
            },
          });
          playerRef.current = player;
          clock = createPlaybackClock(
            () => player.getCurrentTime(),
            (seconds) => onTimeChangeRef.current(seconds),
          );
        })
        .catch(() => {
          if (!disposed) {
            onPlayerErrorRef.current?.(
              'No se pudo inicializar el reproductor de YouTube.',
            );
          }
        });

      return () => {
        disposed = true;
        clock?.stop();
        playerRef.current?.destroy();
        playerRef.current = null;
      };
    }, [videoId]);

    return (
      <div
        aria-label="Reproductor de YouTube"
        className="absolute inset-0"
        ref={containerRef}
        role="region"
      />
    );
  },
);

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube Player requires a browser.'));
  }

  const youtubeWindow = window as YouTubeWindow;
  if (youtubeWindow.YT?.Player) {
    apiReady = true;
    return Promise.resolve(youtubeWindow.YT);
  }
  if (apiReady) {
    apiReady = false;
    apiPromise = null;
  }
  if (apiPromise) {
    return apiPromise;
  }

  const request = new Promise<YouTubeNamespace>((resolve, reject) => {
    const previousReady = youtubeWindow.onYouTubeIframeAPIReady;
    const existingScript = document.querySelector<HTMLScriptElement>(
      YOUTUBE_API_SCRIPT_SELECTOR,
    );
    const script = existingScript ?? document.createElement('script');
    let timeoutId: number | null = null;
    let settled = false;

    function restoreReadyCallback() {
      if (youtubeWindow.onYouTubeIframeAPIReady !== handleReady) {
        return;
      }
      if (previousReady) {
        youtubeWindow.onYouTubeIframeAPIReady = previousReady;
      } else {
        delete youtubeWindow.onYouTubeIframeAPIReady;
      }
    }

    function cleanup(removeScript: boolean) {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      script.removeEventListener('error', handleScriptError);
      restoreReadyCallback();
      if (removeScript) {
        script.remove();
      }
    }

    function fail(error: Error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(true);
      reject(error);
    }

    function handleReady() {
      try {
        previousReady?.();
      } catch {
        // Another integration callback must not break this player's loader.
      }

      if (youtubeWindow.YT?.Player) {
        if (!settled) {
          settled = true;
          cleanup(false);
          resolve(youtubeWindow.YT);
        }
      } else {
        fail(new Error('YouTube Player API loaded without Player.'));
      }
    }

    function handleScriptError() {
      fail(new Error('YouTube Player API failed to load.'));
    }

    youtubeWindow.onYouTubeIframeAPIReady = handleReady;
    script.addEventListener('error', handleScriptError, { once: true });
    timeoutId = window.setTimeout(
      () => fail(new Error('YouTube Player API load timed out.')),
      YOUTUBE_API_LOAD_TIMEOUT_MS,
    );

    if (!existingScript) {
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.vslingoYoutubeApi = 'true';
      document.head.append(script);
    }
  });

  apiPromise = request.then(
    (youtube) => {
      apiReady = true;
      return youtube;
    },
    (error: unknown) => {
      apiPromise = null;
      apiReady = false;
      throw error;
    },
  );
  return apiPromise;
}
