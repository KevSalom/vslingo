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
  recorderOptions: null as null | { onFrameLevel?: (level: number) => void },
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
    constructor(options: { onFrameLevel?: (level: number) => void } = {}) {
      mocks.recorderOptions = options;
    }
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
  await user.click(screen.getByRole('button', { name: 'Iniciar Voice Studio' }));
  act(() => mocks.socket?.emitMessage(readyMessage));
  await waitFor(() => expect(mocks.vadStart).toHaveBeenCalledOnce());
  return user;
}

describe('VoiceStudio T07 flow', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.socket = null;
    mocks.vadOptions = null;
    mocks.recorderOptions = null;
    vi.clearAllMocks();
    let uuidSeq = 0;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      uuidSeq += 1;
      return `00000000-0000-4000-8000-${String(uuidSeq).padStart(12, '0')}`;
    });
  });

  it('renders initial state and keeps manual PTT disabled before connecting', () => {
    render(<VoiceStudio />);

    expect(
      screen.getByRole('heading', { name: /^Voice Studio$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Escenario' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar Voice Studio' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Estado: Inactivo/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Señal de audio: entrada' })).toBeInTheDocument();
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

  it('animates input waveform from live PTT mic levels while held', async () => {
    await connectVoice();
    const ptt = screen.getByRole('button', { name: /Mantén pulsado para hablar/i });

    fireEvent.pointerDown(ptt, { pointerId: 1, button: 0 });
    await waitFor(() => expect(mocks.recorderOptions?.onFrameLevel).toBeTypeOf('function'));

    const bars = screen
      .getByRole('img', { name: 'Señal de audio: entrada' })
      .querySelectorAll('.voice-signal-bar');
    const middleBar = bars[9] as HTMLElement;
    const initialTransform = middleBar.style.transform;

    act(() => mocks.recorderOptions?.onFrameLevel?.(0.72));

    await waitFor(() => {
      expect(middleBar.style.transform).not.toBe(initialTransform);
      expect(middleBar.style.transform).toContain('scaleY');
    });

    fireEvent.pointerUp(ptt, { pointerId: 1, button: 0 });
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

  it('keeps conversation history when only the speech provider changes', async () => {
    const user = await connectVoice();
    act(() =>
      mocks.socket?.emitMessage({
        type: 'session.configured',
        scenario: 'daily_standup',
        speech_provider: 'aws_polly',
        config_revision: 1,
      }),
    );
    act(() => mocks.vadOptions?.onSpeechStart());
    act(() =>
      mocks.socket?.emitMessage({
        type: 'transcript.final',
        generation: 1,
        turn_id: '00000000-0000-4000-8000-000000000001',
        text: 'Hello there partner',
      }),
    );
    act(() =>
      mocks.socket?.emitMessage({
        type: 'assistant.done',
        generation: 1,
        turn_id: '00000000-0000-4000-8000-000000000001',
        text: 'Hi! Ready to practice?',
      }),
    );

    expect(screen.getByText('Hello there partner')).toBeInTheDocument();
    expect(screen.getByText('Hi! Ready to practice?')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Proveedor de voz' }), 'edge_tts');
    act(() =>
      mocks.socket?.emitMessage({
        type: 'session.configured',
        scenario: 'daily_standup',
        speech_provider: 'edge_tts',
        config_revision: 2,
      }),
    );

    expect(screen.getByText('Hello there partner')).toBeInTheDocument();
    expect(screen.getByText('Hi! Ready to practice?')).toBeInTheDocument();
  });

  it('clears conversation history when the scenario changes', async () => {
    const user = await connectVoice();
    act(() =>
      mocks.socket?.emitMessage({
        type: 'session.configured',
        scenario: 'daily_standup',
        speech_provider: 'aws_polly',
        config_revision: 1,
      }),
    );
    act(() => mocks.vadOptions?.onSpeechStart());
    act(() =>
      mocks.socket?.emitMessage({
        type: 'transcript.final',
        generation: 1,
        turn_id: '00000000-0000-4000-8000-000000000001',
        text: 'Status update for standup',
      }),
    );
    act(() =>
      mocks.socket?.emitMessage({
        type: 'assistant.done',
        generation: 1,
        turn_id: '00000000-0000-4000-8000-000000000001',
        text: 'Thanks for the update.',
      }),
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Escenario' }), 'free');
    act(() =>
      mocks.socket?.emitMessage({
        type: 'session.configured',
        scenario: 'free',
        speech_provider: 'aws_polly',
        config_revision: 2,
      }),
    );

    expect(screen.queryByText('Status update for standup')).not.toBeInTheDocument();
    expect(screen.queryByText('Thanks for the update.')).not.toBeInTheDocument();
  });

  it('cancels an active turn and keeps the latest scenario selection', async () => {
    const user = await connectVoice();
    const scenarioSelect = screen.getByRole('combobox', { name: 'Escenario' });
    act(() => mocks.vadOptions?.onSpeechStart());

    await user.selectOptions(scenarioSelect, 'free');
    await user.selectOptions(scenarioSelect, 'salary_negotiation');

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

    expect(scenarioSelect).toHaveValue('salary_negotiation');
  });

  it('cleans the manual recorder if configuration changes while PTT is held', async () => {
    const user = await connectVoice();
    const ptt = screen.getByRole('button', { name: /Mantén pulsado para hablar/i });
    fireEvent.pointerDown(ptt, { pointerId: 7, button: 0 });
    await waitFor(() => expect(mocks.recorderStart).toHaveBeenCalledOnce());

    await user.selectOptions(screen.getByRole('combobox', { name: 'Escenario' }), 'free');

    expect(mocks.recorderCleanup).toHaveBeenCalled();
    expect(mocks.vadStart).toHaveBeenCalledTimes(2);
  });

  it('renders session metrics from safe protocol events without persisting them', async () => {
    await connectVoice();
    act(() => mocks.vadOptions?.onSpeechStart());

    act(() =>
      mocks.socket?.emitMessage({
        type: 'metrics.stage',
        turn_id: '00000000-0000-4000-8000-000000000001',
        generation: 1,
        stage: 'stt_final',
        latency_ms: 842,
        provider: 'openrouter',
        usage_seconds: 0.2,
        usage_tokens: null,
        cost_usd: 0.00004,
        estimated: false,
      }),
    );
    act(() =>
      mocks.socket?.emitMessage({
        type: 'metrics.stage',
        turn_id: '00000000-0000-4000-8000-000000000001',
        generation: 1,
        stage: 'tts_first_byte',
        latency_ms: 1200,
        provider: 'aws_polly',
        usage_seconds: null,
        usage_tokens: null,
        cost_usd: 0.00016,
        estimated: true,
      }),
    );

    expect(screen.getByLabelText('Métricas de sesión')).toHaveTextContent('842 ms');
    expect(screen.getByLabelText('Métricas de sesión')).toHaveTextContent('1200 ms');
    expect(screen.getByLabelText('Métricas de sesión')).toHaveTextContent('USD 0.00020 · est.');
    expect(localStorage.getItem('vslingo:voice:metrics')).toBeNull();
  });

  it('updates input waveform height when VAD emits calibrated level', async () => {
    await connectVoice();
    await waitFor(() => expect(mocks.vadOptions?.onFrameLevel).toBeDefined());

    const inputVisualizer = screen.getByRole('img', { name: 'Señal de audio: entrada' });
    expect(inputVisualizer).toBeInTheDocument();

    const bars = inputVisualizer.querySelectorAll('.voice-signal-bar');
    expect(bars.length).toBe(18);

    const middleBar = bars[9] as HTMLElement;
    const initialMiddleBarTransform = middleBar.style.transform;

    // Frame levels only animate during real speech ("Te escucho").
    act(() => mocks.vadOptions?.onFrameLevel?.(0.55));
    expect(middleBar.style.transform).toBe(initialMiddleBarTransform);

    act(() => {
      mocks.vadOptions?.onSpeechStart?.();
      mocks.vadOptions?.onFrameLevel?.(0.55);
    });

    await waitFor(() => {
      const activeMiddleBarTransform = middleBar.style.transform;
      expect(activeMiddleBarTransform).not.toBe(initialMiddleBarTransform);
      expect(activeMiddleBarTransform).toContain('scaleY');
    });
  });

  it('clears userTranscript after assistant.done to avoid duplicating user message in turnHistory and last turn', async () => {
    await connectVoice();

    act(() => mocks.vadOptions?.onSpeechStart());
    act(() =>
      mocks.socket?.emitMessage({
        type: 'transcript.final',
        generation: 1,
        text: 'Hello, can you help me learn English?',
      }),
    );

    expect(screen.getAllByText(/Hello, can you help me learn English\?/i)).toHaveLength(1);

    act(() =>
      mocks.socket?.emitMessage({
        type: 'assistant.done',
        generation: 1,
        text: 'I would love to help you practice.',
      }),
    );

    expect(screen.getAllByText(/Hello, can you help me learn English\?/i)).toHaveLength(1);
    expect(screen.getByText('I would love to help you practice.')).toBeInTheDocument();
  });
});



