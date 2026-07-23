import {
  isRecord,
  isTranscriptResponse,
  type TranscriptResponse,
  type VideoErrorCode,
} from './types';

const DEFAULT_API_BASE_URL =
  import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

export type VideoApiOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

export class VideoRequestError extends Error {
  readonly code: VideoErrorCode;
  readonly retryable: boolean;

  constructor(
    code: VideoErrorCode,
    message: string,
    retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VideoRequestError';
    this.code = code;
    this.retryable = retryable;
  }
}

export async function fetchVideoTranscript(
  url: string,
  options: VideoApiOptions = {},
): Promise<TranscriptResponse> {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');

  let response: Response;
  try {
    response = await fetcher(`${baseUrl}/api/video/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: options.signal,
    });
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    if (options.signal?.aborted) {
      throw new DOMException('The transcript request was aborted.', 'AbortError');
    }
    throw new VideoRequestError(
      'network_error',
      'No se pudo conectar con el servidor de transcripciones. Usa la demo técnica.',
      true,
      { cause },
    );
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw serverError(payload);
  }
  if (!isTranscriptResponse(payload)) {
    throw new VideoRequestError(
      'invalid_response',
      'El servidor devolvió una transcripción que no se puede mostrar.',
      true,
    );
  }
  return payload;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new VideoRequestError(
      'invalid_response',
      'El servidor devolvió una respuesta inválida.',
      true,
      { cause },
    );
  }
}

function serverError(payload: unknown): VideoRequestError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const { code, message, retryable } = payload.error;
    if (
      isVideoErrorCode(code) &&
      typeof message === 'string' &&
      typeof retryable === 'boolean'
    ) {
      return new VideoRequestError(code, message, retryable);
    }
  }

  return new VideoRequestError(
    'request_failed',
    'No se pudo cargar la transcripción. Inténtalo de nuevo o usa la demo técnica.',
    true,
  );
}

function isAbortError(value: unknown): value is DOMException {
  return value instanceof DOMException && value.name === 'AbortError';
}

function isVideoErrorCode(value: unknown): value is VideoErrorCode {
  return (
    typeof value === 'string' &&
    [
      'invalid_url',
      'captions_unavailable',
      'provider_blocked',
      'provider_timeout',
      'provider_unavailable',
      'invalid_provider_response',
      'invalid_request',
    ].includes(value)
  );
}
