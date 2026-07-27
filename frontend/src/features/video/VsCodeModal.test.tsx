import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VsCodeModal } from './VsCodeModal';

describe('VsCodeModal', () => {
  it('renders title, children, right actions, and left actions aligned in footer', async () => {
    const handleConfirm = vi.fn();
    const handleCancel = vi.fn();
    const handleDelete = vi.fn();

    render(
      <VsCodeModal
        actionsLeft={
          <button onClick={handleDelete} type="button">
            Eliminar nota
          </button>
        }
        confirmLabel="Guardar cambios"
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        title="Editar nota"
      >
        <p>Modal content</p>
      </VsCodeModal>,
    );

    expect(screen.getByRole('heading', { name: 'Editar nota' })).toBeInTheDocument();
    expect(screen.getByText('Modal content')).toBeInTheDocument();

    const deleteBtn = screen.getByRole('button', { name: 'Eliminar nota' });
    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    const confirmBtn = screen.getByRole('button', { name: 'Guardar cambios' });

    expect(deleteBtn).toBeInTheDocument();
    expect(cancelBtn).toBeInTheDocument();
    expect(confirmBtn).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(deleteBtn);
    expect(handleDelete).toHaveBeenCalledTimes(1);

    await user.click(cancelBtn);
    expect(handleCancel).toHaveBeenCalledTimes(1);

    await user.click(confirmBtn);
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });
});
