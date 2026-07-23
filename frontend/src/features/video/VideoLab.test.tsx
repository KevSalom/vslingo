import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptResponse } from './types';
import { VideoLab } from './VideoLab';
import type {
  VideoPlayerHandle,
  YouTubePlayerProps,
} from './YouTubePlayer';
import {
  MAX_LIBRARY_ITEMS,
  MAX_NOTES,
  VIDEO_STORAGE_KEY,
} from './videoStorage';

const RESULT: TranscriptResponse = {
  video_id: 'aircAruvnKk',
  source: 'youtube',
  segments: [
    { text: 'Neural networks recognize patterns.', start: 0, duration: 5 },
    { text: 'Layers transform those patterns.', start: 5, duration: 4 },
  ],
};

const seekTo = vi.fn();
const FakePlayer = forwardRef<VideoPlayerHandle, YouTubePlayerProps>(
  function FakePlayer({ onTimeChange }, ref) {
    useImperativeHandle(ref, () => ({ seekTo }));
    return (
      <button onClick={() => onTimeChange(5.5)} type="button">
        Simular 00:05
      </button>
    );
  },
);

beforeEach(() => {
  window.localStorage.clear();
  seekTo.mockClear();
});

describe('VideoLab', () => {
  it('loads a URL, follows playback and seeks from both transcript views', async () => {
    const user = userEvent.setup();
    const loadTranscript = vi.fn().mockResolvedValue(RESULT);
    render(
      <VideoLab
        loadTranscript={loadTranscript}
        PlayerComponent={FakePlayer}
      />,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'URL de YouTube' }),
      'https://youtu.be/aircAruvnKk',
    );
    await user.click(screen.getByRole('button', { name: 'Cargar transcripción' }));

    expect(await screen.findByText('Neural networks recognize patterns.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Simular 00:05' }));

    const activeSegment = screen.getByRole('button', {
      name: 'Layers transform those patterns.',
    });
    expect(activeSegment).toHaveAttribute('aria-current', 'true');

    await user.click(activeSegment);
    expect(seekTo).toHaveBeenCalledWith(5);

    await user.click(screen.getByRole('button', { name: 'Vista línea a línea' }));
    expect(screen.getByText('00:05')).toBeInTheDocument();
  });

  it('opens the built-in technical fixture without contacting the API', async () => {
    const user = userEvent.setup();
    const loadTranscript = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    render(
      <VideoLab
        loadTranscript={loadTranscript}
        PlayerComponent={FakePlayer}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Abrir demo técnica' }));

    expect(await screen.findByText(/A neural network receives numbers as input/i)).toBeInTheDocument();
    expect(loadTranscript).not.toHaveBeenCalled();
    expect(screen.getByText('Fixture local')).toBeInTheDocument();
  });

  it('persists a library entry and a timestamped local note', async () => {
    const user = userEvent.setup();
    render(
      <VideoLab
        loadTranscript={vi.fn().mockResolvedValue(RESULT)}
        PlayerComponent={FakePlayer}
      />,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'URL de YouTube' }),
      'https://youtu.be/aircAruvnKk',
    );
    await user.click(screen.getByRole('button', { name: 'Cargar transcripción' }));
    await screen.findByText('Neural networks recognize patterns.');

    await user.clear(screen.getByRole('textbox', { name: 'Nombre en biblioteca' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Nombre en biblioteca' }),
      'Neural networks',
    );
    await user.click(screen.getByRole('button', { name: 'Guardar en biblioteca' }));

    await user.click(screen.getByRole('button', { name: 'Simular 00:05' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Nota en 00:05' }),
      'Review the layer transformation.',
    );
    await user.click(screen.getByRole('button', { name: 'Guardar nota' }));

    expect(screen.getByText('Review the layer transformation.')).toBeInTheDocument();
    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem(VIDEO_STORAGE_KEY) ?? '{}');
      expect(persisted.state.library[0].title).toBe('Neural networks');
      expect(persisted.state.notes[0]).toMatchObject({
        timestamp: 5.5,
        text: 'Review the layer transformation.',
      });
    });
  });

  it('uses the network-free player for the built-in fixture', async () => {
    const user = userEvent.setup();
    render(<VideoLab loadTranscript={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Abrir demo técnica' }));

    expect(
      await screen.findByRole('region', { name: 'Reproductor de demo local' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducir demo local' })).toBeInTheDocument();
  });

  it('keeps the latest fixture selection when an older request resolves', async () => {
    const user = userEvent.setup();
    let resolveRequest!: (value: TranscriptResponse) => void;
    const pendingRequest = new Promise<TranscriptResponse>((resolve) => {
      resolveRequest = resolve;
    });
    const loadTranscript = vi.fn(
      (_url: string, _options?: { signal?: AbortSignal }) => pendingRequest,
    );
    render(
      <VideoLab
        loadTranscript={loadTranscript}
        PlayerComponent={FakePlayer}
      />,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'URL de YouTube' }),
      'https://youtu.be/aircAruvnKk',
    );
    await user.click(screen.getByRole('button', { name: 'Cargar transcripción' }));
    await user.click(screen.getByRole('button', { name: 'Abrir demo técnica' }));

    expect(loadTranscript.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    resolveRequest(RESULT);

    await waitFor(() => {
      expect(screen.getByText('Fixture local')).toBeInTheDocument();
      expect(screen.queryByText('Neural networks recognize patterns.')).not.toBeInTheDocument();
    });
  });

  it('enforces library and note limits from the integrated UI', async () => {
    const user = userEvent.setup();
    const library = Array.from({ length: MAX_LIBRARY_ITEMS }, (_, index) => ({
      id: `video-${index}`,
      title: `Saved video ${index}`,
      url: `https://youtu.be/${String(index).padStart(11, '0')}`,
      videoId: String(index).padStart(11, '0'),
      source: 'youtube' as const,
    }));
    const notes = Array.from({ length: MAX_NOTES }, (_, index) => ({
      id: `note-${index}`,
      videoId: '00000000000',
      timestamp: index,
      text: `Saved note ${index}`,
      createdAt: '2026-07-23T12:00:00.000Z',
    }));
    window.localStorage.setItem(
      VIDEO_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: { library, notes, viewMode: 'paragraph' },
      }),
    );
    render(
      <VideoLab
        loadTranscript={vi.fn().mockResolvedValue(RESULT)}
        PlayerComponent={FakePlayer}
      />,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'URL de YouTube' }),
      'https://youtu.be/aircAruvnKk',
    );
    await user.click(screen.getByRole('button', { name: 'Cargar transcripción' }));
    await screen.findByText('Neural networks recognize patterns.');
    await user.click(screen.getByRole('button', { name: 'Guardar en biblioteca' }));

    expect(
      screen.getByText(`La biblioteca admite hasta ${MAX_LIBRARY_ITEMS} videos.`),
    ).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: 'Nota en 00:00' }),
      'This note exceeds the local limit.',
    );
    await user.click(screen.getByRole('button', { name: 'Guardar nota' }));

    expect(
      screen.getByText(`Puedes guardar hasta ${MAX_NOTES} notas locales.`),
    ).toBeInTheDocument();
    const persisted = JSON.parse(
      window.localStorage.getItem(VIDEO_STORAGE_KEY) ?? '{}',
    );
    expect(persisted.state.library).toHaveLength(MAX_LIBRARY_ITEMS);
    expect(persisted.state.notes).toHaveLength(MAX_NOTES);
  });

  it('aborts the active transcript request when unmounted', async () => {
    const user = userEvent.setup();
    const pendingRequest = new Promise<TranscriptResponse>(() => undefined);
    const loadTranscript = vi.fn(
      (_url: string, _options?: { signal?: AbortSignal }) => pendingRequest,
    );
    const { unmount } = render(
      <VideoLab
        loadTranscript={loadTranscript}
        PlayerComponent={FakePlayer}
      />,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'URL de YouTube' }),
      'https://youtu.be/aircAruvnKk',
    );
    await user.click(screen.getByRole('button', { name: 'Cargar transcripción' }));
    const signal = loadTranscript.mock.calls[0]?.[1]?.signal;

    unmount();

    expect(signal?.aborted).toBe(true);
  });
});