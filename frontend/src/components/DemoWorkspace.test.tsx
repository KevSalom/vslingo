import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { DemoWorkspace } from './DemoWorkspace';

describe('DemoWorkspace', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    window.history.replaceState(null, '', '/app/hablar');
  });

  it('starts in Hablar, exposes the commercial beta, and marks the active module', async () => {
    render(<DemoWorkspace />);

    expect(screen.getByText('Prueba gratis')).toBeInTheDocument();
    const voiceLink = screen.getByRole('link', { name: 'Hablar' });
    expect(voiceLink).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('status', { name: /cargando Hablar/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Hablar/i })).toBeInTheDocument();
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
