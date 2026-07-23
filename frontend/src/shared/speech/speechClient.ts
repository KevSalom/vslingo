import type { SpeechErrorResponse, SpeechProvider } from './types';

const DEFAULT_API_BASE_URL =
  import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

export class SpeechClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string = 'client_error', retryable: boolean = false) {
    super(message);
    this.name = 'SpeechClientError';
    this.code = code;
    this.retryable = retryable;
  }
}

export type SynthesizeOptions = {
  text: string;
  provider: SpeechProvider;
  voice?: string | null;
  baseUrl?: string;
  signal?: AbortSignal;
};

export async function synthesizeSpeech(options: SynthesizeOptions): Promise<Blob> {
  const { text, provider, voice = null, signal } = options;
  const baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        provider,
        voice,
      }),
      signal,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw cause;
    }
    throw new SpeechClientError(
      'No se pudo conectar con el servicio de voz. Comprueba tu conexión.',
      'network_error',
      true,
    );
  }

  if (!response.ok) {
    let errorData: SpeechErrorResponse | null = null;
    try {
      errorData = (await response.json()) as SpeechErrorResponse;
    } catch {
      // Body was not JSON
    }
    if (errorData?.error) {
      throw new SpeechClientError(
        errorData.error.message,
        errorData.error.code,
        errorData.error.retryable,
      );
    }
    throw new SpeechClientError(
      'El servicio de voz devolvió un error inesperado.',
      'http_error',
      true,
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('audio/mpeg')) {
    throw new SpeechClientError(
      'El formato de audio devuelto no es válido (se requiere MP3).',
      'invalid_provider_response',
      true,
    );
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new SpeechClientError(
      'La respuesta del servicio de voz estaba vacía.',
      'invalid_provider_response',
      true,
    );
  }

  return blob;
}
