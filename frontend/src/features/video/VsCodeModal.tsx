import { useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from 'react';

type VsCodeModalProps = {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
};

export function VsCodeModal({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: VsCodeModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      'input, textarea, button, [href], select, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !panel) {
        return;
      }
      const nodes = [
        ...panel.querySelectorAll<HTMLElement>(
          'input, textarea, button, [href], select, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => !node.hasAttribute('disabled'));
      if (nodes.length === 0) {
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [onCancel]);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmDisabled) {
      onConfirm();
    }
  };

  return (
    <div className="vsc-modal-root" role="presentation">
      <button
        aria-label="Cerrar diálogo"
        className="vsc-modal-backdrop"
        onClick={onCancel}
        type="button"
      />
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="vsc-modal"
        ref={panelRef}
        role="dialog"
      >
        <header className="vsc-modal-header">
          <h2 className="vsc-modal-title" id={titleId}>
            {title}
          </h2>
          {description ? (
            <p className="vsc-modal-description" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </header>
        <form className="vsc-modal-body" onSubmit={handleSubmit}>
          {children}
          <footer className="vsc-modal-actions">
            <button
              className="vsc-modal-button vsc-modal-button-ghost"
              onClick={onCancel}
              type="button"
            >
              {cancelLabel}
            </button>
            <button
              className="vsc-modal-button vsc-modal-button-primary"
              disabled={confirmDisabled}
              type="submit"
            >
              {confirmLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
