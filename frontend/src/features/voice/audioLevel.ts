/**
 * Calibrated visual amplitude meter for voice activity visualization.
 * Maps raw frame RMS to a perceptual, smoothed visual level in [0, 1].
 */

export interface AmplitudeMeterConfig {
  noiseFloor?: number;
  speechReference?: number;
  attackFactor?: number;
  releaseFactor?: number;
  activityGate?: number;
  idleSnap?: number;
}

export interface AmplitudeMeter {
  processFrame: (rawRms: number) => number;
  reset: () => void;
  getLevel: () => number;
}

/** Ignore mic energy at or below this RMS (room hiss / fan). */
export const DEFAULT_NOISE_FLOOR = 0.0007;
/** RMS that maps to full visual level after the perceptual curve. */
export const DEFAULT_SPEECH_REFERENCE = 0.0045;
export const DEFAULT_ATTACK_FACTOR = 0.7;
/** Faster ring-down so bars don't keep bobbing after the speech peak. */
export const DEFAULT_RELEASE_FACTOR = 0.55;
/** Soft visual gate: levels below this collapse toward idle. */
export const DEFAULT_ACTIVITY_GATE = 0.18;
/** Snap residual textured noise to idle instead of a long exponential tail. */
export const DEFAULT_IDLE_SNAP = 0.04;

/**
 * Creates a stateful amplitude meter that normalizes RMS energy,
 * applies a perceptual compression curve, and smooths temporal transitions.
 */
export function createAmplitudeMeter(config: AmplitudeMeterConfig = {}): AmplitudeMeter {
  const noiseFloor = config.noiseFloor ?? DEFAULT_NOISE_FLOOR;
  const speechReference = config.speechReference ?? DEFAULT_SPEECH_REFERENCE;
  const attackFactor = config.attackFactor ?? DEFAULT_ATTACK_FACTOR;
  const releaseFactor = config.releaseFactor ?? DEFAULT_RELEASE_FACTOR;
  const activityGate = config.activityGate ?? DEFAULT_ACTIVITY_GATE;
  const idleSnap = config.idleSnap ?? DEFAULT_IDLE_SNAP;

  let currentLevel = 0;

  return {
    processFrame(rawRms: number): number {
      const validRms = Number.isNaN(rawRms) ? 0 : rawRms;
      const clampedRms = Math.max(0, Math.min(1, validRms));

      let target = 0;
      if (clampedRms > noiseFloor) {
        const normalized = Math.min(
          1,
          (clampedRms - noiseFloor) / Math.max(1e-6, speechReference - noiseFloor),
        );
        // Moderate curve: speech fills the range; faint noise stays very low.
        target = Math.pow(normalized, 0.45);
        // Hard visual gate — ambient reflection below this collapses to idle.
        if (target < activityGate) {
          target = 0;
        }
      }

      const factor = target > currentLevel ? attackFactor : releaseFactor;
      currentLevel = currentLevel + (target - currentLevel) * factor;
      if (target === 0 && currentLevel < idleSnap) {
        currentLevel = 0;
      }
      currentLevel = Math.max(0, Math.min(1, currentLevel));

      return currentLevel;
    },

    reset(): void {
      currentLevel = 0;
    },

    getLevel(): number {
      return currentLevel;
    },
  };
}
