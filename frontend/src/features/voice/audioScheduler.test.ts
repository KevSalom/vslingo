import { describe, expect, it, vi } from 'vitest';
import { AudioScheduler } from './audioScheduler';

// Mock Web Audio Context for Vitest environment
function createMockAudioContext() {
  const sources: any[] = [];
  return {
    state: 'running',
    currentTime: 0.5,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createAnalyser: vi.fn().mockReturnValue({
      fftSize: 64,
      connect: vi.fn(),
    }),
    createBufferSource: vi.fn().mockImplementation(() => {
      const src = {
        buffer: null,
        onended: null as any,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(src);
      return src;
    }),
    decodeAudioData: vi.fn().mockImplementation(async (_buf: ArrayBuffer) => {
      return {
        duration: 1.5,
        numberOfChannels: 1,
        sampleRate: 44100,
      } as AudioBuffer;
    }),
    _sources: sources,
  } as unknown as AudioContext;
}

describe('AudioScheduler', () => {
  it('enqueues and drains contiguous segments', async () => {
    const mockCtx = createMockAudioContext();
    const onStart = vi.fn();
    const scheduler = new AudioScheduler({
      audioContext: mockCtx,
      onPlaybackStart: onStart,
    });

    const fakeBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await scheduler.enqueue({ generation: 1, index: 0, bytes: fakeBytes });

    expect(onStart).toHaveBeenCalledWith(1, 0);
  });

  it('stops all active playback on barge-in (stopAll)', async () => {
    const mockCtx = createMockAudioContext();
    const onIdle = vi.fn();
    const scheduler = new AudioScheduler({
      audioContext: mockCtx,
      onIdle,
    });

    const fakeBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await scheduler.enqueue({ generation: 1, index: 0, bytes: fakeBytes });

    scheduler.stopAll();
    expect(onIdle).toHaveBeenCalled();
  });
});


  it('discards a decode that resolves after stopAll', async () => {
    const mockCtx = createMockAudioContext();
    let resolveDecode: ((buffer: AudioBuffer) => void) | undefined;
    vi.mocked(mockCtx.decodeAudioData).mockImplementation(
      () =>
        new Promise<AudioBuffer>((resolve) => {
          resolveDecode = resolve;
        }),
    );
    const scheduler = new AudioScheduler({ audioContext: mockCtx });

    const enqueuePromise = scheduler.enqueue({
      generation: 1,
      index: 0,
      bytes: new Uint8Array([1, 2, 3]).buffer,
    });
    scheduler.stopAll();
    resolveDecode?.({ duration: 1 } as AudioBuffer);
    await enqueuePromise;

    expect(mockCtx.createBufferSource).not.toHaveBeenCalled();
  });
