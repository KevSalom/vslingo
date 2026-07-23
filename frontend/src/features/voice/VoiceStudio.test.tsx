import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceStudio } from './VoiceStudio';

describe('VoiceStudio UI component', () => {
  it('renders initial idle state with connect button', () => {
    render(<VoiceStudio />);

    expect(screen.getByText('Voice Studio — Push To Talk')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Conectar Voice Studio' })
    ).toBeInTheDocument();
    expect(screen.getByText('Desconectado')).toBeInTheDocument();

    const pttButton = screen.getByRole('button', {
      name: 'Mantén pulsado para hablar',
    });
    expect(pttButton).toBeDisabled();
  });
});
