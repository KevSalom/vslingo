import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserSpeechCoordinator } from '../browserSpeech';

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

function createSynthesis() {
  const spoken: SpeechSynthesisUtterance[] = [];
  return {
    spoken,
    api: {
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => spoken.push(utterance)),
    } as unknown as SpeechSynthesis,
  };
}

describe('BrowserSpeechCoordinator', () => {
  beforeEach(() => {
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  });

  it('speaks each complete segment once and acknowledges browser playback', () => {
    const synthesis = createSynthesis();
    const onStarted = vi.fn();
    const coordinator = new BrowserSpeechCoordinator(synthesis.api, { onStarted });

    coordinator.queue({ turnId: 'turn-1', generation: 1, segmentId: 'seg-1', index: 0, text: 'Hello.' });
    coordinator.queue({ turnId: 'turn-1', generation: 1, segmentId: 'seg-1', index: 0, text: 'Hello.' });

    expect(synthesis.spoken).toHaveLength(1);
    synthesis.spoken[0].onstart?.call(
      synthesis.spoken[0],
      new Event('start') as SpeechSynthesisEvent,
    );
    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ engine: 'browser', segmentId: 'seg-1' }));
  });

  it('cancels both queued speech and stale callbacks when generation changes', () => {
    const synthesis = createSynthesis();
    const onCompleted = vi.fn();
    const coordinator = new BrowserSpeechCoordinator(synthesis.api, { onCompleted });

    coordinator.queue({ turnId: 'turn-1', generation: 1, segmentId: 'seg-1', index: 0, text: 'Old.' });
    const stale = synthesis.spoken[0];
    coordinator.cancelBefore(2);
    stale.onend?.call(stale, new Event('end') as SpeechSynthesisEvent);

    expect(synthesis.api.cancel).toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
