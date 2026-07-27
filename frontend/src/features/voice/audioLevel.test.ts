import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOISE_FLOOR,
  DEFAULT_SPEECH_REFERENCE,
  createAmplitudeMeter,
} from './audioLevel';

/**
 * Old unfixed linear mapping function for comparison during Property 1 exploration.
 */
function legacyLinearMapping(rawRms: number): number {
  return Math.min(1, Math.max(0, rawRms * 8));
}

/**
 * In VoiceStudio, central bar scale calculation:
 * Math.max(0.14, min(1, 0.14 + level * centerWeight * 0.86))
 */
function centralBarScale(visualLevel: number): number {
  const centerWeight = 0.5; // representative middle-side bar weight
  return Math.max(0.14, Math.min(1, 0.14 + visualLevel * centerWeight * 0.86));
}

describe('Audio Waveform Amplitude — Property 1: Bug Condition Exploration & Verification', () => {
  it('demonstrates defect in legacy linear mapping (rms * 8)', () => {
    // With the pre-fix tiny bar base + linear map, moderate RMS stayed near floor.
    const legacyBarFloor = (visualLevel: number) => Math.max(0.12, visualLevel * 0.5);
    const normalSpeechRmsValues = [0.015, 0.02, 0.03];

    for (const rms of normalSpeechRmsValues) {
      const legacyLevel = legacyLinearMapping(rms);
      // Defect: rms=0.02 -> level 0.16 -> scale max(0.12, 0.08) = 0.12 (flat)
      expect(legacyBarFloor(legacyLevel)).toBeLessThanOrEqual(0.15);
    }
  });

  it('proves calibrated amplitude meter resolves bug condition for normal & strong speech', () => {
    const meter = createAmplitudeMeter();

    // Silence baseline
    const silenceLevel = meter.processFrame(0.00005);
    meter.reset();

    // Sustained normal speech (e.g. RMS = 0.0022 over 5 frames)
    let normalSpeechLevel = 0;
    for (let i = 0; i < 5; i++) {
      normalSpeechLevel = meter.processFrame(0.0022);
    }
    meter.reset();

    // Sustained strong speech (e.g. RMS = 0.008 over 5 frames)
    let strongSpeechLevel = 0;
    for (let i = 0; i < 5; i++) {
      strongSpeechLevel = meter.processFrame(0.008);
    }

    // Property 1 Assertions:
    // 1. Output is bounded in [0, 1]
    expect(normalSpeechLevel).toBeGreaterThanOrEqual(0);
    expect(normalSpeechLevel).toBeLessThanOrEqual(1);
    expect(strongSpeechLevel).toBeGreaterThanOrEqual(0);
    expect(strongSpeechLevel).toBeLessThanOrEqual(1);

    // 2. Clearly above silence / low signal
    expect(normalSpeechLevel).toBeGreaterThan(silenceLevel + 0.25);
    expect(centralBarScale(normalSpeechLevel)).toBeGreaterThan(0.20);

    // 3. Grows monotonically with voice amplitude
    expect(strongSpeechLevel).toBeGreaterThan(normalSpeechLevel);
  });
});

describe('Audio Waveform Amplitude — Property 2: Preservation & Boundary Checks', () => {
  it('preserves low, stable output for silence and background noise', () => {
    const meter = createAmplitudeMeter();
    const noiseLevels = [0, 0.00002, 0.00005, DEFAULT_NOISE_FLOOR, DEFAULT_NOISE_FLOOR * 1.1];

    for (const noiseRms of noiseLevels) {
      meter.reset();
      let level = 0;
      for (let i = 0; i < 4; i++) level = meter.processFrame(noiseRms);
      // Low signal remains low and stable (below low-signal baseline)
      expect(level).toBeLessThan(0.08);
      expect(centralBarScale(level)).toBeLessThan(0.18);
    }
  });

  it('renders gradual volume changes with smooth, bounded transitions', () => {
    const meter = createAmplitudeMeter();

    // Gradual rising ramp: 0 -> 0.05
    const rampSteps = [0.005, 0.01, 0.02, 0.03, 0.04, 0.05];
    let previousLevel = 0;

    for (const rmsStep of rampSteps) {
      const currentLevel = meter.processFrame(rmsStep);

      // Monotonic ascent during sustained rising ramp
      expect(currentLevel).toBeGreaterThanOrEqual(previousLevel);

      // Smoothing limit: single frame step is bounded by attack factor
      const delta = currentLevel - previousLevel;
      expect(delta).toBeLessThanOrEqual(0.8);

      previousLevel = currentLevel;
    }
  });

  it('handles invalid, out-of-range, or NaN raw RMS values safely', () => {
    const instantMeter = createAmplitudeMeter({ attackFactor: 1.0 });

    expect(instantMeter.processFrame(-0.5)).toBe(0);
    expect(instantMeter.processFrame(NaN)).toBe(0);
    expect(instantMeter.processFrame(Infinity)).toBe(1);
    expect(instantMeter.processFrame(2.5)).toBe(1);
  });
});

describe('createAmplitudeMeter unit tests', () => {
  it('suppresses noise floor below configured threshold', () => {
    const meter = createAmplitudeMeter({ noiseFloor: 0.01 });

    expect(meter.processFrame(0.005)).toBe(0);
    expect(meter.processFrame(0.009)).toBe(0);
  });

  it('saturates at 1.0 when raw RMS meets or exceeds speech reference', () => {
    const meter = createAmplitudeMeter({ speechReference: 0.05, attackFactor: 1.0 });

    const level = meter.processFrame(0.05);
    expect(level).toBe(1.0);
  });

  it('applies independent attack and release smoothing factors', () => {
    const meter = createAmplitudeMeter({ attackFactor: 0.5, releaseFactor: 0.2 });

    // Attack (target = 1.0, current = 0 -> 0 + (1 - 0) * 0.5 = 0.5)
    const attackLevel = meter.processFrame(DEFAULT_SPEECH_REFERENCE);
    expect(attackLevel).toBeCloseTo(0.5, 4);

    // Release (target = 0, current = 0.5 -> 0.5 + (0 - 0.5) * 0.2 = 0.4)
    const releaseLevel = meter.processFrame(0);
    expect(releaseLevel).toBeCloseTo(0.4, 4);
  });

  it('resets internal state on reset() call', () => {
    const meter = createAmplitudeMeter({ attackFactor: 1.0 });

    meter.processFrame(DEFAULT_SPEECH_REFERENCE);
    expect(meter.getLevel()).toBe(1.0);

    meter.reset();
    expect(meter.getLevel()).toBe(0);
  });
});
