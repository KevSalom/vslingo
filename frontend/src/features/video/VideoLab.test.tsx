import { forwardRef, useImperativeHandle, type ReactElement } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptResponse } from './types';
import { VideoFileTree } from './VideoFileTree';
import { VideoLab } from './VideoLab';
import { VideoLabProvider } from './VideoLabContext';
import type {
  VideoPlayerHandle,
  YouTubePlayerProps,
} from './YouTubePlayer';
import {
  MAX_LIBRARY_ITEMS,
  MAX_NOTES,
  VIDEO_STORAGE_KEY,
} from './videoStorage';
import { SAMPLE_VIDEO_TITLE } from './fixture';

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

function renderVideoLab(ui: ReactElement, options?: { tree?: boolean }) {
  return render(
    <VideoLabProvider>
      {options?.tree === false ? null : <VideoFileTree />}
      {ui}
    </VideoLabProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  seekTo.mockClear();
});

describe('VideoLab', () => {
  it('loads a URL, follows playback and seeks from both transcript views', async () => {
    const user = userEvent.setup();
    const loadTranscript = vi.fn().mockResolvedValue(RESULT);
    renderVideoLab(
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

    expect(await screen.findByText(/Neural networks recognize patterns\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Simular 00:05' }));

    const activeSpan = screen.getByText('Layers transform those patterns.').closest('[data-segment-index]');
    expect(activeSpan).toHaveAttribute('aria-current', 'true');

    await user.click(screen.getByText('Layers transform those patterns.'));
    expect(seekTo).toHaveBeenCalledWith(5);

    await user.click(screen.getByRole('button', { name: 'Vista línea a línea' }));
    expect(screen.getByText('00:05')).toBeInTheDocument();
  });

  it('opens the built-in technical fixture from a saved library entry', async () => {
    const user = userEvent.setup();
    const loadTranscript = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    window.localStorage.setItem(
      VIDEO_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state: {
          library: [
            {
              id: 'video-fixture',
              title: SAMPLE_VIDEO_TITLE,
              url: 'https://youtu.be/aircAruvnKk',
              videoId: 'aircAruvnKk',
              source: 'fixture',
            },
          ],
          notes: [],
          viewMode: 'paragraph',
        },
      }),
    );
    renderVideoLab(
      <VideoLab
        loadTranscript={loadTranscript}
        PlayerComponent={FakePlayer}
      />,
    );

    await user.click(await screen.findByRole('button', { name: SAMPLE_VIDEO_TITLE }));

    expect(await screen.findByText(/A neural network receives numbers as input/i)).toBeInTheDocument();
    expect(loadTranscript).not.toHaveBeenCalled();
    expect(screen.getByText('Fixture local')).toBeInTheDocument();
  });

  it('persists a library entry and a titled local note from the explorer', async () => {
    const user = userEvent.setup();
    renderVideoLab(
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

    await user.click(screen.getByRole('button', { name: 'Guardar video' }));
    const saveDialog = screen.getByRole('dialog', { name: 'Guardar video' });
    await user.clear(within(saveDialog).getByLabelText('Nombre del video'));
    await user.type(within(saveDialog).getByLabelText('Nombre del video'), 'Neural networks');
    await user.click(within(saveDialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('button', { name: 'Neural networks' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nueva nota' }));
    const noteDialog = await screen.findByRole('dialog', { name: 'Nueva nota' });
    fireEvent.change(within(noteDialog).getByLabelText('Nombre'), {
      target: { value: 'Layer note' },
    });
    fireEvent.change(within(noteDialog).getByLabelText('Contenido'), {
      target: { value: 'Review the layer transformation.' },
    });
    await user.click(within(noteDialog).getByRole('button', { name: 'Guardar nota' }));

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem(VIDEO_STORAGE_KEY) ?? '{}');
      expect(persisted.version).toBe(2);
      expect(persisted.state.library[0].title).toBe('Neural networks');
      expect(persisted.state.notes[0]).toMatchObject({
        title: 'Layer note',
        text: 'Review the layer transformation.',
      });
      expect(persisted.state.notes[0]).not.toHaveProperty('videoId');
    });
    expect(screen.getByTitle('Layer note')).toBeInTheDocument();
  });

  it('saves a phrase as a note from the line view and keeps notes after removing a video', async () => {
    const user = userEvent.setup();
    renderVideoLab(
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

    await user.click(screen.getByRole('button', { name: 'Guardar video' }));
    const saveDialog = screen.getByRole('dialog', { name: 'Guardar video' });
    await user.clear(within(saveDialog).getByLabelText('Nombre del video'));
    await user.type(within(saveDialog).getByLabelText('Nombre del video'), 'Study clip');
    await user.click(within(saveDialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('button', { name: 'Study clip' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Vista línea a línea' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Guardar frase como nota: Layers transform those patterns.',
      }),
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Guardar frase como nota' })).getByRole(
        'button',
        { name: 'Guardar nota' },
      ),
    );

    expect(await screen.findByTitle('Layers transform those patterns.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Eliminar Study clip' }));

    expect(screen.queryByTitle('Study clip')).not.toBeInTheDocument();
    expect(screen.getByTitle('Layers transform those patterns.')).toBeInTheDocument();

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem(VIDEO_STORAGE_KEY) ?? '{}');
      expect(persisted.state.library).toHaveLength(0);
      expect(persisted.state.notes).toHaveLength(1);
      expect(persisted.state.notes[0].text).toBe('Layers transform those patterns.');
      expect(persisted.state.notes[0]).not.toHaveProperty('videoId');
    });
  });

  it('uses the network-free player for the built-in fixture', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      VIDEO_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state: {
          library: [
            {
              id: 'video-fixture',
              title: SAMPLE_VIDEO_TITLE,
              url: 'https://youtu.be/aircAruvnKk',
              videoId: 'aircAruvnKk',
              source: 'fixture',
            },
          ],
          notes: [],
          viewMode: 'paragraph',
        },
      }),
    );
    renderVideoLab(<VideoLab loadTranscript={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: SAMPLE_VIDEO_TITLE }));

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
    window.localStorage.setItem(
      VIDEO_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state: {
          library: [
            {
              id: 'video-fixture',
              title: SAMPLE_VIDEO_TITLE,
              url: 'https://youtu.be/aircAruvnKk',
              videoId: 'aircAruvnKk',
              source: 'fixture',
            },
          ],
          notes: [],
          viewMode: 'paragraph',
        },
      }),
    );
    renderVideoLab(
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
    await user.click(await screen.findByRole('button', { name: SAMPLE_VIDEO_TITLE }));

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
      title: `Saved note ${index}`,
      text: `Saved note ${index}`,
      createdAt: '2026-07-23T12:00:00.000Z',
      timestamp: index,
    }));
    window.localStorage.setItem(
      VIDEO_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state: { library, notes, viewMode: 'paragraph' },
      }),
    );
    renderVideoLab(
      <VideoLab
        loadTranscript={vi.fn().mockResolvedValue(RESULT)}
        PlayerComponent={FakePlayer}
      />,
      { tree: false },
    );

    await user.type(
      screen.getByRole('textbox', { name: 'URL de YouTube' }),
      'https://youtu.be/aircAruvnKk',
    );
    await user.click(screen.getByRole('button', { name: 'Cargar transcripción' }));
    await screen.findByText('Neural networks recognize patterns.');
    await user.click(screen.getByRole('button', { name: 'Guardar video' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Guardar video' })).getByRole('button', {
        name: 'Guardar',
      }),
    );

    expect(
      screen.getByText(`La biblioteca admite hasta ${MAX_LIBRARY_ITEMS} videos.`),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Vista línea a línea' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Guardar frase como nota: Neural networks recognize patterns.',
      }),
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Guardar frase como nota' })).getByRole(
        'button',
        { name: 'Guardar nota' },
      ),
    );

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
    const { unmount } = renderVideoLab(
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

  it('opens the built-in demo without a library entry', async () => {
    const user = userEvent.setup();
    renderVideoLab(<VideoLab loadTranscript={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Abrir demo técnica' }));

    expect(
      await screen.findByText(/A neural network receives numbers as input/i),
    ).toBeInTheDocument();
  });
});
