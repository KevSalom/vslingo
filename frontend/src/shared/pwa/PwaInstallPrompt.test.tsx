import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PwaInstallPrompt } from './PwaInstallPrompt';
import { markPracticeCompleted } from './installPrompt';

describe('PwaInstallPrompt', () => {
  beforeEach(() => localStorage.clear());

  it('waits for a completed practice and remains dismissible', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const installEvent = Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    render(<PwaInstallPrompt />);
    window.dispatchEvent(installEvent);

    expect(screen.queryByLabelText('Instalar Inglés al Grano')).not.toBeInTheDocument();
    markPracticeCompleted();
    expect(await screen.findByLabelText('Instalar Inglés al Grano')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ahora no' }));

    expect(screen.queryByLabelText('Instalar Inglés al Grano')).not.toBeInTheDocument();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('does not repeat the custom invitation after the native prompt is dismissed', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    localStorage.setItem('ingles-al-grano:practice-completed', 'true');
    render(<PwaInstallPrompt />);
    window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    }));

    await user.click(await screen.findByRole('button', { name: 'Instalar' }));
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Instalar Inglés al Grano')).not.toBeInTheDocument();

    markPracticeCompleted();
    expect(screen.queryByLabelText('Instalar Inglés al Grano')).not.toBeInTheDocument();
  });
});
