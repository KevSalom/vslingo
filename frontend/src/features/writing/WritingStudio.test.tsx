import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CorrectionResponse } from './types';
import { WritingStudio } from './WritingStudio';
import {
  WRITING_STORAGE_KEY,
  saveWritingState,
} from './writingStorage';

const MULTIPLE_CORRECTIONS: CorrectionResponse = {
  original_text: 'She deploy the service yesterday and it work good.',
  corrected_text: 'She deployed the service yesterday, and it worked well.',
  has_corrections: true,
  corrections: [
    {
      original: 'deploy',
      corrected: 'deployed',
      explanation: 'El marcador temporal exige pasado simple.',
      category: 'grammar',
    },
    {
      original: 'work good',
      corrected: 'worked well',
      explanation: 'Se necesita pasado y el adverbio «well».',
      category: 'style',
    },
  ],
  general_feedback: 'Buen vocabulario técnico; revisa el pasado simple.',
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('WritingStudio', () => {
  it('submits text and renders categorized corrections with feedback', async () => {
    const user = userEvent.setup();
    const correctText = vi.fn().mockResolvedValue(MULTIPLE_CORRECTIONS);
    render(<WritingStudio correctText={correctText} />);

    const editor = screen.getByRole('textbox', { name: 'Tu texto en inglés' });
    await user.type(editor, MULTIPLE_CORRECTIONS.original_text);
    await user.click(screen.getByRole('button', { name: 'Revisar texto' }));

    await waitFor(() => {
      expect(correctText).toHaveBeenCalledWith(MULTIPLE_CORRECTIONS.original_text);
    });
    expect(
      screen.getByText(MULTIPLE_CORRECTIONS.corrected_text),
    ).toBeInTheDocument();
    expect(screen.getByText('Gramática')).toBeInTheDocument();
    expect(screen.getByText('Estilo')).toBeInTheDocument();
    expect(screen.getByText(MULTIPLE_CORRECTIONS.general_feedback)).toBeInTheDocument();
  });

  it('copies the corrected text through the clipboard action', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <WritingStudio
        correctText={vi.fn().mockResolvedValue(MULTIPLE_CORRECTIONS)}
      />,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'Tu texto en inglés' }),
      MULTIPLE_CORRECTIONS.original_text,
    );
    await user.click(screen.getByRole('button', { name: 'Revisar texto' }));
    await user.click(
      await screen.findByRole('button', { name: 'Copiar corrección' }),
    );

    expect(writeText).toHaveBeenCalledWith(MULTIPLE_CORRECTIONS.corrected_text);
    expect(screen.getByRole('button', { name: 'Corrección copiada' })).toBeInTheDocument();
  });

  it('restores versioned state and clears both the workspace and storage', async () => {
    const user = userEvent.setup();
    saveWritingState({
      draft: MULTIPLE_CORRECTIONS.original_text,
      result: MULTIPLE_CORRECTIONS,
    });

    render(<WritingStudio correctText={vi.fn()} />);

    const editor = screen.getByRole('textbox', { name: 'Tu texto en inglés' });
    await waitFor(() => {
      expect(editor).toHaveValue(MULTIPLE_CORRECTIONS.original_text);
    });
    expect(screen.getByText(MULTIPLE_CORRECTIONS.corrected_text)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpiar' }));

    expect(editor).toHaveValue('');
    expect(screen.queryByText(MULTIPLE_CORRECTIONS.corrected_text)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(WRITING_STORAGE_KEY)).toBeNull();
  });

  it('shows actionable provider failures and preserves the draft', async () => {
    const user = userEvent.setup();
    const correctText = vi
      .fn()
      .mockRejectedValue(new Error('La corrección tardó demasiado. Inténtalo de nuevo.'));
    render(<WritingStudio correctText={correctText} />);

    const editor = screen.getByRole('textbox', { name: 'Tu texto en inglés' });
    await user.type(editor, 'Please review this deployment note.');
    await user.click(screen.getByRole('button', { name: 'Revisar texto' }));

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('La corrección tardó demasiado. Inténtalo de nuevo.');
    expect(editor).toHaveValue('Please review this deployment note.');
  });

  it('explains when a submitted text needs no changes', async () => {
    const user = userEvent.setup();
    const text = 'The deployment completed successfully.';
    const correctText = vi.fn().mockResolvedValue({
      original_text: text,
      corrected_text: text,
      has_corrections: false,
      corrections: [],
      general_feedback: 'La oración es correcta, clara y natural.',
    } satisfies CorrectionResponse);
    render(<WritingStudio correctText={correctText} />);

    await user.type(screen.getByRole('textbox', { name: 'Tu texto en inglés' }), text);
    await user.click(screen.getByRole('button', { name: 'Revisar texto' }));

    expect(await screen.findByText('Sin cambios necesarios')).toBeInTheDocument();
  });

  it('renders speech provider control and handle listening toggle', async () => {
    const user = userEvent.setup();
    render(<WritingStudio correctText={vi.fn().mockResolvedValue(MULTIPLE_CORRECTIONS)} />);

    await user.type(screen.getByRole('textbox', { name: 'Tu texto en inglés' }), MULTIPLE_CORRECTIONS.original_text);
    await user.click(screen.getByRole('button', { name: 'Revisar texto' }));

    const listenButton = await screen.findByRole('button', { name: 'Escuchar reproducción de texto' });
    expect(listenButton).toBeInTheDocument();

    const providerSelect = screen.getByLabelText('Proveedor de voz');
    expect(providerSelect).toBeInTheDocument();
    expect(providerSelect).toHaveValue('aws_polly');

    await user.selectOptions(providerSelect, 'edge_tts');
    expect(providerSelect).toHaveValue('edge_tts');
  });
});
