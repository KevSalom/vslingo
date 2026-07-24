import { lazy, Suspense, useEffect, useRef, useState } from 'react';

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
        <a aria-label="Volver a la landing" className="activity-button" href="/" title="Volver a la landing">
          <HomeGlyph />
        </a>
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
              Las preferencias y borradores recientes se mantienen sólo en este navegador.
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
    </section>
  );

  return (
    <main className="workspace-page">
      {activeId === 'video' ? (
        <VideoLabProvider>{workspace}</VideoLabProvider>
      ) : (
        workspace
      )}
    </main>
  );
}

function VoiceFallback() {
  return (
    <section aria-busy="true" aria-label="Cargando Voice Studio" role="status">
      <p className="font-mono text-sm text-slate-400">Cargando Voice Studio…</p>
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
