import {
  isCorrectionResponse,
  isRecord,
  type CorrectionResponse,
  type WritingErrorCode,
} from './types';

const DEFAULT_API_BASE_URL =
  import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

export type WritingApiOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export class WritingRequestError extends Error {
  readonly code: WritingErrorCode;
  readonly retryable: boolean;

  constructor(
    code: WritingErrorCode,
    message: string,
    retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'WritingRequestError';
    this.code = code;
    this.retryable = retryable;
  }
}

export async function correctWriting(
  text: string,
  options: WritingApiOptions = {},
): Promise<CorrectionResponse> {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');

  let response: Response;
  try {
    response = await fetcher(`${baseUrl}/api/writing/correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (cause) {
    throw new WritingRequestError(
      'network_error',
      'No se pudo conectar con el servidor de corrección.',
      true,
      { cause },
    );
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw serverError(payload);
  }
  if (!isCorrectionResponse(payload)) {
    throw new WritingRequestError(
      'invalid_response',
      'El servidor devolvió una corrección que no se puede mostrar.',
      true,
    );
  }
  return payload;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new WritingRequestError(
      'invalid_response',
      'El servidor devolvió una respuesta inválida.',
      true,
      { cause },
    );
  }
}

function serverError(payload: unknown): WritingRequestError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const { code, message, retryable } = payload.error;
    if (
      isWritingErrorCode(code) &&
      typeof message === 'string' &&
      typeof retryable === 'boolean'
    ) {
      return new WritingRequestError(code, message, retryable);
    }
  }

  return new WritingRequestError(
    'request_failed',
    'No se pudo completar la corrección. Inténtalo de nuevo.',
    true,
  );
}

function isWritingErrorCode(value: unknown): value is WritingErrorCode {
  return (
    typeof value === 'string' &&
    [
      'empty_text',
      'text_too_long',
      'provider_not_configured',
      'provider_timeout',
      'provider_unavailable',
      'invalid_provider_response',
      'invalid_request',
    ].includes(value)
  );
}
