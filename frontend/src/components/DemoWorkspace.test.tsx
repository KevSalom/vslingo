import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DemoWorkspace } from './DemoWorkspace';

describe('DemoWorkspace', () => {
  it('starts in Voice Studio and exposes the Public Alpha state', () => {
    render(<DemoWorkspace />);

    expect(screen.getByRole('heading', { name: 'Voice Studio' })).toBeInTheDocument();
    expect(screen.getByText('Public Alpha')).toBeInTheDocument();
  });

  it('switches between the integrated Writing feature and remaining module placeholders', async () => {
    const user = userEvent.setup();
    render(<DemoWorkspace />);

    await user.click(screen.getByRole('button', { name: 'Writing Studio' }));
    expect(screen.getByRole('heading', { name: 'Writing Studio' })).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Tu texto en inglés' }).closest('[aria-live]'),
    ).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Video Lab' }));
    expect(screen.getByRole('heading', { name: 'Video Lab' })).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'URL de YouTube' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Abrir demo técnica' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voice Studio' }));
    expect(screen.getByRole('heading', { name: 'Voice Studio' })).toBeInTheDocument();
  });
});
