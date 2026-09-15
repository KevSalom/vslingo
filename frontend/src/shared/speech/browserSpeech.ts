import type { EdgeVoiceId } from './types';

export type BrowserSpeechSegment = {
  turnId: string;
  generation: number;
  segmentId: string;
  index: number;
  text: string;
};

export type BrowserPlaybackEvent = BrowserSpeechSegment & { engine: 'browser' };

type CoordinatorCallbacks = {
  onStarted?: (event: BrowserPlaybackEvent) => void;
  onCompleted?: (event: BrowserPlaybackEvent) => void;
  onFailed?: (event: BrowserPlaybackEvent) => void;
};

function preferredLocale(voice: EdgeVoiceId): string {
  return voice.startsWith('en-GB') ? 'en-GB' : 'en-US';
}

export class BrowserSpeechCoordinator {
  private generation = 0;
  private epoch = 0;
  private readonly queued = new Set<string>();
  private voiceId: EdgeVoiceId = 'en-US-AriaNeural';

  constructor(
    private readonly synthesis: SpeechSynthesis,
    private readonly callbacks: CoordinatorCallbacks = {},
  ) {}

  setVoice(voice: EdgeVoiceId): void {
    this.voiceId = voice;
  }

  queue(segment: BrowserSpeechSegment): void {
    if (segment.generation < this.generation || !segment.text.trim()) return;
    if (segment.generation > this.generation) this.cancelBefore(segment.generation);
    const key = `${segment.generation}:${segment.segmentId}`;
    if (this.queued.has(key)) return;
    this.queued.add(key);

    const currentEpoch = this.epoch;
    const utterance = new SpeechSynthesisUtterance(segment.text);
    utterance.lang = preferredLocale(this.voiceId);
    const voices = this.synthesis.getVoices();
    utterance.voice =
      voices.find((voice) => voice.name === this.voiceId) ??
      voices.find((voice) => voice.lang === utterance.lang && voice.localService) ??
      voices.find((voice) => voice.lang.startsWith('en')) ??
      null;
    const event = { ...segment, engine: 'browser' as const };
    utterance.onstart = () => {
      if (currentEpoch === this.epoch) this.callbacks.onStarted?.(event);
    };
    utterance.onend = () => {
      if (currentEpoch === this.epoch) this.callbacks.onCompleted?.(event);
    };
    utterance.onerror = () => {
      if (currentEpoch === this.epoch) this.callbacks.onFailed?.(event);
    };
    this.synthesis.speak(utterance);
  }

  cancelBefore(generation: number): void {
    this.generation = generation;
    this.epoch += 1;
    this.queued.clear();
    this.synthesis.cancel();
  }

  stop(): void {
    this.cancelBefore(this.generation);
  }
}
