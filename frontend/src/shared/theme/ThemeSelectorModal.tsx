/**
 * ThemeSelectorModal — VS Code-style modal for choosing a workspace theme.
 *
 * Shows all 4 themes as interactive cards with color swatches. Clicking a
 * card applies a live preview behind the modal. "Aplicar" commits the
 * preview; "Cancelar" reverts.
 */

import { useEffect, useId, useRef } from 'react';

import { THEMES, type ThemeId } from './themeTokens';
import { useTheme } from './ThemeProvider';

type ThemeSelectorModalProps = {
  onClose: () => void;
};

export function ThemeSelectorModal({ onClose }: ThemeSelectorModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const { themeId, activeId, previewTheme, commitTheme, cancelPreview } = useTheme();

  // Focus trap + Escape handling.
  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      'button, [href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
        return;
      }
      if (event.key !== 'Tab' || !panel) {
        return;
      }
      const nodes = [
        ...panel.querySelectorAll<HTMLElement>(
          'button, [href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => !node.hasAttribute('disabled'));
      if (nodes.length === 0) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    cancelPreview();
    onClose();
  };

  const handleConfirm = () => {
    commitTheme();
    onClose();
  };

  const handleThemeClick = (id: ThemeId) => {
    previewTheme(id);
  };

  return (
    <div className="vsc-modal-root" role="presentation">
      <button
        aria-label="Cerrar diálogo"
        className="vsc-modal-backdrop"
        onClick={handleCancel}
        type="button"
      />
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="vsc-modal theme-selector-modal"
        ref={panelRef}
        role="dialog"
      >
        <header className="vsc-modal-header">
          <h2 className="vsc-modal-title" id={titleId}>
            Tema del workspace
          </h2>
          <p className="vsc-modal-description" id={descriptionId}>
            Selecciona un tema y previsualiza en vivo. Aplica para confirmar.
          </p>
        </header>

        <div className="vsc-modal-body theme-selector-body">
          <div className="theme-grid" role="radiogroup" aria-label="Temas disponibles">
            {THEMES.map((theme) => {
              const isCommitted = theme.id === themeId;
              const isActive = theme.id === activeId;
              return (
                <button
                  aria-checked={isActive}
                  aria-label={`${theme.name}: ${theme.description}`}
                  className={`theme-card${isActive ? ' theme-card--selected' : ''}${isCommitted && !isActive ? ' theme-card--committed' : ''}`}
                  key={theme.id}
                  onClick={() => handleThemeClick(theme.id)}
                  role="radio"
                  type="button"
                >
                  <div className="theme-card-swatches">
                    <span
                      className="theme-swatch theme-swatch--bg"
                      style={{ background: theme.tokens.editor }}
                    />
                    <span
                      className="theme-swatch theme-swatch--primary"
                      style={{ background: theme.tokens.primary }}
                    />
                    <span
                      className="theme-swatch theme-swatch--secondary"
                      style={{ background: theme.tokens.secondary }}
                    />
                    <span
                      className="theme-swatch theme-swatch--fg"
                      style={{ background: theme.tokens.foreground }}
                    />
                  </div>
                  <div className="theme-card-info">
                    <span className="theme-card-name">
                      <span className="theme-card-icon" aria-hidden="true">
                        {theme.icon}
                      </span>
                      {theme.name}
                      {isCommitted ? (
                        <span className="theme-card-badge">actual</span>
                      ) : null}
                    </span>
                    <span className="theme-card-desc">{theme.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <footer className="vsc-modal-actions theme-selector-actions">
          <button
            className="vsc-modal-button vsc-modal-button-ghost"
            onClick={handleCancel}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="vsc-modal-button vsc-modal-button-primary"
            onClick={handleConfirm}
            type="button"
          >
            Aplicar tema
          </button>
        </footer>
      </div>
    </div>
  );
}
