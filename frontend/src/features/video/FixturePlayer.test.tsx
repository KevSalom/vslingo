import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FixturePlayer } from './FixturePlayer';
import { PLAYBACK_POLL_INTERVAL_MS } from './playbackClock';
import type { VideoPlayerHandle } from './YouTubePlayer';

afterEach(() => {
  vi.useRealTimers();
});

describe('FixturePlayer', () => {
  it('plays on the 200 ms clock, pauses, seeks and clears its timer', () => {
    vi.useFakeTimers();
    const onTimeChange = vi.fn();
    const ref = createRef<VideoPlayerHandle>();
    const view = render(
      <FixturePlayer
        onTimeChange={onTimeChange}
        ref={ref}
        videoId="aircAruvnKk"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reproducir demo local' }));
    act(() => vi.advanceTimersByTime(PLAYBACK_POLL_INTERVAL_MS * 2));
    expect(onTimeChange).toHaveBeenNthCalledWith(1, 0.2);
    expect(onTimeChange).toHaveBeenNthCalledWith(2, 0.4);

    fireEvent.click(screen.getByRole('button', { name: 'Pausar demo local' }));
    act(() => vi.advanceTimersByTime(PLAYBACK_POLL_INTERVAL_MS * 2));
    expect(onTimeChange).toHaveBeenCalledTimes(2);

    act(() => ref.current?.seekTo(12.5));
    expect(onTimeChange).toHaveBeenLastCalledWith(12.5);
    expect(screen.getByRole('slider', { name: 'Posición de la demo local' })).toHaveValue('12.5');

    view.unmount();
    act(() => vi.advanceTimersByTime(PLAYBACK_POLL_INTERVAL_MS * 2));
    expect(onTimeChange).toHaveBeenCalledTimes(3);
  });
});
