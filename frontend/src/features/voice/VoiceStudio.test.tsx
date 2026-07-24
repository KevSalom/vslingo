import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerVoiceMessage } from './protocol';
import type { VadClientOptions } from './vadClient';
import { VoiceStudio } from './VoiceStudio';

const mocks = vi.hoisted(() => ({
  socket: null as null | {
    messages: unknown[];
    emitMessage: (message: unknown) => void;
  },
  vadOptions: null as VadClientOptions | null,
  vadStart: vi.fn(async () => undefined),
  vadPause: vi.fn(async () => undefined),
  vadDestroy: vi.fn(async () => undefined),
  recorderStart: vi.fn(async () => undefined),
  recorderStop: vi.fn(() => ({ wavBytes: new Uint8Array(3200), durationMs: 200 })),
  recorderCleanup: vi.fn(),
  schedulerStopAll: vi.fn(),
  schedulerCancelBefore: vi.fn(),
  schedulerClose: vi.fn(async () => undefined),
}));

vi.mock('./voiceSocket', () => ({
  VoiceSocketClient: class {
    private messageListeners = new Set<(message: ServerVoiceMessage) => void>();
    private binaryListeners = new Set<(data: ArrayBuffer) => void>();
    private statusListeners = new Set<(connected: boolean) => void>();
    messages: unknown[] = [];

    constructor() {
      mocks.socket = {
        messages: this.messages,
        emitMessage: (message) => {
          for (const listener of this.messageListeners) {
            listener(message as ServerVoiceMessage);
          }
        },
      };
    }

    async connect() {
      for (const listener of this.statusListeners) listener(true);
    }
    disconnect() {
      for (const listener of this.statusListeners) listener(false);
    }
    sendMessage(message: unknown) {
      this.messages.push(message);
    }
    sendBinary() {}
    onMessage(listener: (message: ServerVoiceMessage) => void) {
      this.messageListeners.add(listener);
      return () => this.messageListeners.delete(listener);
    }
    onBinary(listener: (data: ArrayBuffer) => void) {
      this.binaryListeners.add(listener);
      return () => this.binaryListeners.delete(listener);
    }
    onStatusChange(listener: (connected: boolean) => void) {
      this.statusListeners.add(listener);
      return () => this.statusListeners.delete(listener);
    }
  },
}));

vi.mock('./vadClient', () => ({
  createVadClient: vi.fn(async (options: VadClientOptions) => {
    mocks.vadOptions = options;
    return {
      start: mocks.vadStart,
      pause: mocks.vadPause,
      destroy: mocks.vadDestroy,
    };
  }),
}));

vi.mock('./audioCapture', () => ({
  AudioRecorder: class {
    start = mocks.recorderStart;
    stop = mocks.recorderStop;
    cleanup = mocks.recorderCleanup;
  },
}));

vi.mock('./audioScheduler', () => ({
  AudioScheduler: class {
    stopAll = mocks.schedulerStopAll;
    cancelBefore = mocks.schedulerCancelBefore;
    close = mocks.schedulerClose;
    enqueue = vi.fn(async () => undefined);
  },
}));

const readyMessage: ServerVoiceMessage = {
  type: 'session.ready',
  protocol_version: 1,
  session_id: 'session-1',
  generation: 0,
};

async function connectVoice() {
  const user = userEvent.setup();
  render(<VoiceStudio />);
  await user.click(screen.getByRole('button', { name: 'Iniciar Sesión' }));
  act(() => mocks.socket?.emitMessage(readyMessage));
  await waitFor(() => expect(mocks.vadStart).toHaveBeenCalledOnce());
  return user;
}

describe('VoiceStudio T07 flow', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.socket = null;
    mocks.vadOptions = null;
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
  });

  it('renders initial state and keeps manual PTT disabled before connecting', () => {
    render(<VoiceStudio />);

    expect(screen.getByText('Voice Studio — Hands-free & Feedback')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar Sesión' })).toBeInTheDocument();
    expect(screen.getAllByText('Inactivo').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'Nivel de audio de entrada' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mantén pulsado para hablar/i })).toBeDisabled();
  });

  it('starts hands-free VAD after session.ready and creates utterances without PTT', async () => {
    await connectVoice();

    act(() => mocks.vadOptions?.onSpeechStart());
    act(() => mocks.vadOptions?.onSpeechEnd(new Uint8Array(3200), 200));

    expect(mocks.socket?.messages).toContainEqual({
      type: 'speech.started',
      turn_id: '00000000-0000-4000-8000-000000000001',
      generation: 1,
    });
    expect(mocks.socket?.messages).toContainEqual(
      expect.objectContaining({ type: 'utterance.begin', generation: 1, duration_ms: 200 }),
    );
  });

  it('uses hold-to-talk and pauses VAD while the manual capture owns the microphone', async () => {
    await connectVoice();
    const ptt = screen.getByRole('button', { name: /Mantén pulsado para hablar/i });

    fireEvent.pointerDown(ptt, { pointerId: 1, button: 0 });
    await waitFor(() => expect(mocks.recorderStart).toHaveBeenCalledOnce());
    expect(mocks.vadPause).toHaveBeenCalledOnce();

    fireEvent.pointerUp(ptt, { pointerId: 1, button: 0 });
    await waitFor(() => expect(mocks.recorderStop).toHaveBeenCalledOnce());
    expect(mocks.vadStart).toHaveBeenCalledTimes(2);
  });

  it('cancels the prior generation locally and remotely when speech interrupts it', async () => {
    await connectVoice();

    act(() => mocks.vadOptions?.onSpeechStart());
    act(() => mocks.vadOptions?.onSpeechEnd(new Uint8Array(3200), 200));
    act(() => mocks.vadOptions?.onSpeechStart());

    expect(mocks.schedulerCancelBefore).toHaveBeenLastCalledWith(2);
    expect(mocks.socket?.messages).toContainEqual({
      type: 'response.cancel',
      turn_id: '00000000-0000-4000-8000-000000000001',
      generation: 1,
    });
  });

  it('shows and persists the shared Polly/Edge selector', async () => {
    const user = await connectVoice();
    const selector = screen.getByRole('combobox', { name: 'Proveedor de voz' });

    expect(selector).toHaveValue('aws_polly');
    await user.selectOptions(selector, 'edge_tts');

    expect(selector).toHaveValue('edge_tts');
    expect(localStorage.getItem('vslingo:speech')).toContain('edge_tts');
    expect(mocks.socket?.messages).toContainEqual({
      type: 'session.config',
      scenario: 'daily_standup',
      speech_provider: 'edge_tts',
    });
  });

  it('cancels an active turn and keeps the latest scenario selection', async () => {
    const user = await connectVoice();
    act(() => mocks.vadOptions?.onSpeechStart());

    await user.click(screen.getByRole('button', { name: 'Libre / Explorar' }));
    await user.click(screen.getByRole('button', { name: 'Salary Negotiation' }));

    expect(mocks.socket?.messages).toContainEqual({
      type: 'response.cancel',
      turn_id: '00000000-0000-4000-8000-000000000001',
      generation: 1,
    });
    expect(mocks.socket?.messages).toContainEqual({
      type: 'session.config',
      scenario: 'salary_negotiation',
      speech_provider: 'aws_polly',
    });

    act(() =>
      mocks.socket?.emitMessage({
        type: 'session.configured',
        scenario: 'free',
        speech_provider: 'aws_polly',
        config_revision: 1,
      }),
    );
    act(() =>
      mocks.socket?.emitMessage({
        type: 'session.configured',
        scenario: 'salary_negotiation',
        speech_provider: 'aws_polly',
        config_revision: 2,
      }),
    );

    expect(screen.getByRole('button', { name: 'Salary Negotiation' })).toHaveClass('bg-blue-600');
  });

  it('cleans the manual recorder if configuration changes while PTT is held', async () => {
    const user = await connectVoice();
    const ptt = screen.getByRole('button', { name: /Mantén pulsado para hablar/i });
    fireEvent.pointerDown(ptt, { pointerId: 7, button: 0 });
    await waitFor(() => expect(mocks.recorderStart).toHaveBeenCalledOnce());

    await user.click(screen.getByRole('button', { name: 'Libre / Explorar' }));

    expect(mocks.recorderCleanup).toHaveBeenCalled();
    expect(mocks.vadStart).toHaveBeenCalledTimes(2);
  });
});
