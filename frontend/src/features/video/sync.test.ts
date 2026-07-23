import { describe, expect, it } from 'vitest';

import type { TranscriptSegment } from './types';
import { findActiveSegmentIndex, formatTimestamp } from './sync';

const SEGMENTS: TranscriptSegment[] = [
  { text: 'First.', start: 0, duration: 2 },
  { text: 'Second.', start: 3, duration: 2 },
  { text: 'Third.', start: 5, duration: 1 },
];

describe('findActiveSegmentIndex', () => {
  it.each([
    [-0.1, -1],
    [0, 0],
    [1.999, 0],
    [2, 0],
    [2.9, 0],
    [3, 1],
    [5.5, 2],
    [99, 2],
  ])('maps playback time %s to segment %s', (time, expected) => {
    expect(findActiveSegmentIndex(SEGMENTS, time)).toBe(expected);
  });

  it('returns the first strict match when captions overlap', () => {
    const overlapping = [
      { text: 'A', start: 0, duration: 5 },
      { text: 'B', start: 3, duration: 5 },
    ];

    expect(findActiveSegmentIndex(overlapping, 4)).toBe(0);
  });
});

describe('formatTimestamp', () => {
  it('formats stable minute and hour labels', () => {
    expect(formatTimestamp(5.9)).toBe('00:05');
    expect(formatTimestamp(65)).toBe('01:05');
    expect(formatTimestamp(3661)).toBe('01:01:01');
  });
});
