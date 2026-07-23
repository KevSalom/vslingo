import { createRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  YouTubePlayer,
  YOUTUBE_API_LOAD_TIMEOUT_MS,
  type VideoPlayerHandle,
} from './YouTubePlayer';

type StateHandler = (event: { data: number }) => void;
type ErrorHandler = (event: { data: number }) => void;

type TestWindow = Window &
  typeof globalThis & {
    YT?: { Player: typeof FakeYouTubePlayer };
    onYouTubeIframeAPIReady?: () => void;
  };

let stateHandler: StateHandler | undefined;
const getCurrentTime = vi.fn(() => 4.25);
const seekTo = vi.fn();
const destroy = vi.fn();
const playerConstructed = vi.fn();

class FakeYouTubePlayer {
  constructor(
    _element: HTMLElement,
    options: {
      events: {
        onStateChange: StateHandler;
        onError: ErrorHandler;
      };
    },
  ) {
    playerConstructed();
    stateHandler = options.events.onStateChange;
  }

  getCurrentTime = getCurrentTime;
  seekTo = seekTo;
  destroy = destroy;
}

afterEach(() => {
  vi.useRealTimers();
  document
    .querySelectorAll('script[data-vslingo-youtube-api]')
    .forEach((script) => script.remove());
  delete (window as TestWindow).YT;
  delete (window as TestWindow).onYouTubeIframeAPIReady;
  stateHandler = undefined;
  getCurrentTime.mockClear();
  seekTo.mockClear();
  destroy.mockClear();
  playerConstructed.mockClear();
});

describe('YouTubePlayer', () => {
  it('polls while playing, delegates seek and destroys resources on cleanup', async () => {
    vi.useFakeTimers();
    (window as TestWindow).YT = { Player: FakeYouTubePlayer };
    const onTimeChange = vi.fn();
    const ref = createRef<VideoPlayerHandle>();

    const view = render(
      <YouTubePlayer
        onTimeChange={onTimeChange}
        ref={ref}
        videoId="aircAruvnKk"
      />,
    );
    await act(async () => Promise.resolve());

    act(() => {
      stateHandler?.({ data: 1 });
      vi.advanceTimersByTime(400);
    });
    expect(getCurrentTime).toHaveBeenCalledTimes(2);
    expect(onTimeChange).toHaveBeenLastCalledWith(4.25);

    act(() => ref.current?.seekTo(7));
    expect(seekTo).toHaveBeenCalledWith(7, true);

    view.unmount();
    act(() => vi.advanceTimersByTime(400));
    expect(getCurrentTime).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('times out, removes the stalled script and reports a safe error', async () => {
    vi.useFakeTimers();
    const onPlayerError = vi.fn();
    const view = render(
      <YouTubePlayer
        onPlayerError={onPlayerError}
        onTimeChange={vi.fn()}
        videoId="aircAruvnKk"
      />,
    );

    expect(
      document.querySelector('script[data-vslingo-youtube-api]'),
    ).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(YOUTUBE_API_LOAD_TIMEOUT_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onPlayerError).toHaveBeenCalledWith(
      'No se pudo inicializar el reproductor de YouTube.',
    );
    expect(
      document.querySelector('script[data-vslingo-youtube-api]'),
    ).toBeNull();
    view.unmount();
  });

  it('removes a failed script, restores the callback and succeeds on retry', async () => {
    const onPlayerError = vi.fn();
    const previousReady = vi.fn();
    (window as TestWindow).onYouTubeIframeAPIReady = previousReady;

    const firstView = render(
      <YouTubePlayer
        onPlayerError={onPlayerError}
        onTimeChange={vi.fn()}
        videoId="aircAruvnKk"
      />,
    );
    const failedScript = document.querySelector<HTMLScriptElement>(
      'script[data-vslingo-youtube-api]',
    );
    expect(failedScript).not.toBeNull();

    await act(async () => {
      failedScript?.dispatchEvent(new Event('error'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(onPlayerError).toHaveBeenCalledOnce());
    expect(failedScript?.isConnected).toBe(false);
    expect((window as TestWindow).onYouTubeIframeAPIReady).toBe(previousReady);
    firstView.unmount();

    const secondView = render(
      <YouTubePlayer
        onPlayerError={onPlayerError}
        onTimeChange={vi.fn()}
        videoId="dQw4w9WgXcQ"
      />,
    );
    const retryScript = document.querySelector<HTMLScriptElement>(
      'script[data-vslingo-youtube-api]',
    );
    expect(retryScript).not.toBeNull();
    expect(retryScript).not.toBe(failedScript);

    (window as TestWindow).YT = { Player: FakeYouTubePlayer };
    await act(async () => {
      (window as TestWindow).onYouTubeIframeAPIReady?.();
      await Promise.resolve();
    });

    expect(previousReady).toHaveBeenCalledOnce();
    expect(playerConstructed).toHaveBeenCalledOnce();
    expect(onPlayerError).toHaveBeenCalledOnce();
    secondView.unmount();
  });
});
