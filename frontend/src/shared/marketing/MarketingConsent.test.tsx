import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketingConsent } from './MarketingConsent';

const {
  loadMarketingConfigMock,
  saveAccountMarketingConsentMock,
  saveVisitorConsentMock,
  sendPageViewMock,
} = vi.hoisted(() => ({
  loadMarketingConfigMock: vi.fn(),
  saveAccountMarketingConsentMock: vi.fn(),
  saveVisitorConsentMock: vi.fn(),
  sendPageViewMock: vi.fn(),
}));

vi.mock('./marketingClient', () => ({
  loadMarketingConfig: loadMarketingConfigMock,
  saveAccountMarketingConsent: saveAccountMarketingConsentMock,
  saveVisitorConsent: saveVisitorConsentMock,
  sendPageView: sendPageViewMock,
}));

describe('MarketingConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    loadMarketingConfigMock.mockResolvedValue({ enabled: true, policy_version: '2026-09-16' });
    saveVisitorConsentMock.mockResolvedValue(undefined);
    saveAccountMarketingConsentMock.mockResolvedValue(undefined);
    sendPageViewMock.mockResolvedValue(undefined);
  });

  it('stays invisible when marketing is disabled', async () => {
    loadMarketingConfigMock.mockResolvedValueOnce({ enabled: false, policy_version: '2026-09-16' });
    render(<MarketingConsent />);

    await waitFor(() => expect(loadMarketingConfigMock).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText('Preferencia de medición')).not.toBeInTheDocument();
  });

  it('records rejection without sending a page view', async () => {
    const user = userEvent.setup();
    render(<MarketingConsent authenticated />);

    await user.click(await screen.findByRole('button', { name: 'No, gracias' }));

    await waitFor(() => expect(saveAccountMarketingConsentMock).toHaveBeenCalledWith(false));
    expect(sendPageViewMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Preferencia de medición')).not.toBeInTheDocument();
  });

  it('sends only an allowlisted page view after explicit acceptance', async () => {
    const user = userEvent.setup();
    render(<MarketingConsent authenticated />);

    await user.click(await screen.findByRole('button', { name: 'Permitir medición' }));

    await waitFor(() => expect(sendPageViewMock).toHaveBeenCalledWith(expect.any(String), '/'));
    expect(saveAccountMarketingConsentMock).toHaveBeenCalledWith(true);
  });
});
