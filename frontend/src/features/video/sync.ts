import type { TranscriptSegment } from './types';

/**
 * Match the reference player semantics: prefer the first strict interval match,
 * then keep the most recently started caption visible across timing gaps.
 */
export function findActiveSegmentIndex(
  segments: readonly TranscriptSegment[],
  currentTime: number,
): number {
  if (!Number.isFinite(currentTime) || currentTime < 0 || segments.length === 0) {
    return -1;
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (
      currentTime >= segment.start &&
      currentTime < segment.start + segment.duration
    ) {
      return index;
    }
  }

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (currentTime >= segments[index].start) {
      return index;
    }
  }

  return -1;
}

export function formatTimestamp(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  const minuteLabel = minutes.toString().padStart(2, '0');
  const secondLabel = remainingSeconds.toString().padStart(2, '0');

  if (hours === 0) {
    return `${minuteLabel}:${secondLabel}`;
  }
  return `${hours.toString().padStart(2, '0')}:${minuteLabel}:${secondLabel}`;
}
