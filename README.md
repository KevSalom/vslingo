# VSLingo Public Alpha

> **The Code-Editor Interface for Mastering Developer English.**

VSLingo es una plataforma de práctica de inglés para desarrolladores hispanohablantes. Su filosofía es **«al grano, sin ruido»**: práctica profesional, directa y sin mecánicas de gamificación infantil.

## Estado

**Public Alpha / Hackathon Preview.** Esta denominación describe la etapa del proyecto y su objetivo de demostración; no implica que todos los módulos descritos a continuación ya estén implementados. La fuente de verdad sobre el avance real es [`docs/progress.md`](docs/progress.md).

## Audiencia y propuesta

VSLingo está dirigido a desarrolladores hispanohablantes que quieren practicar comunicación profesional en inglés de nivel B1-B2. La interfaz y las explicaciones se plantean en español, con una experiencia sobria inspirada en herramientas de desarrollo, sin convertirla en una copia literal de VS Code.

La Alpha se organiza alrededor de tres módulos objetivo:

- **Voice Studio:** conversación por voz en tiempo real, escenarios profesionales, feedback, VAD e interrupción del asistente.
- **Writing Studio:** corrección estructurada con diff, explicaciones y reproducción mediante síntesis de voz.
- **Video Lab:** vídeos de YouTube con transcripción sincronizada, navegación y notas locales.

## Stack resumido

- **Frontend:** Astro, React 19 y Tailwind CSS v4; landing estática y workspace en `/demo`, desplegados en Render.
- **Backend:** FastAPI sobre Python 3.11+ en un VPS propio; API REST y WebSocket con orquestación asíncrona.
- **Proveedores:** OpenRouter para Whisper y LLM, AWS Polly Neural y Microsoft Edge Neural para TTS, y `youtube-transcript-api` para subtítulos.
- **Estado local:** `localStorage` versionado; sin autenticación ni base de datos en el alcance de la Alpha.

## Validación local

Los comandos reproducibles de la base son:

```powershell
# Backend
Set-Location backend
uv sync --frozen --all-groups
uv lock --check
uv run ruff check app tests
uv run mypy
uv run pytest

# Frontend (desde la raíz del repositorio)
Set-Location ..\frontend
pnpm install --frozen-lockfile
pnpm run quality
```

Los smoke tests live se ejecutan por proveedor y sólo de forma opt-in; consulta
[`backend/README.md`](backend/README.md). No forman parte de las suites normales.

## Documentación

- [Especificación de producto y decisiones técnicas](docs/product-spec.md)
- [Plan de implementación](docs/implementation-plan.md)
- [Estado y progreso](docs/progress.md)
- [Guía para agentes](AGENTS.md)
