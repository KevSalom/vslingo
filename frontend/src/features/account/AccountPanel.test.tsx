import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountPanel } from './AccountPanel';

const { cancelBillingSubscriptionMock, loadAccountQuotaMock, loadBillingAccountMock } = vi.hoisted(() => ({
  cancelBillingSubscriptionMock: vi.fn(),
  loadAccountQuotaMock: vi.fn(),
  loadBillingAccountMock: vi.fn(),
}));

vi.mock('../../shared/usage/usageClient', () => ({
  loadAccountQuota: loadAccountQuotaMock,
  UsageRequestError: class UsageRequestError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) {
      super(message);
    }
  },
}));

vi.mock('./billingClient', () => ({
  cancelBillingSubscription: cancelBillingSubscriptionMock,
  loadBillingAccount: loadBillingAccountMock,
  startBillingCheckout: vi.fn(),
}));

const QUOTA = {
    period_id: 'trial-a',
    source: 'trial',
    plan_code: 'monthly_v1',
    config_version: 1,
    starts_at: '2026-09-15T00:00:00.000Z',
    ends_at: null,
    limits: { voice_seconds: 600, voice_turns: 30, writings: 10, videos: 3 },
    used: { voice_seconds: 60, voice_turns: 2, writings: 1, videos: 0 },
    reserved: { voice_seconds: 0, voice_turns: 0, writings: 0, videos: 0 },
    remaining: { voice_seconds: 540, voice_turns: 28, writings: 9, videos: 3 },
};

const TRIAL_BILLING = {
  mode: 'fake',
  offer: { plan_code: 'monthly_v1', price_minor: 299, currency: 'USD' },
  subscription: null,
  pending_checkout: null,
};

describe('AccountPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadBillingAccountMock.mockResolvedValue(TRIAL_BILLING);
  });

  it('shows both voice constraints and the remaining account balances', async () => {
    loadAccountQuotaMock.mockResolvedValueOnce(QUOTA);
    render(<AccountPanel />);

    expect(await screen.findByText('9 min')).toBeInTheDocument();
    expect(screen.getByText('Intervenciones')).toBeInTheDocument();
    expect(screen.getByText('Correcciones')).toBeInTheDocument();
    expect(screen.getByText('Videos nuevos')).toBeInTheDocument();
    expect(screen.getByText(/se agota al llegar al tiempo o al número de intervenciones/i)).toBeInTheDocument();
  });

  it('explains expired access without hiding retained history', async () => {
    const { UsageRequestError } = await import('../../shared/usage/usageClient');
    loadAccountQuotaMock.mockRejectedValueOnce(
      new UsageRequestError('access_expired', 'expired', 403),
    );

    render(<AccountPanel />);

    expect(await screen.findByText(/tu historial sigue disponible/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activar plan' })).toBeInTheDocument();
  });

  it('requires confirmation and explains that cancellation preserves paid access', async () => {
    const user = userEvent.setup();
    const activeBilling = {
      ...TRIAL_BILLING,
      subscription: {
        id: 'subscription-a',
        status: 'active',
        auto_renew: true,
        access_ends_at: '2026-10-15T00:00:00.000Z',
        can_cancel: true,
      },
    };
    loadAccountQuotaMock.mockResolvedValueOnce({ ...QUOTA, source: 'monthly' });
    loadBillingAccountMock.mockResolvedValueOnce(activeBilling);
    cancelBillingSubscriptionMock.mockResolvedValueOnce({
      ...activeBilling,
      subscription: { ...activeBilling.subscription, status: 'cancelled', auto_renew: false, can_cancel: false },
    });
    render(<AccountPanel />);

    await user.click(await screen.findByRole('button', { name: 'Cancelar renovación' }));
    expect(screen.getByText(/seguirá activo hasta su fecha final/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));

    expect(await screen.findByText(/conservas el acceso/i)).toBeInTheDocument();
    expect(cancelBillingSubscriptionMock).toHaveBeenCalledOnce();
  });
});
