import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DemoWorkspace } from './DemoWorkspace';

describe('DemoWorkspace', () => {
  it('starts in Voice Studio, exposes Public Alpha, and marks the active module', async () => {
    render(<DemoWorkspace />);

    expect(screen.getByText('Public Alpha')).toBeInTheDocument();
    const voiceLink = screen.getByRole('button', { name: /Voice Studio/i });
    expect(voiceLink).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('status', { name: /cargando voice studio/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Voice Studio/i })).toBeInTheDocument();
  });

  it('switches modules with accessible state and moves focus to their heading', async () => {
    const user = userEvent.setup();
    render(<DemoWorkspace />);

    await user.click(screen.getByRole('button', { name: 'Writing Studio' }));
    const writingHeading = screen.getByRole('heading', { name: 'Writing Studio' });
    expect(writingHeading).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Writing Studio' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() => expect(writingHeading).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Video Lab' }));
    const videoHeading = screen.getByRole('heading', { name: 'Video Lab' });
    expect(videoHeading).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Video Lab' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('textbox', { name: 'URL de YouTube' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir demo técnica' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voice Studio' }));
    expect(await screen.findByRole('heading', { name: /Voice Studio/i })).toBeInTheDocument();
  });
});
