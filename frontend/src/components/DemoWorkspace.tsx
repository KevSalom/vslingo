import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { VideoLab } from '../features/video/VideoLab';
import { VideoLabProvider } from '../features/video/VideoLabContext';
import { WritingStudio } from '../features/writing/WritingStudio';
import { AccountPanel } from '../features/account/AccountPanel';
import { ProductAuthProvider, useProductSession } from '../shared/auth/ProductAuthProvider';
import {
  loadAccountPreferences,
  resetAccountPreferences,
  updateAccountPreferences,
} from '../shared/auth/preferencesClient';
import { saveSpeechVoice } from '../shared/speech/storage';
import { EDGE_VOICES } from '../shared/speech/voiceCatalog';
import { MarketingConsent, ROUTE_CHANGE_EVENT } from '../shared/marketing/MarketingConsent';
import { PwaInstallPrompt } from '../shared/pwa/PwaInstallPrompt';
import { ThemeProvider, useTheme } from '../shared/theme/ThemeProvider';
import { loadPublicPlan, type PublicPlan } from '../shared/usage/usageClient';

const VoiceStudio = lazy(() =>
  import('../features/voice/VoiceStudio').then(({ VoiceStudio: Component }) => ({
    default: Component,
  })),
);

type ModuleId = 'voice' | 'writing' | 'video' | 'account';

type WorkspaceModule = {
  id: ModuleId;
  label: string;
  eyebrow: string;
  description: string;
  slug: string;
};

const MODULES: readonly WorkspaceModule[] = [
  {
    id: 'voice',
    label: 'Hablar',
    eyebrow: 'Conversación a tu ritmo',
    description: 'Habla de cualquier tema y recibe una mejora prioritaria por turno.',
    slug: 'hablar',
  },
  {
    id: 'writing',
    label: 'Escribir',
    eyebrow: 'Corrección clara',
    description: 'Corrige textos en inglés y entiende cada mejora en español.',
    slug: 'escribir',
  },
  {
    id: 'video',
    label: 'Videos',
    eyebrow: 'Comprensión auditiva',
    description: 'Sigue una transcripción, toma notas y vuelve al segundo exacto.',
    slug: 'videos',
  },
  {
    id: 'account',
    label: 'Cuenta',
    eyebrow: 'Tu cuenta',
    description: 'Consulta tu plan, saldo y próxima renovación.',
    slug: 'cuenta',
  },
];

function initialModuleFromLocation(): ModuleId {
  if (typeof window === 'undefined') return 'voice';
  if (window.location.pathname.endsWith('/escribir')) return 'writing';
  if (window.location.pathname.endsWith('/videos')) return 'video';
  if (window.location.pathname.endsWith('/cuenta')) return 'account';
  const legacyId = window.location.hash.slice(1);
  return legacyId === 'writing' || legacyId === 'video' || legacyId === 'voice' || legacyId === 'account'
    ? legacyId
    : 'voice';
}

export function DemoWorkspace() {
  return (
    <ThemeProvider>
      <ProductAuthProvider>
        <AccountScopedWorkspace />
      </ProductAuthProvider>
    </ThemeProvider>
  );
}

function AccountScopedWorkspace() {
  const { mode, sessionKey } = useProductSession();
  const { setThemeId } = useTheme();
  const [preferencesReady, setPreferencesReady] = useState(mode === 'fake');

  useEffect(() => {
    if (mode === 'fake') return;
    let active = true;
    setPreferencesReady(false);
    resetAccountPreferences();
    void loadAccountPreferences()
      .then((preferences) => {
        if (!active) return;
        setThemeId(preferences.theme);
        const voice = EDGE_VOICES.find((candidate) => candidate.id === preferences.speech_voice);
        if (voice) saveSpeechVoice(voice.id);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setPreferencesReady(true);
      });
    return () => { active = false; };
  }, [mode, sessionKey, setThemeId]);

  if (!preferencesReady) {
    return <main aria-live="polite" className="auth-gate">Cargando tus preferencias…</main>;
  }
  return (
    <>
      <Workspace key={sessionKey} />
      <MarketingConsent authenticated />
      <PwaInstallPrompt />
    </>
  );
}

function Workspace() {
  const [activeId, setActiveId] = useState<ModuleId>('voice');
  const [hasResolvedInitialModule, setHasResolvedInitialModule] = useState(false);
  const isInitialModule = useRef(true);
  const activeModule = MODULES.find((module) => module.id === activeId) ?? MODULES[0];

  useEffect(() => {
    const syncModuleWithLocation = () => setActiveId(initialModuleFromLocation());
    syncModuleWithLocation();
    setHasResolvedInitialModule(true);
    window.addEventListener('popstate', syncModuleWithLocation);
    return () => window.removeEventListener('popstate', syncModuleWithLocation);
  }, []);

  useEffect(() => {
    if (!hasResolvedInitialModule || isInitialModule.current) {
      isInitialModule.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('practice-title')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, hasResolvedInitialModule]);

  const workspace = (
    <section className="workspace" aria-label="Aplicación de Inglés al Grano">
      <header className="workspace-topbar">
        <a className="brand" href="/">
          <span aria-hidden="true" className="brand-mark">IA</span>
          Inglés al Grano
        </a>
        <div className="workspace-actions">
          <span className="alpha-badge">Prueba gratis</span>
          <SessionControl />
          <ThemeModeToggle />
        </div>
      </header>

      <nav aria-label="Módulos de práctica" className="module-nav">
        {MODULES.map((module) => {
          const isActive = module.id === activeId;
          return (
            <a
              aria-current={isActive ? 'page' : undefined}
              aria-label={module.label}
              className="module-nav-button"
              href={`/app/${module.slug}`}
              key={module.id}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                if (window.location.pathname !== `/app/${module.slug}`) {
                  window.history.pushState(null, '', `/app/${module.slug}`);
                  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
                }
                setActiveId(module.id);
              }}
            >
              <ModuleGlyph module={module.id} />
              <span>{module.label}</span>
            </a>
          );
        })}
      </nav>

      <main className="practice-main">
        <header className="practice-intro">
          <h1 id="practice-title" tabIndex={-1}>{activeModule.eyebrow}</h1>
          <p>{activeModule.description}</p>
        </header>
        <section className="practice-content" aria-label={`${activeModule.label}: espacio de práctica`}>
          {activeId === 'writing' ? <WritingStudio /> : null}
          {activeId === 'video' ? <VideoLab /> : null}
          {activeId === 'voice' ? (
            <Suspense fallback={<VoiceFallback />}>
              <VoiceStudio />
            </Suspense>
          ) : null}
          {activeId === 'account' ? <AccountPanel /> : null}
        </section>
      </main>

      <footer className="workspace-panel" aria-live="polite">
        <strong>Tu prueba gratuita</strong>
        <PlanTrialSummary />
      </footer>
    </section>
  );

  return (
    <div className="workspace-page">
      {activeId === 'video' ? <VideoLabProvider>{workspace}</VideoLabProvider> : workspace}
    </div>
  );
}

function PlanTrialSummary() {
  const [plan, setPlan] = useState<PublicPlan | null>(null);

  useEffect(() => {
    let active = true;
    void loadPublicPlan()
      .then((loaded) => { if (active) setPlan(loaded); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const trial = plan?.trial;
  return (
    <span>
      {trial
        ? `${formatPlanMinutes(trial.voice_seconds)} min de voz · hasta ${trial.voice_turns} intervenciones · ${trial.writings} correcciones · ${trial.videos} videos`
        : '10 min de voz · hasta 30 intervenciones · 10 correcciones · 3 videos'}
    </span>
  );
}

function formatPlanMinutes(seconds: number): number {
  return Math.floor(seconds / 60);
}

function SessionControl() {
  const session = useProductSession();
  if (!session.signOut) return <span className="session-chip">{session.label}</span>;
  return (
    <button className="session-chip session-button" onClick={() => void session.signOut?.()} type="button">
      <span>{session.label}</span>
      <span aria-hidden="true">Salir</span>
    </button>
  );
}

function VoiceFallback() {
  return (
    <section
      aria-busy="true"
      aria-label="Cargando Hablar"
      className="voice-studio voice-studio-fallback"
      role="status"
    >
      <div className="voice-fallback-simple" aria-hidden="true">
        <span className="voice-fallback-line voice-fallback-line-sm" />
        <span className="voice-fallback-power" />
        <span className="voice-fallback-line" />
        <span className="voice-fallback-line voice-fallback-line-md" />
      </div>
      <span className="sr-only">Cargando Hablar…</span>
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
  if (module === 'account') {
    return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.6" /><path d="M5.5 19c.8-3.2 3-5 6.5-5s5.7 1.8 6.5 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>;
  }
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M5 13.5v-3M8.5 16v-8M12 19V5M15.5 16v-8M19 13.5v-3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function ThemeModeToggle() {
  const { mode } = useProductSession();
  const { themeId, setThemeId } = useTheme();
  const isLight = themeId === 'light';
  const label = isLight ? 'Activar modo oscuro' : 'Activar modo claro';

  return (
    <button
      aria-label={label}
      className="workspace-icon-button"
      onClick={() => {
        const next = isLight ? 'dark' : 'light';
        setThemeId(next);
        if (mode === 'clerk') void updateAccountPreferences({ theme: next });
      }}
      title={label}
      type="button"
    >
      {isLight ? <MoonGlyph /> : <SunGlyph />}
    </button>
  );
}

function MoonGlyph() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M20 15.4A8 8 0 0 1 8.6 4a8 8 0 1 0 11.4 11.4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function SunGlyph() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}
