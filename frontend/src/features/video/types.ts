export const MAX_TRANSCRIPT_SEGMENTS = 2_000;
export const MAX_TRANSCRIPT_SEGMENT_LENGTH = 2_000;

export type TranscriptSource = 'youtube' | 'fixture';

export type TranscriptSegment = {
  text: string;
  start: number;
  duration: number;
};

export type TranscriptResponse = {
  video_id: string;
  source: TranscriptSource;
  segments: TranscriptSegment[];
};

export type VideoErrorCode =
  | 'invalid_url'
  | 'captions_unavailable'
  | 'provider_blocked'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'invalid_provider_response'
  | 'invalid_request'
  | 'invalid_response'
  | 'network_error'
  | 'request_failed';

export type TranscriptViewMode = 'paragraph' | 'line';

export type VideoLibraryItem = {
  id: string;
  title: string;
  url: string;
  videoId: string;
  source: TranscriptSource;
};

export type VideoNote = {
  id: string;
  videoId: string;
  timestamp: number;
  text: string;
  createdAt: string;
};

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isTranscriptResponse(value: unknown): value is TranscriptResponse {
  if (
    !isRecord(value) ||
    !isVideoId(value.video_id) ||
    !isTranscriptSource(value.source) ||
    !Array.isArray(value.segments) ||
    value.segments.length === 0 ||
    value.segments.length > MAX_TRANSCRIPT_SEGMENTS ||
    !value.segments.every(isTranscriptSegment)
  ) {
    return false;
  }

  for (let index = 1; index < value.segments.length; index += 1) {
    if (value.segments[index].start < value.segments[index - 1].start) {
      return false;
    }
  }
  return true;
}

export function isVideoLibraryItem(value: unknown): value is VideoLibraryItem {
  return (
    isRecord(value) &&
    isBoundedString(value.id, 100) &&
    isBoundedString(value.title, 200) &&
    isBoundedString(value.url, 2_048) &&
    isVideoId(value.videoId) &&
    isTranscriptSource(value.source)
  );
}

export function isVideoNote(value: unknown): value is VideoNote {
  return (
    isRecord(value) &&
    isBoundedString(value.id, 100) &&
    isVideoId(value.videoId) &&
    isFiniteNonNegative(value.timestamp) &&
    isBoundedString(value.text, 2_000) &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTranscriptSource(value: unknown): value is TranscriptSource {
  return value === 'youtube' || value === 'fixture';
}

export function isVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID_PATTERN.test(value);
}

function isTranscriptSegment(value: unknown): value is TranscriptSegment {
  return (
    isRecord(value) &&
    isBoundedString(value.text, MAX_TRANSCRIPT_SEGMENT_LENGTH) &&
    isFiniteNonNegative(value.start) &&
    typeof value.duration === 'number' &&
    Number.isFinite(value.duration) &&
    value.duration > 0
  );
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
