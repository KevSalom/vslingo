import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVadClient } from './vadClient';

const mocks = vi.hoisted(() => ({
  options: null as null | {
    onSpeechStart: () => void;
    onVADMisfire: () => void;
    onSpeechEnd: (audio: Float32Array) => void;
  },
  start: vi.fn(async () => undefined),
  pause: vi.fn(async () => undefined),
  destroy: vi.fn(async () => undefined),
}));

vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: {
    new: vi.fn(async (options: NonNullable<typeof mocks.options>) => {
      mocks.options = options;
      return {
        start: mocks.start,
        pause: mocks.pause,
        destroy: mocks.destroy,
      };
    }),
  },
}));

describe('createVadClient', () => {
  beforeEach(() => {
    mocks.options = null;
    vi.clearAllMocks();
  });

  it('maps VAD misfires to turn cancellation and delegates lifecycle', async () => {
    const onSpeechCancel = vi.fn();
    const { MicVAD } = await import('@ricky0123/vad-web');
    const controller = await createVadClient({
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      onSpeechCancel,
      onError: vi.fn(),
    });

    expect(MicVAD.new).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, model: 'v5' }),
    );

    mocks.options?.onVADMisfire();
    await controller.start();
    await controller.pause();
    await controller.destroy();

    expect(onSpeechCancel).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('cancels an invalid short segment instead of dropping it silently', async () => {
    const onSpeechCancel = vi.fn();
    const onSpeechEnd = vi.fn();
    await createVadClient({
      onSpeechStart: vi.fn(),
      onSpeechEnd,
      onSpeechCancel,
      onError: vi.fn(),
    });

    mocks.options?.onSpeechEnd(new Float32Array(800));

    expect(onSpeechCancel).toHaveBeenCalledOnce();
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });

  it('emits calibrated frame level on onFrameProcessed', async () => {
    const onFrameLevel = vi.fn();
    await createVadClient({
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      onSpeechCancel: vi.fn(),
      onFrameLevel,
      onError: vi.fn(),
    });

    const speechFrame = new Float32Array(512).fill(0.04);
    (mocks.options as { onFrameProcessed?: (p: { isSpeech: number }, f: Float32Array) => void })
      ?.onFrameProcessed?.({ isSpeech: 0.9 }, speechFrame);

    expect(onFrameLevel).toHaveBeenCalledOnce();
    const emittedLevel = onFrameLevel.mock.calls[0][0];
    expect(emittedLevel).toBeGreaterThan(0.25);
    expect(emittedLevel).toBeLessThanOrEqual(1.0);
  });

  it('keeps animating through short mid-utterance dips and only drains on clear silence', async () => {
    const onFrameLevel = vi.fn();
    await createVadClient({
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      onSpeechCancel: vi.fn(),
      onFrameLevel,
      onError: vi.fn(),
    });

    const speechFrame = new Float32Array(512).fill(0.04);
    const frameProcessed = (
      mocks.options as {
        onFrameProcessed?: (p: { isSpeech: number }, f: Float32Array) => void;
      }
    )?.onFrameProcessed;

    frameProcessed?.({ isSpeech: 0.9 }, speechFrame);
    const peak = onFrameLevel.mock.calls.at(-1)?.[0] as number;
    expect(peak).toBeGreaterThan(0.25);

    // Mild isSpeech dip (end of a word) must NOT hard-zero the bars.
    frameProcessed?.({ isSpeech: 0.35 }, speechFrame);
    const midWord = onFrameLevel.mock.calls.at(-1)?.[0] as number;
    expect(midWord).toBeGreaterThan(0.15);

    // Clear silence drains toward idle without a hard cut on the peak frame alone.
    frameProcessed?.({ isSpeech: 0.05 }, speechFrame);
    const drained = onFrameLevel.mock.calls.at(-1)?.[0] as number;
    expect(drained).toBeLessThan(midWord);
  });

  it('resets visual level when speech ends or misfires', async () => {
    const onFrameLevel = vi.fn();
    await createVadClient({
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      onSpeechCancel: vi.fn(),
      onFrameLevel,
      onError: vi.fn(),
    });

    const speechFrame = new Float32Array(512).fill(0.04);
    (mocks.options as { onFrameProcessed?: (p: { isSpeech: number }, f: Float32Array) => void })
      ?.onFrameProcessed?.({ isSpeech: 0.9 }, speechFrame);
    onFrameLevel.mockClear();

    mocks.options?.onSpeechEnd(new Float32Array(3200));
    expect(onFrameLevel).toHaveBeenCalledWith(0);

    onFrameLevel.mockClear();
    mocks.options?.onVADMisfire();
    expect(onFrameLevel).toHaveBeenCalledWith(0);
  });
});
