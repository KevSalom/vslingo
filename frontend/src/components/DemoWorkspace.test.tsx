import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DemoWorkspace } from './DemoWorkspace';

const { loadQuota } = vi.hoisted(() => ({ loadQuota: vi.fn() }));
vi.mock('../shared/usage/usageClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../shared/usage/usageClient')>(),
  loadAccountQuota: loadQuota,
}));

describe('DemoWorkspace', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    window.history.replaceState(null, '', '/app/hablar');
    loadQuota.mockResolvedValue({ source: 'trial', ends_at: null });
  });

  it('starts in Hablar, exposes the commercial beta, and marks the active module', async () => {
    render(<DemoWorkspace />);

    expect(await screen.findByRole('link', { name: 'Tu plan: Gratis' })).toBeInTheDocument();
    expect(screen.queryByText('Tu prueba gratuita')).not.toBeInTheDocument();
    expect(screen.getByText('Sesión local')).toBeInTheDocument();
    const voiceLink = screen.getByRole('link', { name: 'Hablar' });
    expect(voiceLink).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('status', { name: /cargando Hablar/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Hablar/i })).toBeInTheDocument();
  });

  it('shows Pro only for a current paid period, and does not guess on a failed request', async () => {
    loadQuota.mockResolvedValueOnce({ source: 'monthly', ends_at: '2099-01-01T00:00:00Z' });
    render(<DemoWorkspace />);
    expect(await screen.findByRole('link', { name: 'Tu plan: Pro' })).toBeInTheDocument();
    loadQuota.mockRejectedValueOnce(new Error('offline'));
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByRole('link', { name: 'Tu plan: Ver plan' })).toBeInTheDocument();
  });

  it('starts in light mode and toggles directly to dark mode', async () => {
    const user = userEvent.setup();
    render(<DemoWorkspace />);

    const toggle = await screen.findByRole('button', { name: 'Activar modo oscuro' });
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'));

    await user.click(toggle);

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('vslingo:theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Activar modo claro' })).toBeInTheDocument();
    expect(screen.queryByText('Tema del workspace')).not.toBeInTheDocument();
  });

  it('selects the module in a direct hash link after hydration', async () => {
    const initialHash = window.location.hash;
    window.history.replaceState(null, '', '#writing');

    try {
      render(<DemoWorkspace />);

      expect(await screen.findByRole('heading', { name: 'Escribir' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Escribir' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    } finally {
      window.history.replaceState(null, '', initialHash || '/');
    }
  });

  it('switches modules with accessible state and moves focus to their heading', async () => {
    const user = userEvent.setup();
    render(<DemoWorkspace />);

    await user.click(screen.getByRole('link', { name: 'Escribir' }));
    const writingHeading = screen.getByRole('heading', { name: 'Corrección clara' });
    expect(screen.getByRole('link', { name: 'Escribir' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() => expect(writingHeading).toHaveFocus());

    await user.click(screen.getByRole('link', { name: 'Videos' }));
    const videoHeading = screen.getByRole('heading', { name: 'Comprensión auditiva' });
    expect(videoHeading).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Videos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('textbox', { name: 'URL de YouTube' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cargar transcripción' })).toBeInTheDocument();
    await waitFor(() => expect(videoHeading).toHaveFocus());

    await user.click(screen.getByRole('link', { name: 'Hablar' }));
    expect(await screen.findByRole('heading', { name: /Hablar/i })).toBeInTheDocument();
  });
});
