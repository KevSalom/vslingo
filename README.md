# VSLingo Public Alpha

> **The Code-Editor Interface for Mastering Developer English.**

VSLingo es una plataforma de práctica de inglés para desarrolladores hispanohablantes. Su filosofía es **«al grano, sin ruido»**: práctica profesional, directa y sin mecánicas de gamificación infantil (sin rachas, gemas ni rutas obligatorias).

La interfaz y las explicaciones están en **español**. Las conversaciones, correcciones y el vocabulario se trabajan en **inglés B1–C1**. La experiencia se presenta como herramienta de desarrollo profesional, no como una copia de VS Code ni como una app de idiomas genérica.

Se puede probar la demo **sin registro**. El estado vive en `localStorage` versionado en el navegador.

---

## Estado

**Public Alpha 1.0 lista** (`T01`–`T10` completados). Los tres módulos del workspace están implementados, con pruebas unitarias/integración y E2E deterministas (proveedores falsos).

| | |
| --- | --- |
| **Avance** | Writing Studio · Video Lab · Voice Studio · landing · protecciones · E2E · guías de deploy |
| **Pendiente inmediato** | Despliegue real en producción (VPS/Dokploy + frontend estático) |
| **Fuente de estado** | [`docs/progress.md`](docs/progress.md) |
| **Presentación** | Ruta del sitio `/presentacion` (diapositivas) |

---

## Próximos pasos (post-Alpha)

Hoja de ruta orientativa después del despliegue de la Alpha. No forma parte del alcance `T01`–`T10`.

| Dirección | Qué implica |
| --- | --- |
| **UI en inglés** | Hoy la interfaz y las explicaciones van en **español** para bajar la fricción inicial de hispanohablantes. Una versión (o locale) en inglés permitirá a usuarios más avanzados usar producto y feedback enteramente en inglés, alineado con B1–C1. |
| **Persistencia con base de datos** | Sustituir o complementar `localStorage` con historial, biblioteca y preferencias sincronizados entre dispositivos. |
| **Autenticación** | Cuentas opcionales u obligatorias para guardar progreso, cuotas por usuario y multi-dispositivo. |
| **Telemetría y monitorización** | Métricas de producto y operación (latencia, errores, uso por módulo) sin registrar audio, transcripts ni prompts en claro. |
| **Modelo de negocio** | **Monetización** (planes, límites por tier) **o** apertura como **código abierto**, según la estrategia que se decida tras validar la Alpha en producción. |

---

## Módulos

| Módulo | Qué hace | Capacidad clave |
| --- | --- | --- |
| **Voice Studio** | Conversación por voz en tiempo real | VAD manos libres (Silero), barge-in, PTT de respaldo, 4 escenarios, feedback paralelo (diff, vocabulario, resumen), TTS en streaming |
| **Writing Studio** | Corrección estructurada de inglés técnico | Diff categorizado, feedback en español, copiar/limpiar, historial local, reproducción TTS |
| **Video Lab** | YouTube + subtítulos sincronizados | Seek, vistas párrafo/línea, biblioteca y notas locales, fixture técnico si YouTube falla |

### Voice Studio — escenarios

1. Daily Standup  
2. System Design / Technical Interview  
3. Salary Negotiation  
4. Libre / Explorar  

STT: OpenRouter Whisper. LLM: OpenRouter (conversación en streaming + feedback estructurado en paralelo). TTS seleccionable: **AWS Polly Neural** o **Microsoft Edge Neural** (`edge-tts`).

### Writing Studio

- Hasta 1000 caracteres por corrección  
- Editor + diff + feedback + acciones copiar/limpiar  
- Reciente en `localStorage`  
- Misma abstracción TTS que Voice  

### Video Lab

- Parser de URL YouTube (watch, short, Shorts, Live, embed)  
- Transcripción EN directa o traducida  
- Errores accionables si faltan captions o el proveedor bloquea  
- Explorer estilo tree (biblioteca + notas), notas con timestamp opcional  

### Landing

Ruta `/` estática (Astro, casi sin JS de cliente): hero, módulos, filosofía «sin ruido», privacidad y CTA **Probar demo** → `/demo`.

---

## Stack

| Capa | Tecnología | Rol |
| --- | --- | --- |
| Landing | Astro | SEO, contenido, entrada a la demo |
| Workspace | React 19 + Tailwind CSS v4 | UI en `/demo`, audio y VAD en el navegador |
| Backend | FastAPI · Python 3.11+ | REST + WebSocket Voice, orquestación async |
| STT | OpenRouter Whisper | Transcripción de segmentos de voz |
| LLM | OpenRouter (modelo configurable) | Corrección, chat streaming, feedback |
| TTS | AWS Polly Neural · Microsoft Edge Neural | MP3 `audio/mpeg`, selección explícita (sin fallback silencioso) |
| Vídeo | `youtube-transcript-api` | Subtítulos disponibles |
| Estado | `localStorage` versionado | Preferencias, reciente, biblioteca, notas |

**No incluido en Alpha:** auth, base de datos, payments/billing, Redis, multi-worker, Safari/móvil certificados.

---

## Arquitectura (resumen)

```text
Browser (Astro + React)          VPS (FastAPI)                 Proveedores
───────────────────────          ─────────────                 ───────────
Landing  →  /demo workspace
  Writing  ──REST──►  /api/writing, /api/speech, /api/video  → OpenRouter / Polly / Edge / YT
  Video
  Voice    ──WS────►  /api/voice/ws
            VAD (Silero) → WAV 16 kHz
            Session → STT → LLM+Feedback → TTS → audio chunks
            localStorage (prefs, notas, historial)
```

Backend: monolito modular con puertos y adaptadores falsos en tests. Sin credenciales de proveedores opcionales la API arranca y responde health; las rutas que necesiten proveedor devuelven error tipado.

---

## Estructura del repositorio

```text
vslingo/
├── frontend/          # Astro + React (landing `/`, workspace `/demo`)
├── backend/           # FastAPI (REST, WebSocket Voice, proveedores)
├── deploy/            # Dokploy/Nixpacks, Caddy, systemd, runbooks
├── docs/              # product-spec, implementation-plan, progress, specs
├── scripts/           # check-quality.ps1 (suite unificada)
├── render.yaml        # Render Static Site (frontend)
└── AGENTS.md          # Normas para agentes LLM
```

Detalles de paquete: [`frontend/README.md`](frontend/README.md) · [`backend/README.md`](backend/README.md) · [`deploy/README.md`](deploy/README.md).

---

## Requisitos

| Herramienta | Versión |
| --- | --- |
| Node.js | ≥ 22.12.0 |
| pnpm | 10.32.0 (fijado en `frontend/package.json`) |
| Python | ≥ 3.11 |
| uv | gestor del backend |
| Git | para el repo y `git diff --check` en la suite de calidad |
| Chrome o Edge | demo de micrófono / Voice (localhost o HTTPS) |

---

## Puesta en marcha local

Dos terminales. Los secretos de proveedores **no** son obligatorios para arrancar ni para health; sí lo son para correcciones/voz/TTS reales.

### 1. Backend

```powershell
Set-Location backend
Copy-Item .env.example .env   # solo la primera vez
uv sync --frozen --all-groups
uv run vslingo-api
```

- API: `http://127.0.0.1:8000`  
- Health: `GET /api/health`  

Variables habituales en `backend/.env` (vacías = arranque seguro):

- `OPENROUTER_API_KEY`, `OPENROUTER_LLM_MODEL` — Writing, Voice LLM/feedback y smokes  
- `OPENROUTER_STT_MODEL` — default Whisper turbo  
- `AWS_*` / `AWS_POLLY_VOICE_ID` — Polly  
- `EDGE_TTS_VOICE` — Edge Neural (sin credencial Azure)  
- `FRONTEND_ORIGIN` — CORS / origen WS (default `http://localhost:4321`)  

### 2. Frontend

```powershell
Set-Location frontend
Copy-Item .env.example .env   # solo si quieres override
pnpm install --frozen-lockfile
pnpm exec astro dev
```

- Landing: `http://localhost:4321/`  
- Demo: `http://localhost:4321/demo`  
- `PUBLIC_API_URL` por defecto `http://127.0.0.1:8000` (REST y WebSocket Voice derivados del mismo origen)  

Voice necesita contexto seguro (HTTPS o localhost) y permiso de micrófono. Si el VAD no inicia, queda push-to-talk.

### Endpoints principales

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness sin secretos |
| `POST` | `/api/writing/correct` | Corrección estructurada |
| `POST` | `/api/video/transcript` | Subtítulos YouTube |
| `POST` | `/api/speech` | TTS MP3 (Polly o Edge) |
| `WS` | `/api/voice/ws` | Sesión Voice en tiempo real |

---

## Validación y calidad

Normal: **fakes deterministas**, sin APIs de pago.

```powershell
# Todo el monorepo (backend + frontend check/test/build + E2E Playwright)
.\scripts\check-quality.ps1
```

Por paquete:

```powershell
# Backend
Set-Location backend
uv sync --frozen --all-groups
uv lock --check
uv run ruff check app tests
uv run mypy
uv run pytest

# Frontend
Set-Location ..\frontend
pnpm install --frozen-lockfile
pnpm run quality          # check + Vitest + build
pnpm run test:e2e         # Playwright (Landing, Writing, Video, Voice)
```

### Smokes live (opt-in)

Solo con autorización, credenciales y límite de coste explícitos. No van en CI ni en la suite normal:

```powershell
Set-Location backend
uv run vslingo-smoke openrouter-stt --audio .\path\to\short-sample.wav
uv run vslingo-smoke openrouter-chat
uv run vslingo-smoke aws-polly
uv run vslingo-smoke edge-tts
```

---

## Despliegue

| Pieza | Destino típico | Notas |
| --- | --- | --- |
| Frontend | Render Static Site / Vercel / Pages | Build: `pnpm install --frozen-lockfile && pnpm run build` desde `frontend/`; publicar `frontend/dist`. Definir en **build time** `PUBLIC_API_URL=https://api.tu-dominio.com` y, si aplica, `SITE_URL`. |
| Backend | VPS (Dokploy + Nixpacks recomendado) o Caddy + systemd | TLS y WSS; ver [`deploy/dokploy-nixpacks.md`](deploy/dokploy-nixpacks.md) |

Más: [`deploy/README.md`](deploy/README.md) · [`render.yaml`](render.yaml) · runbook AWS/presupuesto en [`deploy/aws-polly.md`](deploy/aws-polly.md).

---

## Documentación

| Documento | Contenido |
| --- | --- |
| [`docs/product-spec.md`](docs/product-spec.md) | Producto, alcance, contratos, arquitectura y decisiones |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Roadmap estable `T01`–`T10` |
| [`docs/progress.md`](docs/progress.md) | Estado real, evidencia y próximo paso |
| [`docs/spec/`](docs/spec/README.md) | Specs operativas de incrementos |
| [`AGENTS.md`](AGENTS.md) | Normas de trabajo para agentes LLM |
| [`frontend/README.md`](frontend/README.md) / [`backend/README.md`](backend/README.md) | Setup y comandos por paquete |
| Ruta `/presentacion` | Diapositivas oficiales (hackathon / demo) |

---

## Principios de producto (Alpha)

- Sin registro ni cuenta  
- Sin gamificación infantil  
- Voice como experiencia diferenciadora; Writing y Video pequeños y fiables  
- Presupuesto protegido (rate limits, concurrencia, sin auth)  
- Privacidad: logs solo metadatos de latencia/coste/error — nunca audio, transcripts ni prompts  
- Cada incremento integrado y demostrable (sin código huérfano)  
