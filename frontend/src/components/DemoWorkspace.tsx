import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { ThemeProvider } from '../shared/theme/ThemeProvider';
import { ThemeSelectorModal } from '../shared/theme/ThemeSelectorModal';
import { VideoFileTree } from '../features/video/VideoFileTree';
import { VideoLab } from '../features/video/VideoLab';
import { VideoLabProvider } from '../features/video/VideoLabContext';
import { WritingStudio } from '../features/writing/WritingStudio';

const VoiceStudio = lazy(() =>
  import('../features/voice/VoiceStudio').then(({ VoiceStudio: Component }) => ({
    default: Component,
  })),
);

type ModuleId = 'voice' | 'writing' | 'video';

type WorkspaceModule = {
  id: ModuleId;
  label: string;
  eyebrow: string;
  description: string;
  fileLabel: string;
};

const MODULES: readonly WorkspaceModule[] = [
  {
    id: 'voice',
    label: 'Voice Studio',
    eyebrow: 'Conversación técnica',
    description: 'Habla, interrumpe y recibe feedback para conversaciones profesionales.',
    fileLabel: 'voice.session',
  },
  {
    id: 'writing',
    label: 'Writing Studio',
    eyebrow: 'Escritura profesional',
    description: 'Corrige mensajes técnicos y entiende cada decisión de lenguaje.',
    fileLabel: 'writing.diff',
  },
  {
    id: 'video',
    label: 'Video Lab',
    eyebrow: 'Comprensión auditiva',
    description: 'Navega una transcripción técnica, toma notas y vuelve al contexto.',
    fileLabel: 'video.transcript',
  },
];

const FOCUS_TARGETS: Record<ModuleId, string> = {
  voice: 'voice-title',
  writing: 'writing-title',
  video: 'video-lab-title',
};

function initialModuleFromHash(): ModuleId {
  if (typeof window === 'undefined') return 'voice';
  const moduleId = window.location.hash.slice(1);
  return moduleId === 'writing' || moduleId === 'video' || moduleId === 'voice'
    ? moduleId
    : 'voice';
}

export function DemoWorkspace() {
  // Keep the server and initial client render identical. The URL hash is applied
  // after hydration so direct links do not cause a React hydration mismatch.
  const [activeId, setActiveId] = useState<ModuleId>('voice');
  const [hasResolvedInitialModule, setHasResolvedInitialModule] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const isInitialModule = useRef(true);
  const activeModule = MODULES.find((module) => module.id === activeId) ?? MODULES[0];

  useEffect(() => {
    setActiveId(initialModuleFromHash());
    setHasResolvedInitialModule(true);
  }, []);

  useEffect(() => {
    if (!hasResolvedInitialModule || isInitialModule.current) {
      isInitialModule.current = false;
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      document.getElementById(FOCUS_TARGETS[activeId])?.focus();
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeId, hasResolvedInitialModule]);

  const workspace = (
    <section className="workspace" aria-label="Workspace de VSLingo">
      <header className="workspace-topbar">
        <div>
          <a className="brand" href="/">
            <span aria-hidden="true" className="brand-mark">V/</span>
            VSLingo
          </a>
          <p className="workspace-subtitle">Developer English workspace</p>
        </div>
        <span className="alpha-badge">Public Alpha</span>
      </header>

      <nav aria-label="Módulos de práctica" className="activity-bar">
        <div className="activity-list">
          {MODULES.map((module) => {
            const isActive = module.id === activeId;
            return (
              <button
                aria-current={isActive ? 'page' : undefined}
                aria-label={module.label}
                className="activity-button"
                key={module.id}
                onClick={() => setActiveId(module.id)}
                title={module.label}
                type="button"
              >
                <ModuleGlyph module={module.id} />
              </button>
            );
          })}
        </div>
        <div className="activity-list">
          <button
            aria-label="Cambiar tema"
            className="activity-button settings-button"
            onClick={() => setShowThemeModal(true)}
            title="Cambiar tema"
            type="button"
          >
            <SettingsGlyph />
          </button>
          <a aria-label="Volver a la landing" className="activity-button" href="/" title="Volver a la landing">
            <HomeGlyph />
          </a>
        </div>
      </nav>

      <aside className="explorer" aria-labelledby="module-context-title">
        {activeId === 'video' ? (
          <VideoFileTree />
        ) : (
          <>
            <p className="explorer-title" id="module-context-title">Módulo activo</p>
            <p className="explorer-name">{activeModule.label}</p>
            <p className="explorer-description">{activeModule.description}</p>
            <div className="explorer-rule" />
            <p className="explorer-title">Enfoque</p>
            <p className="explorer-note">{activeModule.eyebrow}</p>
            <p className="explorer-note" style={{ marginTop: '1rem' }}>
              Las preferencias y borradores recientes se mantienen solo en este navegador.
            </p>
          </>
        )}
      </aside>

      <section className="editor" aria-label={`${activeModule.label}: espacio de práctica`}>
        <div className="editor-tab">{activeModule.fileLabel}</div>
        <div className="editor-content">
          {activeId === 'writing' ? <WritingStudio /> : null}
          {activeId === 'video' ? <VideoLab /> : null}
          {activeId === 'voice' ? (
            <Suspense fallback={<VoiceFallback />}>
              <VoiceStudio />
            </Suspense>
          ) : null}
        </div>
      </section>

      <footer className="workspace-panel" aria-live="polite">
        <strong>local</strong>
        <span>sin registro · estado reciente en este navegador</span>
      </footer>

      {showThemeModal ? (
        <ThemeSelectorModal onClose={() => setShowThemeModal(false)} />
      ) : null}
    </section>
  );

  return (
    <ThemeProvider>
      <main className="workspace-page">
        {activeId === 'video' ? (
          <VideoLabProvider>{workspace}</VideoLabProvider>
        ) : (
          workspace
        )}
      </main>
    </ThemeProvider>
  );
}

function VoiceFallback() {
  return (
    <section
      aria-busy="true"
      aria-label="Cargando Voice Studio"
      className="voice-studio voice-studio-fallback"
      role="status"
    >
      <div className="voice-split" aria-hidden="true">
        <div className="voice-pane voice-pane-control">
          <div className="voice-pane-tabs">
            <span className="voice-pane-tab is-active">control.voice</span>
            <span className="voice-fallback-chip" />
          </div>
          <div className="voice-setup">
            <span className="voice-fallback-line voice-fallback-line-md" />
            <span className="voice-fallback-line voice-fallback-line-sm" />
          </div>
          <div className="voice-power-wrap">
            <span className="voice-fallback-power" />
          </div>
          <div className="voice-vad-notice">
            <span className="voice-fallback-line" />
            <span className="voice-fallback-line voice-fallback-line-sm" />
          </div>
          <div className="voice-signal">
            <span className="voice-signal-label">tu voz</span>
            {Array.from({ length: 18 }, (_, index) => (
              <span className="voice-signal-bar" key={index} style={{ transform: 'scaleY(0.14)' }} />
            ))}
          </div>
          <div className="voice-metrics">
            <span className="voice-fallback-line voice-fallback-line-xs" />
            <div className="voice-metrics-grid">
              <span className="voice-fallback-line voice-fallback-line-sm" />
              <span className="voice-fallback-line voice-fallback-line-sm" />
              <span className="voice-fallback-line voice-fallback-line-sm" />
              <span className="voice-fallback-line voice-fallback-line-sm" />
            </div>
          </div>
          <div className="voice-ptt-wrap">
            <span className="voice-fallback-ptt" />
          </div>
        </div>
        <div className="voice-pane voice-pane-session">
          <div className="voice-workspace">
            <div className="voice-panel">
              <div className="voice-pane-tabs">
                <span className="voice-pane-tab is-active">conversation.stream</span>
              </div>
              <div className="voice-panel-body">
                <div className="voice-scroll">
                  <span className="voice-fallback-block" />
                  <span className="voice-fallback-block voice-fallback-block-short" />
                </div>
              </div>
            </div>
            <div className="voice-panel">
              <div className="voice-pane-tabs">
                <span className="voice-pane-tab is-active">feedback.coach</span>
              </div>
              <div className="voice-panel-body">
                <div className="voice-scroll">
                  <span className="voice-fallback-block" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">Cargando Voice Studio…</span>
    </section>
  );
}

function ModuleGlyph({ module }: { module: ModuleId }) {
  if (module === 'writing') {
    return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M6 4.75h8.5L18 8.25v11H6zM14 4.75v3.5h4M8.75 12h6.5M8.75 15.5h6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /></svg>;
  }
  if (module === 'video') {
    return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><rect height="13" rx="1.5" stroke="currentColor" strokeWidth="1.6" width="17" x="3.5" y="5.5" /><path d="m10 9 5 3-5 3z" fill="currentColor" /></svg>;
  }
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M5 13.5v-3M8.5 16v-8M12 19V5M15.5 16v-8M19 13.5v-3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function HomeGlyph() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="m4.5 11.25 7.5-6 7.5 6v7.25h-5v-4.75h-5v4.75h-5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" /></svg>;
}

function SettingsGlyph() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-1.42 3.42 2 2 0 0 1-1.41-.59l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}
