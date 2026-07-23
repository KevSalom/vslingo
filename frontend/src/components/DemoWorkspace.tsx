import { useState } from 'react';

import { VideoLab } from '../features/video/VideoLab';
import { WritingStudio } from '../features/writing/WritingStudio';

type ModuleId = 'voice' | 'writing' | 'video';

type WorkspaceModule = {
  id: ModuleId;
  label: string;
  eyebrow: string;
  description: string;
};

const MODULES: readonly WorkspaceModule[] = [
  {
    id: 'voice',
    label: 'Voice Studio',
    eyebrow: 'Conversación técnica',
    description: 'Practica conversaciones profesionales en inglés con feedback claro.',
  },
  {
    id: 'writing',
    label: 'Writing Studio',
    eyebrow: 'Escritura profesional',
    description: 'Prepara mensajes técnicos precisos y comprende cada corrección.',
  },
  {
    id: 'video',
    label: 'Video Lab',
    eyebrow: 'Comprensión auditiva',
    description: 'Estudia inglés técnico a partir de transcripciones navegables.',
  },
];

export function DemoWorkspace() {
  const [activeId, setActiveId] = useState<ModuleId>('voice');
  const activeModule = MODULES.find((module) => module.id === activeId) ?? MODULES[0];

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/30">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <a className="text-lg font-semibold tracking-tight" href="/">
              VSLingo
            </a>
            <p className="text-sm text-slate-400">Developer English workspace</p>
          </div>
          <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
            Public Alpha
          </span>
        </header>

        <div className="grid flex-1 md:grid-cols-[15rem_1fr]">
          <nav
            aria-label="Módulos de práctica"
            className="border-b border-slate-800 bg-slate-950/40 p-3 md:border-r md:border-b-0"
          >
            <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-1">
              {MODULES.map((module) => {
                const isActive = module.id === activeId;
                return (
                  <button
                    aria-pressed={isActive}
                    className={`rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
                      isActive
                        ? 'bg-cyan-400 text-slate-950'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                    key={module.id}
                    onClick={() => setActiveId(module.id)}
                    type="button"
                  >
                    {module.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <section
            className={`min-w-0 p-5 sm:p-7 lg:p-10 ${
              activeId === 'voice' ? 'flex items-center' : ''
            }`}
          >
            {activeId === 'writing' ? (
              <WritingStudio />
            ) : activeId === 'video' ? (
              <VideoLab />
            ) : (
              <div className="max-w-2xl">
                <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
                  {activeModule.eyebrow}
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                  {activeModule.label}
                </h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                  {activeModule.description}
                </p>
                <div className="mt-8 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-sm text-slate-400">
                  Punto de entrada preparado. La funcionalidad vertical se implementará en su
                  incremento correspondiente.
                </div>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
