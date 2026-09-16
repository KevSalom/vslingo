import { authenticatedFetch } from '../auth/sessionClient';

const API_BASE_URL = import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

export type UsageAmounts = {
  voice_seconds: number;
  voice_turns: number;
  writings: number;
  videos: number;
};

export type AccountQuota = {
  period_id: string;
  source: 'trial' | 'monthly' | 'manual';
  plan_code: string;
  config_version: number;
  starts_at: string;
  ends_at: string | null;
  limits: UsageAmounts;
  used: UsageAmounts;
  reserved: UsageAmounts;
  remaining: UsageAmounts;
};

export type PublicPlan = {
  config_version: number;
  plan_code: string;
  currency: 'USD';
  price_minor: number;
  trial: UsageAmounts;
  monthly: UsageAmounts;
  content: {
    writing_max_chars: number;
    note_max_chars: number;
    voice_max_input_seconds: number;
    voice_context_pairs: number;
    voice_context_max_chars: number;
    voice_max_reply_chars: number;
    voice_max_session_seconds: number;
    voice_max_session_turns: number;
  };
};

export class UsageRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UsageRequestError';
  }
}

export async function loadPublicPlan(): Promise<PublicPlan> {
  const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/plan`);
  if (!response.ok) throw new Error('No se pudo cargar la oferta actual.');
  return response.json() as Promise<PublicPlan>;
}

export async function loadAccountQuota(): Promise<AccountQuota> {
  const response = await authenticatedFetch(
    fetch,
    `${API_BASE_URL.replace(/\/$/, '')}/api/account/quota`,
  );
  if (!response.ok) {
    let code = 'quota_unavailable';
    let message = 'No se pudo cargar tu saldo.';
    try {
      const body = await response.json() as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // Keep the stable fallback when a proxy returns a non-JSON failure.
    }
    throw new UsageRequestError(code, message, response.status);
  }
  return response.json() as Promise<AccountQuota>;
}
