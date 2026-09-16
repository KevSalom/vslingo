import { authenticatedFetch } from '../../shared/auth/sessionClient';

const API_BASE_URL = import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

export type BillingSubscription = {
  id: string;
  status: 'approval_pending' | 'approved' | 'active' | 'suspended' | 'cancelled' | 'expired';
  auto_renew: boolean;
  access_ends_at: string | null;
  can_cancel: boolean;
};

export type BillingAccount = {
  mode: 'fake' | 'paypal_sandbox' | 'paypal_live';
  offer: { plan_code: string; price_minor: number; currency: 'USD' };
  subscription: BillingSubscription | null;
  pending_checkout: { id: string; status: string; approval_url: string | null } | null;
};

export type Checkout = {
  attempt_id: string;
  status: string;
  approval_url: string | null;
};

export class BillingRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'BillingRequestError';
  }
}

export async function loadBillingAccount(): Promise<BillingAccount> {
  return request<BillingAccount>('/api/account/billing');
}

export async function startBillingCheckout(): Promise<Checkout> {
  return request<Checkout>('/api/billing/checkout', { method: 'POST' });
}

export async function cancelBillingSubscription(): Promise<BillingAccount> {
  return request<BillingAccount>('/api/billing/cancel', { method: 'POST' });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(
    fetch,
    `${API_BASE_URL.replace(/\/$/, '')}${path}`,
    init,
  );
  if (!response.ok) {
    let code = 'billing_unavailable';
    let message = 'No pudimos completar la operación.';
    try {
      const body = await response.json() as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // A proxy may return a non-JSON error. Keep the stable fallback.
    }
    throw new BillingRequestError(code, message, response.status);
  }
  return response.json() as Promise<T>;
}
