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

type CategoryMeta = {
  label: string;
  badge: string;
  border: string;
};

const CATEGORY_META: Record<CorrectionCategory, CategoryMeta> = {
  grammar: {
    label: 'Gramática',
    badge: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
    border: 'border-l-blue-400',
  },
  spelling: {
    label: 'Ortografía',
    badge: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
    border: 'border-l-violet-400',
  },
  punctuation: {
    label: 'Puntuación',
    badge: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    border: 'border-l-amber-400',
  },
  style: {
    label: 'Estilo',
    badge: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
    border: 'border-l-cyan-400',
  },
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
    <section aria-labelledby="writing-title" className="mx-auto w-full max-w-5xl">
      <header className="mb-6 border-b border-slate-800 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Writing / correction.json
          </p>
          <span className="font-mono text-xs text-slate-500">Ctrl + Enter para revisar</span>
        </div>
        <h1 id="writing-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Writing Studio
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
          Escribe un mensaje técnico en inglés. Recibirás una versión natural, cambios
          categorizados y explicaciones breves en español.
        </p>
      </header>

      <form
        aria-busy={isSubmitting}
        className="rounded-xl border border-slate-800 bg-slate-950/45 shadow-inner shadow-black/20"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 sm:px-5">
          <label className="text-sm font-semibold text-slate-200" htmlFor="writing-editor">
            Tu texto en inglés
          </label>
          <span
            className={`font-mono text-xs ${
              draft.length === MAX_CORRECTION_TEXT_LENGTH
                ? 'text-amber-300'
                : 'text-slate-500'
            }`}
            id="writing-count"
          >
            {draft.length} / {MAX_CORRECTION_TEXT_LENGTH}
          </span>
        </div>
        <textarea
          aria-describedby="writing-hint writing-count"
          className="min-h-44 w-full resize-y bg-transparent px-4 py-4 font-mono text-sm leading-7 text-slate-100 outline-none placeholder:text-slate-600 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 sm:min-h-52 sm:px-5"
          disabled={isSubmitting}
          id="writing-editor"
          maxLength={MAX_CORRECTION_TEXT_LENGTH}
          onChange={(event) => handleDraftChange(event.currentTarget.value)}
          onKeyDown={handleEditorKeyDown}
          placeholder="Ejemplo: Yesterday I deploy the API and the tests was passing..."
          value={draft}
        />
        <div className="flex flex-col gap-3 border-t border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-xs leading-5 text-slate-500" id="writing-hint">
            El texto se conserva únicamente en este navegador.
          </p>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
              disabled={isSubmitting || (!draft && !result)}
              onClick={handleClear}
              type="button"
            >
              Limpiar
            </button>
            <button
              className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
              disabled={isSubmitting || !draft.trim()}
              type="submit"
            >
              {isSubmitting ? 'Revisando…' : 'Revisar texto'}
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <div
          className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {speechPlayer.error ? (
        <div
          className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100"
          role="alert"
        >
          {speechPlayer.error}
        </div>
      ) : null}

      {result ? (
        <div aria-live="polite" className="mt-6 space-y-5">
          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/45">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-emerald-300">
                  Resultado
                </p>
                <h2 className="mt-1 text-base font-semibold text-slate-100">Texto corregido</h2>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <SpeechProviderControl
                  provider={speechPlayer.provider}
                  onChange={speechPlayer.setProvider}
                  disabled={speechPlayer.isBusy}
                />
                <button
                  aria-label={speechPlayer.isBusy ? 'Detener reproducción' : 'Escuchar reproducción de texto'}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-cyan-400/60 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
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
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-emerald-400/60 hover:text-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  onClick={handleCopy}
                  type="button"
                >
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </header>
            <p className="whitespace-pre-wrap px-4 py-5 text-base leading-7 text-slate-100 sm:px-5">
              {result.corrected_text}
            </p>
          </section>

          <aside className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-4 py-4 sm:px-5">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
              Feedback
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{result.general_feedback}</p>
          </aside>

          {result.has_corrections ? (
            <section aria-labelledby="writing-changes-title">
              <div className="mb-3 flex items-end justify-between gap-4">
                <h2 className="text-base font-semibold text-slate-100" id="writing-changes-title">
                  Cambios categorizados
                </h2>
                <span className="font-mono text-xs text-slate-500">
                  {result.corrections.length}{' '}
                  {result.corrections.length === 1 ? 'cambio' : 'cambios'}
                </span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {result.corrections.map((correction, index) => {
                  const meta = CATEGORY_META[correction.category];
                  return (
                    <article
                      className={`rounded-r-xl border border-l-4 border-slate-800 bg-slate-950/45 p-4 ${meta.border}`}
                      key={`${correction.category}-${correction.original}-${index}`}
                    >
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] ${meta.badge}`}
                      >
                        {meta.label}
                      </span>
                      <div className="mt-4 grid gap-2 font-mono text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                        <del className="rounded-md bg-red-400/10 px-2.5 py-2 text-red-200 decoration-red-300/70">
                          {correction.original}
                        </del>
                        <span aria-hidden="true" className="hidden text-slate-600 sm:block">
                          →
                        </span>
                        <ins className="rounded-md bg-emerald-400/10 px-2.5 py-2 text-emerald-200 no-underline">
                          {correction.corrected}
                        </ins>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-400">
                        {correction.explanation}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] px-4 py-5 sm:px-5">
              <h2 className="font-semibold text-emerald-200">Sin cambios necesarios</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                El texto ya es correcto y natural en inglés.
              </p>
            </section>
          )}
        </div>
      ) : null}
    </section>
  );
}
