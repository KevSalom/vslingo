import { authenticatedFetch } from './sessionClient';

const API_BASE_URL = import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

export type AccountPreferences = {
  theme: 'light' | 'dark';
  speech_voice: string;
  version: number;
};

let current: AccountPreferences | null = null;
let accountGeneration = 0;
let updateChain: Promise<void> = Promise.resolve();

export async function loadAccountPreferences(): Promise<AccountPreferences> {
  const generation = accountGeneration;
  const response = await authenticatedFetch(fetch, `${API_BASE_URL.replace(/\/$/, '')}/api/preferences`);
  if (!response.ok) throw new Error('No se pudieron cargar tus preferencias.');
  const loaded = await response.json() as AccountPreferences;
  if (generation === accountGeneration) current = loaded;
  return loaded;
}

export async function updateAccountPreferences(
  patch: Partial<Pick<AccountPreferences, 'theme' | 'speech_voice'>>,
): Promise<AccountPreferences> {
  const generation = accountGeneration;
  const pending = updateChain.then(async () => {
    if (generation !== accountGeneration) {
      throw new Error('La cuenta activa cambió antes de guardar las preferencias.');
    }
    return persistPreferences(patch, generation, true);
  });
  updateChain = pending.then(() => undefined, () => undefined);
  return pending;
}

export function resetAccountPreferences(): void {
  current = null;
  accountGeneration += 1;
  updateChain = Promise.resolve();
}

async function persistPreferences(
  patch: Partial<Pick<AccountPreferences, 'theme' | 'speech_voice'>>,
  generation: number,
  retryConflict: boolean,
): Promise<AccountPreferences> {
  const base = current ?? await loadAccountPreferences();
  if (generation !== accountGeneration) {
    throw new Error('La cuenta activa cambió antes de guardar las preferencias.');
  }
  const response = await authenticatedFetch(fetch, `${API_BASE_URL.replace(/\/$/, '')}/api/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...base, ...patch }),
  });
  if (response.status === 409 && retryConflict) {
    current = null;
    return persistPreferences(patch, generation, false);
  }
  if (!response.ok) throw new Error('No se pudieron guardar tus preferencias.');
  const saved = await response.json() as AccountPreferences;
  if (generation === accountGeneration) current = saved;
  return saved;
}
