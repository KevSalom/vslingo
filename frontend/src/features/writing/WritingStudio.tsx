import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';

import { SpeechVoiceControl } from '../../shared/speech/SpeechVoiceControl';
import { useSpeechPlayer } from '../../shared/speech/useSpeechPlayer';
import { markPracticeCompleted } from '../../shared/pwa/installPrompt';
import {
  deleteWritingHistory,
  listWritingHistory,
  saveWritingHistory,
  type WritingHistoryEntry,
} from '../../shared/history/historyClient';
import {
  MAX_CORRECTION_TEXT_LENGTH,
  type CorrectionCategory,
  type CorrectionResponse,
} from './types';
import { correctWriting, WritingRequestError } from './writingApi';
import {
  clearWritingState,
  loadWritingState,
  saveWritingState,
} from './writingStorage';

type WritingStudioProps = {
  correctText?: (text: string) => Promise<CorrectionResponse>;
  saveResult?: (result: CorrectionResponse, operationId: string) => Promise<unknown>;
  loadHistory?: () => Promise<WritingHistoryEntry[]>;
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
  saveResult,
  loadHistory = listWritingHistory,
}: WritingStudioProps) {
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<CorrectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<WritingHistoryEntry[] | null>(null);
  const skipNextPersistence = useRef(false);
  const pendingOperationId = useRef<string | null>(null);

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
    const submittedText = draft.trim();
    if (isSubmitting || !submittedText) {
      return;
    }

    if (submittedText !== draft) {
      setDraft(submittedText);
    }
    setIsSubmitting(true);
    setError(null);
    setCopied(false);
    speechPlayer.stop();
    try {
      const operationId = pendingOperationId.current ?? createOperationId();
      pendingOperationId.current = operationId;
      const corrected = correctText === correctWriting
        ? await correctWriting(submittedText, { operationId })
        : await correctText(submittedText);
      pendingOperationId.current = null;
      setResult(corrected);
      markPracticeCompleted();
      setSaveStatus('Guardando en tu historial…');
      try {
        const persist = saveResult ?? (
          correctText === correctWriting ? saveWritingHistory : async () => undefined
        );
        await persist(corrected, operationId);
        setSaveStatus('Guardado en tu historial.');
      } catch {
        setSaveStatus('No se pudo guardar. El resultado sigue disponible en pantalla.');
      }
    } catch (cause) {
      if (!(cause instanceof WritingRequestError) || ![
        'network_error',
        'operation_in_progress',
        'operation_uncertain',
      ].includes(cause.code)) {
        pendingOperationId.current = null;
      }
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
    setSaveStatus(null);
    pendingOperationId.current = null;
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
    setSaveStatus(null);
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
      <h2 className="sr-only" id="writing-title">
        Escribir
      </h2>

      <div className="history-toolbar">
        <button
          className="writing-btn writing-btn-ghost writing-btn-sm"
          onClick={() => {
            if (history) {
              setHistory(null);
              return;
            }
            void loadHistory().then(setHistory).catch(() => setSaveStatus('No se pudo cargar el historial.'));
          }}
          type="button"
        >
          {history ? 'Ocultar historial' : 'Ver historial'}
        </button>
        {saveStatus ? <span aria-live="polite">{saveStatus}</span> : null}
      </div>
      {history ? (
        <ul className="history-list" aria-label="Historial de escritura">
          {history.length ? history.map((entry) => (
            <li key={entry.id}>
              <button onClick={() => { setDraft(entry.original_text); setResult(entry); }} type="button">
                <strong>{entry.corrected_text.slice(0, 80)}</strong>
                <span>{new Date(entry.created_at).toLocaleDateString('es')}</span>
              </button>
              <button
                aria-label={`Eliminar corrección ${entry.corrected_text.slice(0, 40)}`}
                onClick={() => void deleteWritingHistory(entry.id).then(() => {
                  setHistory((current) => current?.filter((item) => item.id !== entry.id) ?? []);
                }).catch(() => setSaveStatus('No se pudo eliminar la corrección.'))}
                type="button"
              >
                Eliminar
              </button>
            </li>
          )) : <li className="history-empty">Aún no hay correcciones guardadas.</li>}
        </ul>
      ) : null}

      <div
        className={
          result ? 'writing-split writing-split-open' : 'writing-split'
        }
      >
        <div className="writing-pane writing-pane-editor">
          <div className="writing-pane-tabs">
            <span className="writing-pane-tab is-active">Tu borrador</span>
            <span className="writing-hint-key">Ctrl + Enter para revisar</span>
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
                    <SpeechVoiceControl
                      voice={speechPlayer.voice}
                      onChange={speechPlayer.setVoice}
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

function createOperationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `writing-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
