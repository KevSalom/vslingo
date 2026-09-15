# Inglés al Grano

**Ya sabes inglés. Ahora practícalo.**

Aplicación web para jóvenes adultos hispanohablantes con nivel intermedio. Permite
hablar a su ritmo, mejorar textos y entrenar el oído con videos, con explicaciones
en español y sin cursos, rachas ni gamificación.

El desarrollo activo sigue el [plan del MVP comercial](docs/commercial-mvp-plan.md).
La Alpha VSLingo T01–T10 se conserva como contexto histórico en
[docs/product-spec.md](docs/product-spec.md) y [docs/spec](docs/spec/README.md).
El estado verificable está en [docs/progress.md](docs/progress.md).

## Módulos

| Módulo | Recorrido actual |
|---|---|
| **Hablar** | Tema libre por defecto, push-to-talk, respuesta corta, mejora prioritaria e historial que se puede continuar |
| **Escribir** | Texto de hasta 1.000 caracteres, corrección estructurada, diff e historial automático |
| **Videos** | Video, transcripción sincronizada, biblioteca sencilla y notas versionadas |

La landing está en `/`. Las rutas estables de práctica son `/app`,
`/app/hablar`, `/app/escribir` y `/app/videos`. `/demo` permanece como alias
temporal para enlaces históricos. Las operaciones de proveedores ya requieren
sesión autenticada; el modo fake se limita al desarrollo y las pruebas.

## Oferta aprobada

Un plan mensual de **US$2,99** y una prueba por cuenta verificada sin tarjeta.
Los límites mensuales iniciales son 60 minutos de audio enviado por el alumno,
hasta 180 intervenciones, 100 correcciones y 20 videos nuevos con transcripción.
La configuración transaccional de planes y cuotas se implementa en F4.

## Arquitectura

| Área | Tecnología |
|---|---|
| Frontend | Astro 7, React 19, TypeScript, Tailwind CSS v4 |
| Backend | FastAPI, Pydantic, Python 3.12+, uv |
| LLM | OpenRouter `google/gemini-3.1-flash-lite` |
| STT | OpenRouter `openai/whisper-large-v3-turbo` |
| TTS | Edge TTS con cuatro voces permitidas; `speechSynthesis` como respaldo |
| Datos e identidad | SQLite transaccional + Clerk; contenido y preferencias aislados por cuenta |

Las pruebas normales usan fakes y no llaman servicios externos. No se guardan
buffers WAV o MP3 en disco, base de datos, service worker ni logs.

## Desarrollo local

Requisitos: Python 3.12+, [uv](https://docs.astral.sh/uv/), Node.js 22.12+ y
pnpm 10.32.0.

Backend:

```powershell
cd backend
uv sync --frozen --all-groups
uv run vslingo-api
```

Frontend, en otra terminal:

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm run dev
```

Variables públicas y de servidor están documentadas en
[backend/.env.example](backend/.env.example) y
[frontend/.env.example](frontend/.env.example). Dejar credenciales vacías hasta
que una prueba live sea autorizada expresamente.

## Calidad

Desde la raíz:

```powershell
pwsh -File scripts/check-quality.ps1
```

Por paquete:

```powershell
cd backend
uv lock --check
uv run ruff check app tests
uv run mypy
uv run pytest

cd ../frontend
pnpm run check
pnpm run test
pnpm run build
pnpm run test:e2e
```

Los smokes live están separados de pytest y nunca se ejecutan por defecto:

```powershell
cd backend
uv run vslingo-smoke openrouter-stt --audio .\path\to\short-sample.wav
uv run vslingo-smoke openrouter-chat
uv run vslingo-smoke edge-tts
```

## Despliegue

Las guías están en [deploy/README.md](deploy/README.md). El entorno actual sigue
usando fakes por defecto y no autoriza compras ni llamadas live. El lanzamiento
comercial requiere completar los gates F4–F7 del plan.
