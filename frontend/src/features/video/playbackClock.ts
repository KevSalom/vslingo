export const PLAYBACK_POLL_INTERVAL_MS = 200;

export type PlaybackClock = {
  start: () => void;
  stop: () => void;
};

/** Poll the IFrame clock only while playback is active and never duplicate timers. */
export function createPlaybackClock(
  readCurrentTime: () => number,
  onTimeChange: (seconds: number) => void,
  intervalMs = PLAYBACK_POLL_INTERVAL_MS,
): PlaybackClock {
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    start() {
      if (timer !== null) {
        return;
      }
      timer = setInterval(() => {
        const currentTime = readCurrentTime();
        if (Number.isFinite(currentTime) && currentTime >= 0) {
          onTimeChange(currentTime);
        }
      }, intervalMs);
    },
    stop,
  };
}
