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
    const controller = await createVadClient({
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      onSpeechCancel,
      onError: vi.fn(),
    });

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
});
