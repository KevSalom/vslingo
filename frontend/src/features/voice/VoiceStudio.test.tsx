import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerVoiceMessage } from './protocol';
import { VoiceStudio } from './VoiceStudio';

const mocks = vi.hoisted(() => ({
  socket: null as null | {
    messages: unknown[];
    binaries: Uint8Array[];
    emitMessage: (message: ServerVoiceMessage) => void;
    emitBinary: (data: ArrayBuffer) => void;
  },
  recorderStart: vi.fn(async () => undefined),
  recorderStop: vi.fn(() => ({ wavBytes: new Uint8Array(3200), durationMs: 200 })),
  recorderCleanup: vi.fn(),
  recorderOptions: null as null | { onFrameLevel?: (level: number) => void },
  schedulerStopAll: vi.fn(),
  schedulerCancelBefore: vi.fn(),
  schedulerClose: vi.fn(async () => undefined),
  schedulerEnqueue: vi.fn(async () => undefined),
  schedulerAnalyser: vi.fn(() => null),
  spoken: [] as SpeechSynthesisUtterance[],
  speechCancel: vi.fn(),
}));

vi.mock('./voiceSocket', () => ({
  VoiceSocketClient: class {
    private messageListeners = new Set<(message: ServerVoiceMessage) => void>();
    private binaryListeners = new Set<(data: ArrayBuffer) => void>();
    private statusListeners = new Set<(connected: boolean) => void>();
    messages: unknown[] = [];
    binaries: Uint8Array[] = [];

    constructor() {
      mocks.socket = {
        messages: this.messages,
        binaries: this.binaries,
        emitMessage: (message) => {
          for (const listener of this.messageListeners) listener(message);
        },
        emitBinary: (data) => {
          for (const listener of this.binaryListeners) listener(data);
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

    sendBinary(data: Uint8Array) {
      this.binaries.push(data);
    }

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

vi.mock('../../shared/history/historyClient', () => ({
  createVoiceConversation: vi.fn(async () => ({ id: 'conversation-test' })),
  listVoiceConversations: vi.fn(async () => []),
  getVoiceConversation: vi.fn(async () => ({ id: 'conversation-test', turns: [] })),
  deleteVoiceConversation: vi.fn(async () => undefined),
  saveVoiceTurn: vi.fn(async () => ({ id: 'turn-test' })),
  saveVoiceFeedback: vi.fn(async () => undefined),
}));

vi.mock('../../shared/auth/preferencesClient', () => ({
  updateAccountPreferences: vi.fn(async () => ({
    theme: 'light', speech_voice: 'en-US-AriaNeural', version: 1,
  })),
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
    enqueue = mocks.schedulerEnqueue;
    getAnalyserNode = mocks.schedulerAnalyser;
  },
}));

class FakeUtterance extends EventTarget {
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

  constructor(public text: string) {
    super();
  }
}

const readyMessage: ServerVoiceMessage = {
  type: 'session.ready',
  protocol_version: 2,
  session_id: 'session-1',
  generation: 0,
};

async function connectVoice() {
  const user = userEvent.setup();
  render(<VoiceStudio />);
  await user.click(screen.getByRole('button', { name: 'Activar micrófono' }));
  act(() => mocks.socket?.emitMessage(readyMessage));
  await waitFor(() => expect(screen.getByRole('button', { name: /Mantén pulsado/i })).toBeEnabled());
  return user;
}

function beginRecording() {
  const ptt = screen.getByRole('button', { name: /Mantén pulsado para hablar/i });
  fireEvent.pointerDown(ptt, { pointerId: 1, button: 0 });
  return ptt;
}

describe('VoiceStudio MVP flow', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.socket = null;
    mocks.recorderOptions = null;
    mocks.spoken.length = 0;
    vi.clearAllMocks();
    let uuidSeq = 0;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      uuidSeq += 1;
      return `00000000-0000-4000-8000-${String(uuidSeq).padStart(12, '0')}`;
    });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: mocks.speechCancel,
        getVoices: vi.fn(() => []),
        speak: vi.fn((utterance: SpeechSynthesisUtterance) => mocks.spoken.push(utterance)),
      },
    });
  });

  it('starts with a disabled PTT and configures Edge plus the default voice', async () => {
    render(<VoiceStudio />);

    expect(screen.getByRole('heading', { name: 'Hablar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mantén pulsado para hablar/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Voz' })).toHaveValue('en-US-AriaNeural');

    await userEvent.click(screen.getByRole('button', { name: 'Activar micrófono' }));
    act(() => mocks.socket?.emitMessage(readyMessage));

    await waitFor(() =>
      expect(mocks.socket?.messages).toContainEqual({
        type: 'session.config',
        scenario: 'free',
        speech_provider: 'edge_tts',
        speech_voice: 'en-US-AriaNeural',
      }),
    );
  });

  it('records only while PTT is held and sends a bounded WAV utterance', async () => {
    await connectVoice();
    const ptt = beginRecording();
    await waitFor(() => expect(mocks.recorderStart).toHaveBeenCalledOnce());

    act(() => mocks.recorderOptions?.onFrameLevel?.(0.72));
    fireEvent.pointerUp(ptt, { pointerId: 1, button: 0 });

    await waitFor(() => expect(mocks.recorderStop).toHaveBeenCalledOnce());
    expect(mocks.socket?.messages).toContainEqual({
      type: 'speech.started',
      turn_id: '00000000-0000-4000-8000-000000000001',
      generation: 1,
    });
    expect(mocks.socket?.messages).toContainEqual(
      expect.objectContaining({ type: 'utterance.begin', duration_ms: 200, byte_length: 3200 }),
    );
    expect(mocks.socket?.binaries).toHaveLength(1);
  });

  it('supports tap-to-start/tap-to-send without restoring hands-free capture', async () => {
    const user = await connectVoice();
    await user.click(screen.getByRole('button', { name: 'O toca para empezar' }));
    await waitFor(() => expect(mocks.recorderStart).toHaveBeenCalledOnce());

    await user.click(screen.getByRole('button', { name: 'Toca para enviar' }));
    expect(mocks.recorderStop).toHaveBeenCalledOnce();
  });

  it('releases capture when focus leaves the page', async () => {
    await connectVoice();
    beginRecording();
    await waitFor(() => expect(mocks.recorderStart).toHaveBeenCalledOnce());

    fireEvent(window, new Event('blur'));

    expect(mocks.recorderCleanup).toHaveBeenCalledOnce();
    expect(mocks.socket?.messages).toContainEqual(
      expect.objectContaining({ type: 'response.cancel', generation: 1 }),
    );
  });

  it('persists a voice change without cancelling the active turn', async () => {
    const user = await connectVoice();
    beginRecording();
    await waitFor(() => expect(mocks.recorderStart).toHaveBeenCalledOnce());

    await user.selectOptions(screen.getByRole('combobox', { name: 'Voz' }), 'en-GB-SoniaNeural');

    expect(localStorage.getItem('vslingo:speech')).toContain('en-GB-SoniaNeural');
    expect(mocks.socket?.messages).toContainEqual({
      type: 'session.config',
      scenario: 'free',
      speech_provider: 'edge_tts',
      speech_voice: 'en-GB-SoniaNeural',
    });
    expect(mocks.socket?.messages).not.toContainEqual(
      expect.objectContaining({ type: 'response.cancel' }),
    );
  });

  it('falls back to one browser utterance per complete failed Edge segment', async () => {
    await connectVoice();
    beginRecording();
    await waitFor(() => expect(mocks.recorderStart).toHaveBeenCalledOnce());

    act(() => {
      mocks.socket?.emitMessage({
        type: 'assistant.segment',
        turn_id: '00000000-0000-4000-8000-000000000001',
        generation: 1,
        segment_id: 'segment-1',
        segment_index: 0,
        text: 'This is a complete sentence.',
      });
      mocks.socket?.emitMessage({
        type: 'error',
        code: 'speech_unavailable',
        message: 'Edge failed',
        retryable: true,
        fatal: false,
        turn_id: '00000000-0000-4000-8000-000000000001',
        generation: 1,
        segment_id: 'segment-1',
        segment_index: 0,
      });
    });

    expect(mocks.spoken).toHaveLength(1);
    act(() =>
      mocks.spoken[0].onstart?.call(
        mocks.spoken[0],
        new Event('start') as SpeechSynthesisEvent,
      ),
    );
    expect(mocks.socket?.messages).toContainEqual({
      type: 'playback.started',
      turn_id: '00000000-0000-4000-8000-000000000001',
      generation: 1,
      segment_id: 'segment-1',
      segment_index: 0,
      engine: 'browser',
    });
  });

  it('keeps completed segments and discards late MP3 after a later Edge failure', async () => {
    await connectVoice();
    beginRecording();
    await waitFor(() => expect(mocks.recorderStart).toHaveBeenCalledOnce());

    act(() => {
      mocks.socket?.emitMessage({
        type: 'assistant.segment',
        turn_id: '00000000-0000-4000-8000-000000000001',
        generation: 1,
        segment_id: 'segment-1',
        segment_index: 0,
        text: 'Already played.',
      });
      mocks.socket?.emitMessage({
        type: 'assistant.segment',
        turn_id: '00000000-0000-4000-8000-000000000001',
        generation: 1,
        segment_id: 'segment-2',
        segment_index: 1,
        text: 'Pending sentence.',
      });
      mocks.socket?.emitMessage({
        type: 'audio.begin',
        turn_id: '00000000-0000-4000-8000-000000000001',
        generation: 1,
        segment_id: 'segment-1',
        segment_index: 0,
        media_type: 'audio/mpeg',
        byte_length: 3,
      });
      mocks.socket?.emitBinary(new Uint8Array([1, 2, 3]).buffer);
      mocks.socket?.emitMessage({
        type: 'audio.end',
        turn_id: '00000000-0000-4000-8000-000000000001',
        generation: 1,
        segment_id: 'segment-1',
        segment_index: 0,
      });
    });
    mocks.schedulerEnqueue.mockClear();

    act(() => {
      mocks.socket?.emitMessage({
        type: 'error',
        code: 'speech_unavailable',
        message: 'Edge failed',
        retryable: true,
        fatal: false,
        generation: 1,
        segment_id: 'segment-2',
        segment_index: 1,
      });
      mocks.socket?.emitMessage({
        type: 'audio.begin',
        turn_id: '00000000-0000-4000-8000-000000000001',
        generation: 1,
        segment_id: 'segment-2',
        segment_index: 1,
        media_type: 'audio/mpeg',
        byte_length: 3,
      });
      mocks.socket?.emitBinary(new Uint8Array([1, 2, 3]).buffer);
    });

    expect(mocks.spoken).toHaveLength(1);
    expect(mocks.spoken[0].text).toBe('Pending sentence.');
    expect(mocks.schedulerEnqueue).not.toHaveBeenCalled();
  });

  it('stops local audio resources even when there is no active turn', async () => {
    const user = await connectVoice();
    await user.click(screen.getByRole('button', { name: 'Terminar práctica' }));

    expect(mocks.schedulerStopAll).toHaveBeenCalled();
    expect(mocks.speechCancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Activar micrófono' })).toBeInTheDocument();
  });
});
