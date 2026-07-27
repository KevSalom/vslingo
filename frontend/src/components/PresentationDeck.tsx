import React, { useState, useEffect, useCallback } from 'react';

interface SlideData {
  id: string;
  tag: string;
  title: string;
  subtitle?: string;
  content: React.ReactNode;
}

export const PresentationDeck: React.FC = () => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const slides: SlideData[] = [
    {
      id: 'portada',
      tag: 'Hackathon Código Facilito 2026',
      title: '',
      content: (
        <div className="deck-cover">
          <p className="deck-pill">
            <span className="deck-pill-dot" aria-hidden="true" />
            Inglés técnico B1–C1 para developers
          </p>

          <h1 className="deck-display">
            VSLingo<span className="deck-display-dot">.</span>
          </h1>

          <p className="deck-lead">
            Practica el inglés profesional que usas para desarrollar —
            con la naturalidad de un editor de código.
            Experiencia <strong className="deck-em">«al grano, sin ruido»</strong> para
            hispanohablantes.
          </p>

          <div className="deck-grid deck-grid-3">
            <article className="deck-card">
              <p className="deck-card-label">01 · Interfaz</p>
              <h3>Inspirada en VS Code</h3>
              <p>Experiencia sobria, sin distracciones, pensada para programadores.</p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-secondary">02 · Filosofía</p>
              <h3>Cero gamificación infantil</h3>
              <p>Sin rachas, corazones ni mascotas. Enfoque 100% profesional.</p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-success">03 · Escenarios</p>
              <h3>Contexto developer real</h3>
              <p>Daily standups, system design, negociación salarial y PRs.</p>
            </article>
          </div>
        </div>
      ),
    },

    {
      id: 'problema',
      tag: 'Análisis de mercado',
      title: 'La brecha del inglés técnico',
      subtitle: 'Por qué las apps tradicionales fallan con profesionales de software',
      content: (
        <div className="deck-grid deck-grid-2">
          <article className="deck-card deck-card-out">
            <p className="deck-card-label deck-card-label-danger">
              <span className="deck-badge deck-badge-danger">✕</span>
              Apps tradicionales
            </p>
            <ul className="deck-list">
              <li>
                <span className="deck-list-mark deck-list-mark-danger" aria-hidden="true">−</span>
                <span>
                  <strong>Gamificación infantil:</strong> rachas y vidas en lugar de aprendizaje
                  efectivo.
                </span>
              </li>
              <li>
                <span className="deck-list-mark deck-list-mark-danger" aria-hidden="true">−</span>
                <span>
                  <strong>Frases desconectadas:</strong> «where is the bathroom?» no prepara una
                  system design interview.
                </span>
              </li>
              <li>
                <span className="deck-list-mark deck-list-mark-danger" aria-hidden="true">−</span>
                <span>
                  <strong>Sin contexto técnico:</strong> no cubren jerga de ingeniería ni fluidez
                  B1–C1 de empresas globales.
                </span>
              </li>
            </ul>
          </article>

          <article className="deck-card deck-card-in">
            <p className="deck-card-label">
              <span className="deck-badge deck-badge-primary">✓</span>
              La solución VSLingo
            </p>
            <ul className="deck-list">
              <li>
                <span className="deck-list-mark" aria-hidden="true">+</span>
                <span>
                  <strong>«Al grano, sin ruido»:</strong> interfaz de editor de código, sin
                  distracciones.
                </span>
              </li>
              <li>
                <span className="deck-list-mark" aria-hidden="true">+</span>
                <span>
                  <strong>Inglés técnico B1–C1:</strong> voz en escenarios de arquitectura,
                  entrevistas y dailies.
                </span>
              </li>
              <li>
                <span className="deck-list-mark" aria-hidden="true">+</span>
                <span>
                  <strong>Feedback en diff:</strong> análisis gramatical estilo Git con
                  explicaciones en español.
                </span>
              </li>
            </ul>
          </article>
        </div>
      ),
    },

    {
      id: 'voice-studio',
      tag: 'Módulo 1 de 3',
      title: 'Voice Studio',
      subtitle: 'Conversación por voz en tiempo real, con manos libres e interrupción nativa',
      content: (
        <div className="deck-stack">
          <div className="deck-grid deck-grid-3">
            <article className="deck-card">
              <p className="deck-card-label">01 · Escenarios</p>
              <h3>4 modos profesionales</h3>
              <p>Daily standup, system design, salary negotiation y exploración libre.</p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-success">02 · Manos libres</p>
              <h3>VAD local + barge-in</h3>
              <p>Detección de voz en el cliente e interrupción natural al asistente.</p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-secondary">03 · IA paralela</p>
              <h3>Feedback sin fricción</h3>
              <p>Audio en streaming mientras el feedback gramatical corre en paralelo.</p>
            </article>
          </div>

          <div className="deck-callout">
            <div>
              <p className="deck-card-label">Prueba en vivo</p>
              <p className="deck-callout-copy">
                VAD sin botones, conversación fluida y feedback estructurado.
              </p>
            </div>
            <a className="cta" href="/demo" target="_blank" rel="noreferrer">
              Probar Voice Studio
            </a>
          </div>
        </div>
      ),
    },

    {
      id: 'writing-studio',
      tag: 'Módulo 2 de 3',
      title: 'Writing Studio',
      subtitle: 'Corrección estructurada para PRs, Slack y documentación técnica',
      content: (
        <div className="deck-stack">
          <div className="deck-grid deck-grid-3">
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-success">01 · Git diff</p>
              <h3>Resaltado de cambios</h3>
              <p>Adiciones en verde y eliminaciones en rojo, como en una revisión de código.</p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label">02 · Pedagogía</p>
              <h3>Explicaciones en español</h3>
              <p>Entiende el motivo de cada ajuste gramatical o de tono.</p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-aws">03 · TTS</p>
              <h3>Voz neuronal</h3>
              <p>Escucha la pronunciación correcta del texto corregido al instante.</p>
            </article>
          </div>

          <div className="deck-diff-frame">
            <div className="deck-diff-header">
              <span>Vista previa del corrector</span>
              <span className="deck-diff-meta">structured correction</span>
            </div>
            <p className="sig-diff sig-diff-remove">
              <span>−</span>I has created the pull request yesterday for fix the backend bug.
            </p>
            <p className="sig-diff sig-diff-add">
              <span>+</span>I created the pull request yesterday to fix the backend bug.
            </p>
            <p className="deck-diff-note">
              // «created» (pasado simple) por «yesterday»; «to fix» expresa finalidad.
            </p>
          </div>

          <div className="deck-callout">
            <div>
              <p className="deck-card-label">Prueba en vivo</p>
              <p className="deck-callout-copy">
                Diff estilo Git, explicaciones en español y TTS del texto corregido.
              </p>
            </div>
            <a className="cta" href="/demo" target="_blank" rel="noreferrer">
              Probar Writing Studio
            </a>
          </div>
        </div>
      ),
    },

    {
      id: 'video-lab',
      tag: 'Módulo 3 de 3',
      title: 'Video Lab',
      subtitle: 'Inmersión en charlas técnicas de YouTube con notas y timestamps',
      content: (
        <div className="deck-stack">
          <div className="deck-grid deck-grid-3">
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-secondary">01 · Transcripción</p>
              <h3>Navegación interactiva</h3>
              <p>YouTube sincronizado con frases en vista de línea o párrafo.</p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label">02 · Estilo VS Code</p>
              <h3>Explorer y biblioteca</h3>
              <p>Árbol local de vídeos técnicos y apuntes, al estilo del editor.</p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-success">03 · Notas</p>
              <h3>Marcas de tiempo</h3>
              <p>Vuelve al segundo exacto donde se explicó un término.</p>
            </article>
          </div>

          <div className="deck-callout">
            <div>
              <p className="deck-card-label">Prueba en vivo</p>
              <p className="deck-callout-copy">
                Transcript API + player sincronizado + notas en storage v2.
              </p>
            </div>
            <a className="cta" href="/demo" target="_blank" rel="noreferrer">
              Probar Video Lab
            </a>
          </div>
        </div>
      ),
    },

    {
      id: 'arquitectura',
      tag: 'Ingeniería',
      title: 'Arquitectura y stack',
      subtitle: 'Latencia mínima, streaming continuo y contratos estrictos',
      content: (
        <div className="deck-grid deck-grid-2">
          <article className="deck-card">
            <p className="deck-card-label">Frontend · Jamstack</p>
            <ul className="deck-list deck-list-compact">
              <li>
                <span className="deck-list-mark" aria-hidden="true">·</span>
                <span>
                  <strong>Astro + React 19:</strong> landing estática y workspace reactivo.
                </span>
              </li>
              <li>
                <span className="deck-list-mark" aria-hidden="true">·</span>
                <span>
                  <strong>Tailwind CSS v4:</strong> tokens semánticos y shell tipo editor.
                </span>
              </li>
              <li>
                <span className="deck-list-mark" aria-hidden="true">·</span>
                <span>
                  <strong>VAD client:</strong> detección de voz y medidor local.
                </span>
              </li>
            </ul>
          </article>

          <article className="deck-card">
            <p className="deck-card-label deck-card-label-success">Backend · FastAPI</p>
            <ul className="deck-list deck-list-compact">
              <li>
                <span className="deck-list-mark deck-list-mark-success" aria-hidden="true">·</span>
                <span>
                  <strong>Python async:</strong> WebSockets bidireccionales.
                </span>
              </li>
              <li>
                <span className="deck-list-mark deck-list-mark-success" aria-hidden="true">·</span>
                <span>
                  <strong>TTSConsumer + queues:</strong> audio y feedback orquestados.
                </span>
              </li>
              <li>
                <span className="deck-list-mark deck-list-mark-success" aria-hidden="true">·</span>
                <span>
                  <strong>Pydantic strict:</strong> contratos end-to-end.
                </span>
              </li>
            </ul>
          </article>

          <article className="deck-card">
            <p className="deck-card-label deck-card-label-secondary">Inteligencia artificial</p>
            <ul className="deck-list deck-list-compact">
              <li>
                <span className="deck-list-mark deck-list-mark-secondary" aria-hidden="true">·</span>
                <span>
                  <strong>STT:</strong> Whisper Large v3 Turbo vía OpenRouter.
                </span>
              </li>
              <li>
                <span className="deck-list-mark deck-list-mark-secondary" aria-hidden="true">·</span>
                <span>
                  <strong>LLM:</strong> Gemini 3.1 Flash-Lite en streaming B1–C1.
                </span>
              </li>
              <li>
                <span className="deck-list-mark deck-list-mark-secondary" aria-hidden="true">·</span>
                <span>
                  <strong>Feedback paralelo:</strong> JSON Schema sin frenar la charla.
                </span>
              </li>
            </ul>
          </article>

          <article className="deck-card">
            <p className="deck-card-label deck-card-label-aws">Audio · TTS</p>
            <ul className="deck-list deck-list-compact">
              <li>
                <span className="deck-list-mark deck-list-mark-aws" aria-hidden="true">·</span>
                <span>
                  <strong>Edge Neural:</strong> motor principal a $0.
                </span>
              </li>
              <li>
                <span className="deck-list-mark deck-list-mark-aws" aria-hidden="true">·</span>
                <span>
                  <strong>AWS Polly Neural:</strong> opción secundaria.
                </span>
              </li>
              <li>
                <span className="deck-list-mark deck-list-mark-aws" aria-hidden="true">·</span>
                <span>
                  <strong>Adapter:</strong> síntesis desacoplada en backend.
                </span>
              </li>
            </ul>
          </article>
        </div>
      ),
    },

    {
      id: 'costos-tarifas',
      tag: 'Modelo y costes · 1/3',
      title: 'Tarifas de proveedores',
      subtitle: 'Precios públicos OpenRouter + AWS Polly · Edge Neural a $0',
      content: (
        <div className="deck-stack">
          <div className="deck-cost-panel">
            <div className="deck-diff-header">
              <span>Catálogo unitario 2026</span>
              <span className="deck-diff-meta">openrouter.ai · aws.amazon.com/polly</span>
            </div>
            <div className="deck-grid deck-grid-4">
              <div className="deck-stat">
                <span className="deck-stat-label">STT · Whisper Large v3 Turbo</span>
                <strong>~$0.04 / h</strong>
                <span className="deck-stat-note">openai/whisper-large-v3-turbo</span>
              </div>
              <div className="deck-stat">
                <span className="deck-stat-label">LLM · Gemini 3.1 Flash-Lite</span>
                <strong>$0.25 / $1.50</strong>
                <span className="deck-stat-note">por 1M tokens in / out</span>
              </div>
              <div className="deck-stat">
                <span className="deck-stat-label">TTS · Edge Neural</span>
                <strong className="deck-stat-success">$0.00</strong>
                <span className="deck-stat-note">Microsoft Edge · gratuito</span>
              </div>
              <div className="deck-stat">
                <span className="deck-stat-label">TTS · AWS Polly Neural</span>
                <strong>$16 / 1M chars</strong>
                <span className="deck-stat-note">opcional · no obligatorio</span>
              </div>
            </div>
          </div>

          <div className="deck-callout deck-callout-save">
            <div>
              <p className="deck-card-label deck-card-label-success">Ahorro con Edge Neural</p>
              <p className="deck-callout-copy">
                Polly Neural cuesta <strong>$16 / 1M caracteres</strong>. VSLingo puede operar
                solo con <strong>Microsoft Edge Neural a $0</strong> y eliminar casi todo el gasto
                de síntesis de voz — el mayor ahorro de recursos y el default económico del producto.
              </p>
            </div>
            <div className="deck-save-badge" aria-hidden="true">
              <span>TTS</span>
              <strong>$0</strong>
            </div>
          </div>
        </div>
      ),
    },

    {
      id: 'costos-modulos',
      tag: 'Modelo y costes · 2/3',
      title: 'Desglose de gastos por módulo',
      subtitle: 'Tarifa del proveedor · estimado con uso moderado y Edge Neural ($0 TTS)',
      content: (
        <div className="deck-stack">
          <div className="deck-grid deck-grid-3">
            <article className="deck-card deck-card-in">
              <p className="deck-card-label">01 · Voice Studio</p>
              <p className="deck-module-cost">~$0.72 / mes</p>
              <p className="deck-module-scope">uso moderado · 10 min voz / día</p>
              <div className="deck-rate-table">
                <div className="deck-rate-row">
                  <span>Whisper STT</span>
                  <strong>$0.04 / h</strong>
                </div>
                <div className="deck-rate-row">
                  <span>Gemini in / out</span>
                  <strong>$0.25 / $1.50 · 1M</strong>
                </div>
                <div className="deck-rate-row">
                  <span>Edge TTS</span>
                  <strong className="deck-stat-success">$0</strong>
                </div>
              </div>
              <p className="deck-estimate-note">
                ~2.5 h STT + ~0.8M tok LLM al mes
              </p>
            </article>

            <article className="deck-card deck-card-in">
              <p className="deck-card-label">02 · Writing Studio</p>
              <p className="deck-module-cost">~$0.18 / mes</p>
              <p className="deck-module-scope">uso moderado · 5 correcciones / día</p>
              <div className="deck-rate-table">
                <div className="deck-rate-row">
                  <span>Gemini in</span>
                  <strong>$0.25 / 1M tok</strong>
                </div>
                <div className="deck-rate-row">
                  <span>Gemini out</span>
                  <strong>$1.50 / 1M tok</strong>
                </div>
                <div className="deck-rate-row">
                  <span>Edge TTS</span>
                  <strong className="deck-stat-success">$0</strong>
                </div>
              </div>
              <p className="deck-estimate-note">
                ~150 corr. · ~1.2k in + 0.6k out c/u
              </p>
            </article>

            <article className="deck-card deck-card-in">
              <p className="deck-card-label">03 · Video Lab</p>
              <p className="deck-module-cost deck-module-cost-success">$0.00 / mes</p>
              <p className="deck-module-scope">uso moderado · estudio ilimitado</p>
              <div className="deck-rate-table">
                <div className="deck-rate-row">
                  <span>Whisper STT</span>
                  <strong>no usa</strong>
                </div>
                <div className="deck-rate-row">
                  <span>Gemini LLM</span>
                  <strong>no usa</strong>
                </div>
                <div className="deck-rate-row">
                  <span>Edge / Polly TTS</span>
                  <strong>no usa</strong>
                </div>
              </div>
              <p className="deck-estimate-note">
                solo captions YouTube + notas locales
              </p>
            </article>
          </div>

          <div className="deck-cost-panel">
            <div className="deck-diff-header">
              <span>Total mensual · 1 usuario · uso moderado</span>
              <span className="deck-diff-meta">Edge Neural · Polly no incluido</span>
            </div>
            <div className="deck-grid deck-grid-4">
              <div className="deck-stat">
                <span className="deck-stat-label">Voice</span>
                <strong>~$0.72</strong>
              </div>
              <div className="deck-stat">
                <span className="deck-stat-label">Writing</span>
                <strong>~$0.18</strong>
              </div>
              <div className="deck-stat">
                <span className="deck-stat-label">Video</span>
                <strong className="deck-stat-success">$0.00</strong>
              </div>
              <div className="deck-stat deck-stat-accent">
                <span className="deck-stat-label">Total / mes</span>
                <strong>~$0.90</strong>
              </div>
            </div>
          </div>
        </div>
      ),
    },

    {
      id: 'costos-competencia',
      tag: 'Modelo y costes · 3/3',
      title: 'Planes y competencia',
      subtitle: 'Coste de proveedor ~$0.90/mes en uso moderado · margen alto con Edge Neural',
      content: (
        <div className="deck-stack">
          <div className="deck-grid deck-grid-3">
            <article className="deck-card deck-card-out">
              <p className="deck-card-label deck-card-label-danger">Duolingo / Elsa</p>
              <p className="deck-price">
                $7.99 – $12.99 <span>/ mes</span>
              </p>
              <p>Alta gamificación, sin contexto de programación ni entrevistas reales.</p>
            </article>
            <article className="deck-card deck-card-out">
              <p className="deck-card-label deck-card-label-danger">Cambly / Open English</p>
              <p className="deck-price">
                $60 – $150 <span>/ mes</span>
              </p>
              <p>Clases humanas caras, difíciles de agendar y sin foco en código.</p>
            </article>
            <article className="deck-card deck-card-in">
              <p className="deck-card-label">VSLingo</p>
              <div className="deck-price-stack">
                <p className="deck-price deck-price-sm">
                  Básico · $1.99 <span>/ mes</span>
                </p>
                <p className="deck-price deck-price-sm deck-price-primary">
                  Pro · $4.99 <span>/ mes</span>
                </p>
              </div>
              <p>
                Con coste AI ~$0.90 en uso moderado, Pro cubre uso casi ilimitado y deja margen
                amplio.
              </p>
            </article>
          </div>

          <div className="deck-cost-panel">
            <div className="deck-diff-header">
              <span>Qué incluye cada plan</span>
              <span className="deck-diff-meta">default TTS = Edge Neural · Polly opcional en Pro</span>
            </div>
            <div className="deck-grid deck-grid-2">
              <article className="deck-card">
                <p className="deck-card-label">Básico · $1.99</p>
                <p className="deck-module-cost deck-module-cost-sm">
                  Uso diario cómodo
                </p>
                <div className="deck-rate-table">
                  <div className="deck-rate-row">
                    <span>Voice</span>
                    <strong>~10–15 min / día</strong>
                  </div>
                  <div className="deck-rate-row">
                    <span>Writing</span>
                    <strong>~5–10 corr. / día</strong>
                  </div>
                  <div className="deck-rate-row">
                    <span>Video Lab</span>
                    <strong>ilimitado</strong>
                  </div>
                  <div className="deck-rate-row">
                    <span>TTS</span>
                    <strong className="deck-stat-success">Edge $0</strong>
                  </div>
                  <div className="deck-rate-row">
                    <span>Margen vs AI</span>
                    <strong>~2× coste</strong>
                  </div>
                </div>
              </article>
              <article className="deck-card deck-card-in">
                <p className="deck-card-label">Pro · $4.99</p>
                <p className="deck-module-cost deck-module-cost-success deck-module-cost-sm">
                  Uso casi ilimitado
                </p>
                <div className="deck-rate-table">
                  <div className="deck-rate-row">
                    <span>Voice</span>
                    <strong>~45–60 min / día</strong>
                  </div>
                  <div className="deck-rate-row">
                    <span>Writing</span>
                    <strong>~30+ corr. / día</strong>
                  </div>
                  <div className="deck-rate-row">
                    <span>Video Lab</span>
                    <strong>ilimitado</strong>
                  </div>
                  <div className="deck-rate-row">
                    <span>TTS</span>
                    <strong>Edge + Polly opcional</strong>
                  </div>
                  <div className="deck-rate-row">
                    <span>AI intenso ~$3–4</span>
                    <strong className="deck-stat-success">sigue en margen</strong>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>
      ),
    },

    {
      id: 'proximos-pasos',
      tag: 'Roadmap post-Alpha',
      title: 'Próximos pasos',
      subtitle: 'Después del despliegue: producto multiidioma, cuenta, datos y modelo de negocio',
      content: (
        <div className="deck-stack">
          <div className="deck-grid deck-grid-2">
            <article className="deck-card">
              <p className="deck-card-label">01 · Locale EN</p>
              <h3>Versión en inglés</h3>
              <p>
                La UI y las explicaciones están en <strong>español</strong> para reducir la fricción
                inicial. Un locale inglés completo permitirá a usuarios más avanzados practicar y
                recibir feedback todo en inglés.
              </p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-success">02 · Datos</p>
              <h3>Persistencia con base de datos</h3>
              <p>
                Historial, biblioteca y preferencias sincronizados entre dispositivos, más allá del{' '}
                <code>localStorage</code> de la Alpha.
              </p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-secondary">03 · Identidad</p>
              <h3>Autenticación</h3>
              <p>
                Cuentas para progreso guardado, cuotas por usuario y experiencia multi-dispositivo
                cuando deje de bastar el modo anónimo.
              </p>
            </article>
            <article className="deck-card">
              <p className="deck-card-label deck-card-label-aws">04 · Ops</p>
              <h3>Telemetría y monitorización</h3>
              <p>
                Métricas de latencia, errores y uso por módulo — sin registrar audio, transcripts ni
                prompts en claro.
              </p>
            </article>
          </div>

          <div className="deck-callout">
            <div>
              <p className="deck-card-label">05 · Estrategia</p>
              <p className="deck-callout-copy">
                <strong>Monetización</strong> (planes Básico/Pro ya esbozados){' '}
                <strong>o código abierto</strong>: decisión a validar con la Alpha en producción y
                la comunidad.
              </p>
            </div>
            <span className="deck-pill">
              <span className="deck-pill-dot" aria-hidden="true" />
              post-Alpha
            </span>
          </div>
        </div>
      ),
    },

    {
      id: 'cierre',
      tag: 'Cierre',
      title: 'Al grano, sin ruido',
      subtitle: 'Inglés profesional para la comunidad hispanohablante de software',
      content: (
        <div className="deck-cover deck-cover-end">
          <div className="deck-closing">
            <h3 className="deck-closing-title">
              ¿Listos para practicar el inglés que usas para desarrollar?
            </h3>
            <p className="deck-lead">
              Interfaz de editor, IA de respuesta inmediata y arquitectura económica en un producto
              listo para producción.
            </p>
            <div className="hero-actions">
              <a className="cta" href="/demo" target="_blank" rel="noreferrer">
                Explorar demo
              </a>
              <a className="cta cta-secondary" href="/">
                Ir a la landing
              </a>
            </div>
          </div>
          <p className="deck-footnote">
            Hackathon Código Facilito 2026 · Astro · React 19 · FastAPI · OpenRouter
          </p>
        </div>
      ),
    },
  ];

  const handleNext = useCallback(() => {
    setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1));
  }, [slides.length]);

  const handlePrev = useCallback(() => {
    setCurrentSlide((prev) => Math.max(prev - 1, 0));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isSpace = e.key === ' ' || e.code === 'Space';

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || isSpace) {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'Home') {
        e.preventDefault();
        setCurrentSlide(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setCurrentSlide(slides.length - 1);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [handleNext, handlePrev, slides.length, toggleFullscreen]);

  const activeSlide = slides[currentSlide];
  const progress = ((currentSlide + 1) / slides.length) * 100;

  return (
    <div className="deck" role="region" aria-label="Presentación VSLingo">
      <header className="deck-topbar">
        <div className="deck-brand-row">
          <a className="brand" href="/" aria-label="VSLingo, inicio">
            <span aria-hidden="true" className="brand-mark">
              V/
            </span>
            VSLingo
          </a>
          <span className="deck-crumb" aria-hidden="true">
            /
          </span>
          <span className="deck-crumb-label">Presentación</span>
        </div>

        <div className="deck-controls">
          <p className="deck-counter" aria-live="polite">
            <span className="deck-counter-current">{currentSlide + 1}</span>
            <span aria-hidden="true"> / </span>
            {slides.length}
          </p>

          <button
            type="button"
            className="deck-btn"
            onClick={handlePrev}
            disabled={currentSlide === 0}
            title="Anterior (←)"
          >
            ← Ant
          </button>

          <button
            type="button"
            className="deck-btn deck-btn-primary"
            onClick={handleNext}
            disabled={currentSlide === slides.length - 1}
            title="Siguiente (→ o Espacio)"
          >
            Sig →
          </button>

          <a
            className="deck-btn deck-btn-ghost deck-btn-demo"
            href="/demo"
            target="_blank"
            rel="noreferrer"
            title="Abrir demo"
          >
            Demo
          </a>

          <button
            type="button"
            className="deck-btn deck-btn-icon"
            onClick={toggleFullscreen}
            title="Pantalla completa (F)"
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? '↙' : '⤢'}
          </button>
        </div>
      </header>

      <div className="deck-progress" aria-hidden="true">
        <div className="deck-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      <main className="deck-main" key={activeSlide.id}>
        <div className="deck-slide">
          <header className="deck-slide-header">
            <p className="eyebrow">{activeSlide.tag}</p>
            {activeSlide.title ? (
              <h2 className="deck-slide-title">{activeSlide.title}</h2>
            ) : null}
            {activeSlide.subtitle ? (
              <p className="deck-slide-subtitle">{activeSlide.subtitle}</p>
            ) : null}
          </header>
          <div className="deck-slide-body">{activeSlide.content}</div>
        </div>
      </main>

      <footer className="deck-footer">
        <p className="deck-keys">
          <kbd>←</kbd> <kbd>→</kbd> <kbd>Espacio</kbd> navegar
          <span className="deck-keys-extra">
            · <kbd>F</kbd> pantalla completa
          </span>
        </p>

        <div className="deck-dots" role="tablist" aria-label="Diapositivas">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={idx === currentSlide}
              aria-label={`Diapositiva ${idx + 1}: ${s.title}`}
              className={idx === currentSlide ? 'deck-dot is-active' : 'deck-dot'}
              onClick={() => setCurrentSlide(idx)}
            />
          ))}
        </div>
      </footer>
    </div>
  );
};
