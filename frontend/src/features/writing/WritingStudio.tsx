import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';

import { SpeechProviderControl } from '../../shared/speech/SpeechProviderControl';
import { useSpeechPlayer } from '../../shared/speech/useSpeechPlayer';
import {
  MAX_CORRECTION_TEXT_LENGTH,
  type CorrectionCategory,
  type CorrectionResponse,
} from './types';
import { correctWriting } from './writingApi';
import {
  clearWritingState,
  loadWritingState,
  saveWritingState,
} from './writingStorage';

type WritingStudioProps = {
  correctText?: (text: string) => Promise<CorrectionResponse>;
};

const CATEGORY_META: Record<
  CorrectionCategory,
  { label: string; tone: string }
> = {
  grammar: { label: 'Gramática', tone: 'grammar' },
  spelling: { label: 'Ortografía', tone: 'spelling' },
  punctuation: { label: 'Puntuación', tone: 'punctuation' },
  style: { label: 'Estilo', tone: 'style' },
};

export function WritingStudio({
  correctText = correctWriting,
}: WritingStudioProps) {
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<CorrectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const skipNextPersistence = useRef(false);

  const speechPlayer = useSpeechPlayer();

  useEffect(() => {
    const stored = loadWritingState();
    setDraft(stored.draft);
    setResult(stored.result);
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) {
      return;
    }
    if (skipNextPersistence.current) {
      skipNextPersistence.current = false;
      return;
    }
    saveWritingState({ draft, result });
  }, [draft, result, storageReady]);

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !draft.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setCopied(false);
    speechPlayer.stop();
    try {
      setResult(await correctText(draft));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo completar la corrección. Inténtalo de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    setError(null);
    setCopied(false);
    if (result && value !== result.original_text) {
      speechPlayer.stop();
      setResult(null);
    }
  };

  const handleCopy = async () => {
    if (!result) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.corrected_text);
      setCopied(true);
    } catch {
      setError('No se pudo copiar la corrección. Selecciona el texto manualmente.');
    }
  };

  const handleClear = () => {
    skipNextPersistence.current = true;
    clearWritingState();
    speechPlayer.stop();
    setDraft('');
    setResult(null);
    setError(null);
    setCopied(false);
  };

  const handleToggleSpeech = () => {
    if (!result) {
      return;
    }
    if (speechPlayer.isBusy) {
      speechPlayer.stop();
    } else {
      speechPlayer.play(result.corrected_text);
    }
  };

  return (
    <section aria-labelledby="writing-title" className="writing-studio">
      <header className="writing-header">
        <div className="writing-header-row">
          <p className="writing-kicker">Writing / correction.json</p>
          <span className="writing-hint-key">Ctrl + Enter para revisar</span>
        </div>
        <h1 id="writing-title" tabIndex={-1} className="writing-title">
          Writing Studio
        </h1>
        <p className="writing-lead">
          Escribe un mensaje técnico en inglés. El resultado y el feedback quedan
          bajo el editor; los cambios categorizados se abren en el panel derecho.
        </p>
      </header>

      <div
        className={
          result ? 'writing-split writing-split-open' : 'writing-split'
        }
      >
        <div className="writing-pane writing-pane-editor">
          <div className="writing-pane-tabs" aria-hidden="true">
            <span className="writing-pane-tab is-active">draft.en</span>
          </div>

          <form
            aria-busy={isSubmitting}
            className="writing-editor-form"
            onSubmit={handleSubmit}
          >
            <div className="writing-editor-toolbar">
              <label className="writing-editor-label" htmlFor="writing-editor">
                Tu texto en inglés
              </label>
              <span
                className={
                  draft.length === MAX_CORRECTION_TEXT_LENGTH
                    ? 'writing-count is-limit'
                    : 'writing-count'
                }
                id="writing-count"
              >
                {draft.length} / {MAX_CORRECTION_TEXT_LENGTH}
              </span>
            </div>
            <textarea
              aria-describedby="writing-hint writing-count"
              className="writing-textarea"
              disabled={isSubmitting}
              id="writing-editor"
              maxLength={MAX_CORRECTION_TEXT_LENGTH}
              onChange={(event) => handleDraftChange(event.currentTarget.value)}
              onKeyDown={handleEditorKeyDown}
              placeholder="Ejemplo: Yesterday I deploy the API and the tests was passing..."
              value={draft}
            />
            <div className="writing-editor-footer">
              <p className="writing-editor-note" id="writing-hint">
                El texto se conserva únicamente en este navegador.
              </p>
              <div className="writing-editor-actions">
                <button
                  className="writing-btn writing-btn-ghost"
                  disabled={isSubmitting || (!draft && !result)}
                  onClick={handleClear}
                  type="button"
                >
                  Limpiar
                </button>
                <button
                  className="writing-btn writing-btn-primary"
                  disabled={isSubmitting || !draft.trim()}
                  type="submit"
                >
                  {isSubmitting ? 'Revisando…' : 'Revisar texto'}
                </button>
              </div>
            </div>
          </form>

          {error ? (
            <div className="writing-alert" role="alert">
              {error}
            </div>
          ) : null}

          {speechPlayer.error ? (
            <div className="writing-alert" role="alert">
              {speechPlayer.error}
            </div>
          ) : null}

          {result ? (
            <div aria-live="polite" className="writing-outcome">
              <section className="writing-result">
                <header className="writing-result-header">
                  <div>
                    <p className="writing-result-kicker">Resultado</p>
                    <h2 className="writing-result-title">Texto corregido</h2>
                  </div>
                  <div className="writing-result-actions">
                    <SpeechProviderControl
                      provider={speechPlayer.provider}
                      onChange={speechPlayer.setProvider}
                      disabled={speechPlayer.isBusy}
                    />
                    <button
                      aria-label={
                        speechPlayer.isBusy
                          ? 'Detener reproducción'
                          : 'Escuchar reproducción de texto'
                      }
                      className="writing-btn writing-btn-ghost writing-btn-sm"
                      onClick={handleToggleSpeech}
                      type="button"
                    >
                      {speechPlayer.speechState === 'synthesizing'
                        ? 'Sintetizando…'
                        : speechPlayer.speechState === 'playing'
                          ? 'Detener'
                          : 'Escuchar'}
                    </button>
                    <button
                      aria-label={copied ? 'Corrección copiada' : 'Copiar corrección'}
                      className="writing-btn writing-btn-ghost writing-btn-sm"
                      onClick={handleCopy}
                      type="button"
                    >
                      {copied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                </header>
                <p className="writing-result-body">{result.corrected_text}</p>
              </section>

              <aside className="writing-feedback">
                <p className="writing-feedback-kicker">Feedback</p>
                <p className="writing-feedback-body">{result.general_feedback}</p>
              </aside>
            </div>
          ) : null}
        </div>

        {result ? (
          <aside
            aria-labelledby="writing-changes-title"
            className="writing-pane writing-pane-diff"
          >
            <div className="writing-pane-tabs">
              <span className="writing-pane-tab is-active">changes.diff</span>
              <span className="writing-pane-meta">
                {result.has_corrections
                  ? `${result.corrections.length} ${
                      result.corrections.length === 1 ? 'cambio' : 'cambios'
                    }`
                  : 'sin cambios'}
              </span>
            </div>

            <div className="writing-diff-scroll">
              <h2 className="writing-diff-heading" id="writing-changes-title">
                Cambios categorizados
              </h2>

              {result.has_corrections ? (
                <ul className="writing-diff-list">
                  {result.corrections.map((correction, index) => {
                    const meta = CATEGORY_META[correction.category];
                    return (
                      <li
                        className={`writing-diff-card writing-diff-card--${meta.tone}`}
                        key={`${correction.category}-${correction.original}-${index}`}
                      >
                        <span className={`writing-diff-badge writing-diff-badge--${meta.tone}`}>
                          {meta.label}
                        </span>
                        <div
                          aria-label={`De ${correction.original} a ${correction.corrected}`}
                          className="writing-diff-pair"
                        >
                          <p className="diff-line diff-remove writing-diff-line">
                            <span aria-hidden="true" className="diff-symbol">
                              −
                            </span>
                            <del>{correction.original}</del>
                          </p>
                          <p className="diff-line diff-add writing-diff-line">
                            <span aria-hidden="true" className="diff-symbol">
                              +
                            </span>
                            <ins>{correction.corrected}</ins>
                          </p>
                        </div>
                        <p className="writing-diff-explain">{correction.explanation}</p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="writing-diff-empty">
                  <h3>Sin cambios necesarios</h3>
                  <p>El texto ya es correcto y natural en inglés.</p>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
