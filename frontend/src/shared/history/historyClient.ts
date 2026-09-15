import type { TranscriptResponse } from '../../features/video/types';
import type { VoiceFeedback } from '../../features/voice/protocol';
import type { CorrectionResponse } from '../../features/writing/types';
import { authenticatedFetch } from '../auth/sessionClient';

const API_BASE_URL = import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

export class HistoryRequestError extends Error {
  constructor(
    message: string,
    readonly code = 'history_failed',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'HistoryRequestError';
  }
}

export type WritingHistoryEntry = CorrectionResponse & {
  id: string;
  operation_id: string;
  created_at: string;
};

export type SavedVideoEntry = TranscriptResponse & {
  id: string;
  title: string;
  url: string;
  created_at: string;
  updated_at: string;
};

export type SavedNoteEntry = {
  id: string;
  video_id: string | null;
  title: string;
  text: string;
  timestamp: number | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type VoiceConversationEntry = {
  id: string;
  scenario: string;
  title: string;
  created_at: string;
  updated_at: string;
  turns?: Array<{
    id: string;
    operation_id: string;
    user_text: string;
    assistant_text: string;
    feedback: VoiceFeedback | null;
  }>;
};

type ClientOptions = { baseUrl?: string; fetcher?: typeof fetch };

export async function saveWritingHistory(
  result: CorrectionResponse,
  operationId: string = crypto.randomUUID(),
  options: ClientOptions = {},
): Promise<WritingHistoryEntry> {
  return request('/api/history/writings', {
    method: 'POST',
    body: JSON.stringify({ operation_id: operationId, ...result }),
  }, options) as Promise<WritingHistoryEntry>;
}

export async function listWritingHistory(
  options: ClientOptions = {},
): Promise<WritingHistoryEntry[]> {
  const result = await request('/api/history/writings', {}, options) as {
    items?: WritingHistoryEntry[];
  };
  return Array.isArray(result.items) ? result.items : [];
}

export async function saveVideoHistory(
  title: string,
  url: string,
  transcript: TranscriptResponse,
  options: ClientOptions = {},
): Promise<SavedVideoEntry> {
  return request('/api/history/videos', {
    method: 'POST',
    body: JSON.stringify({ title, url, ...transcript }),
  }, options) as Promise<SavedVideoEntry>;
}

export async function listVideoHistory(options: ClientOptions = {}): Promise<SavedVideoEntry[]> {
  const result = await request('/api/history/videos', {}, options) as {
    items?: SavedVideoEntry[];
  };
  return Array.isArray(result.items) ? result.items : [];
}

export async function deleteVideoHistory(id: string, options: ClientOptions = {}): Promise<void> {
  await request(`/api/history/videos/${encodeURIComponent(id)}`, { method: 'DELETE' }, options);
}

export async function deleteWritingHistory(id: string, options: ClientOptions = {}): Promise<void> {
  await request(`/api/history/writings/${encodeURIComponent(id)}`, { method: 'DELETE' }, options);
}

export async function saveNoteHistory(
  note: { client_id?: string; video_id?: string; title: string; text: string; timestamp?: number },
  options: ClientOptions = {},
): Promise<SavedNoteEntry> {
  return request('/api/history/notes', {
    method: 'POST',
    body: JSON.stringify({ ...note, video_id: note.video_id ?? null, timestamp: note.timestamp ?? null }),
  }, options) as Promise<SavedNoteEntry>;
}

export async function updateNoteHistory(
  id: string,
  note: { title: string; text: string; timestamp?: number; version: number },
  options: ClientOptions = {},
): Promise<SavedNoteEntry> {
  return request(`/api/history/notes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...note, timestamp: note.timestamp ?? null }),
  }, options) as Promise<SavedNoteEntry>;
}

export async function listNoteHistory(options: ClientOptions = {}): Promise<SavedNoteEntry[]> {
  const result = await request('/api/history/notes', {}, options) as {
    items?: SavedNoteEntry[];
  };
  return Array.isArray(result.items) ? result.items : [];
}

export async function deleteNoteHistory(id: string, options: ClientOptions = {}): Promise<void> {
  await request(`/api/history/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }, options);
}

export async function createVoiceConversation(
  scenario: string,
  options: ClientOptions = {},
): Promise<{ id: string }> {
  return request('/api/history/conversations', {
    method: 'POST',
    body: JSON.stringify({ scenario }),
  }, options) as Promise<{ id: string }>;
}

export async function listVoiceConversations(
  options: ClientOptions = {},
): Promise<VoiceConversationEntry[]> {
  const result = await request('/api/history/conversations', {}, options) as {
    items?: VoiceConversationEntry[];
  };
  return Array.isArray(result.items) ? result.items : [];
}

export async function getVoiceConversation(
  id: string,
  options: ClientOptions = {},
): Promise<VoiceConversationEntry> {
  return request(
    `/api/history/conversations/${encodeURIComponent(id)}`,
    {},
    options,
  ) as Promise<VoiceConversationEntry>;
}

export async function deleteVoiceConversation(
  id: string,
  options: ClientOptions = {},
): Promise<void> {
  await request(
    `/api/history/conversations/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    options,
  );
}

export async function saveVoiceTurn(
  conversationId: string,
  turn: { operation_id: string; user_text: string; assistant_text: string },
  options: ClientOptions = {},
): Promise<{ id: string }> {
  return request(`/api/history/conversations/${encodeURIComponent(conversationId)}/turns`, {
    method: 'POST',
    body: JSON.stringify(turn),
  }, options) as Promise<{ id: string }>;
}

export async function saveVoiceFeedback(
  turnId: string,
  feedback: VoiceFeedback,
  options: ClientOptions = {},
): Promise<void> {
  await request(`/api/history/turns/${encodeURIComponent(turnId)}/feedback`, {
    method: 'PATCH',
    body: JSON.stringify({ feedback }),
  }, options);
}

async function request(
  path: string,
  init: RequestInit,
  options: ClientOptions,
): Promise<unknown> {
  let response: Response;
  try {
    response = await authenticatedFetch(
      options.fetcher ?? fetch,
      `${(options.baseUrl ?? API_BASE_URL).replace(/\/$/, '')}${path}`,
      {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init.headers },
      },
    );
  } catch (cause) {
    throw new HistoryRequestError(
      'No se pudo guardar. Conservamos el resultado en pantalla.',
      'history_failed',
      { cause },
    );
  }
  const payload: unknown = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const code = readErrorCode(payload);
    throw new HistoryRequestError(
      code === 'note_conflict'
        ? 'La nota cambió en otra sesión. Conservamos ambas versiones.'
        : 'No se pudo guardar. Conservamos el resultado en pantalla.',
      code,
    );
  }
  return payload;
}

function readErrorCode(payload: unknown): string {
  if (
    typeof payload === 'object' && payload !== null && 'error' in payload &&
    typeof payload.error === 'object' && payload.error !== null && 'code' in payload.error &&
    typeof payload.error.code === 'string'
  ) return payload.error.code;
  return 'history_failed';
}
