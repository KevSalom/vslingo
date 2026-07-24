/**
 * AudioScheduler manages Web Audio playback of contiguous TTS MP3 segments
 * with generation-aware cancellation and immediate stopAll (barge-in).
 */

export interface AudioSchedulerOptions {
  audioContext?: AudioContext;
  onPlaybackStart?: (generation: number, index: number) => void;
  onSegmentEnd?: (generation: number, index: number) => void;
  onIdle?: () => void;
  onError?: (error: Error) => void;
}

export interface SegmentPayload {
  generation: number;
  index: number;
  bytes: ArrayBuffer;
}

export class AudioScheduler {
  private audioCtx: AudioContext | null = null;
  private ownContext = false;
  private analyser: AnalyserNode | null = null;
  private activeGeneration = 0;
  private nextExpectedIndex = 0;
  private previousEndTime = 0;
  private cancellationEpoch = 0;
  private pendingSegments = new Map<number, AudioBuffer>();
  private activeSources: Set<AudioBufferSourceNode> = new Set();

  private onPlaybackStart?: (generation: number, index: number) => void;
  private onSegmentEnd?: (generation: number, index: number) => void;
  private onIdle?: () => void;
  private onError?: (error: Error) => void;

  constructor(options: AudioSchedulerOptions = {}) {
    if (options.audioContext) {
      this.audioCtx = options.audioContext;
    }
    this.onPlaybackStart = options.onPlaybackStart;
    this.onSegmentEnd = options.onSegmentEnd;
    this.onIdle = options.onIdle;
    this.onError = options.onError;
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  public initContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      this.ownContext = true;
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
    if (!this.analyser) {
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.connect(this.audioCtx.destination);
    }
    return this.audioCtx;
  }

  public async enqueue(segment: SegmentPayload): Promise<void> {
    if (segment.generation < this.activeGeneration) {
      return;
    }

    if (segment.generation > this.activeGeneration) {
      this.cancelBefore(segment.generation);
      this.activeGeneration = segment.generation;
      this.nextExpectedIndex = 0;
      this.previousEndTime = 0;
    }

    const ctx = this.initContext();
    const decodeEpoch = this.cancellationEpoch;

    try {
      // Slice array buffer to prevent detachment issues
      const bufferCopy = segment.bytes.slice(0);
      const audioBuffer = await ctx.decodeAudioData(bufferCopy);

      if (
        segment.generation !== this.activeGeneration ||
        decodeEpoch !== this.cancellationEpoch
      ) {
        return;
      }

      this.pendingSegments.set(segment.index, audioBuffer);
      this.drainQueue();
    } catch (err) {
      if (this.onError && err instanceof Error) {
        this.onError(err);
      }
    }
  }

  private drainQueue(): void {
    if (!this.audioCtx) return;

    while (this.pendingSegments.has(this.nextExpectedIndex)) {
      const index = this.nextExpectedIndex;
      const buffer = this.pendingSegments.get(index)!;
      this.pendingSegments.delete(index);

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;

      if (this.analyser) {
        source.connect(this.analyser);
      } else {
        source.connect(this.audioCtx.destination);
      }

      const currentTime = this.audioCtx.currentTime;
      const startAt = Math.max(currentTime + 0.02, this.previousEndTime);
      this.previousEndTime = startAt + buffer.duration;

      const gen = this.activeGeneration;
      this.activeSources.add(source);

      if (this.onPlaybackStart) {
        this.onPlaybackStart(gen, index);
      }

      source.onended = () => {
        source.disconnect();
        this.activeSources.delete(source);
        if (this.onSegmentEnd) {
          this.onSegmentEnd(gen, index);
        }
        if (this.activeSources.size === 0 && this.pendingSegments.size === 0) {
          if (this.onIdle) {
            this.onIdle();
          }
        }
      };

      source.start(startAt);
      this.nextExpectedIndex++;
    }
  }

  public cancelBefore(generation: number): void {
    if (generation > this.activeGeneration) {
      this.stopAll();
      this.activeGeneration = generation;
    }
  }

  public stopAll(): void {
    this.cancellationEpoch += 1;
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // ignore already stopped source
      }
    }
    this.activeSources.clear();
    this.pendingSegments.clear();
    this.nextExpectedIndex = 0;
    this.previousEndTime = 0;

    if (this.onIdle) {
      this.onIdle();
    }
  }

  public async close(): Promise<void> {
    this.stopAll();
    if (this.ownContext && this.audioCtx && this.audioCtx.state !== 'closed') {
      await this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
