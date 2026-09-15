const DEFAULT_API_BASE_URL =
  import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

const DEV_SESSION_TOKEN = 'dev-session-token';
const ACCOUNT_CONTENT_KEYS = [
  'vslingo:writing',
  'vslingo:video',
  'vslingo:voice',
  'vslingo:speech',
] as const;
const ACTIVE_USER_KEY = 'ingles-al-grano:active-user';

export type AuthTokenProvider = () => Promise<string | null>;

const developmentTokenProvider: AuthTokenProvider = async () => DEV_SESSION_TOKEN;
let tokenProvider: AuthTokenProvider = developmentTokenProvider;

export function setAuthTokenProvider(provider: AuthTokenProvider): void {
  tokenProvider = provider;
}

export function resetAuthTokenProvider(): void {
  tokenProvider = developmentTokenProvider;
}

export function prepareAccountStorage(
  userId: string,
  contentStorage: Storage = window.localStorage,
  sessionStorage: Storage = window.sessionStorage,
): void {
  if (sessionStorage.getItem(ACTIVE_USER_KEY) === userId) return;
  for (const key of ACCOUNT_CONTENT_KEYS) contentStorage.removeItem(key);
  sessionStorage.setItem(ACTIVE_USER_KEY, userId);
}

export async function authenticatedFetch(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await tokenProvider();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetcher(input, { ...init, headers });
}

type TicketOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export async function issueWebSocketTicket(options: TicketOptions = {}): Promise<string> {
  const baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
  const response = await authenticatedFetch(
    options.fetcher ?? fetch,
    `${baseUrl}/api/session/ws-ticket`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw new Error('No se pudo autorizar la sesión de voz. Inicia sesión de nuevo.');
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('ticket' in payload) ||
    typeof payload.ticket !== 'string' ||
    payload.ticket.length < 1
  ) {
    throw new Error('El servidor devolvió una autorización de voz inválida.');
  }
  return payload.ticket;
}
