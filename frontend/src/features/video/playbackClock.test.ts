import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPlaybackClock } from './playbackClock';

afterEach(() => {
  vi.useRealTimers();
});

describe('createPlaybackClock', () => {
  it('samples every 200ms, avoids duplicate timers and stops cleanly', () => {
    vi.useFakeTimers();
    const readCurrentTime = vi.fn(() => 4.25);
    const onTime = vi.fn();
    const clock = createPlaybackClock(readCurrentTime, onTime);

    clock.start();
    clock.start();
    vi.advanceTimersByTime(600);

    expect(readCurrentTime).toHaveBeenCalledTimes(3);
    expect(onTime).toHaveBeenNthCalledWith(1, 4.25);

    clock.stop();
    vi.advanceTimersByTime(400);
    expect(readCurrentTime).toHaveBeenCalledTimes(3);
  });
});
