import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceStudio } from './VoiceStudio';

describe('VoiceStudio UI component', () => {
  it('renders initial idle state with connect button and scenario buttons', () => {
    render(<VoiceStudio />);

    expect(screen.getByText('Voice Studio — Practice & Feedback')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Conectar Voice Studio' })
    ).toBeInTheDocument();
    expect(screen.getByText('Desconectado')).toBeInTheDocument();

    // Check four scenario buttons
    expect(screen.getByRole('button', { name: 'Daily Standup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Libre / Explorar' })).toBeInTheDocument();

    const pttButton = screen.getByRole('button', {
      name: 'Mantén pulsado para hablar',
    });
    expect(pttButton).toBeDisabled();
  });
});
