# VSLingo Frontend

Astro 7, React 19 and Tailwind CSS v4 frontend for the VSLingo Public Alpha.

## Requirements

- Node.js `>=22.12.0`
- pnpm `10.32.0` (pinned in `package.json`)

## Local commands

Run these commands from `frontend/`:

| Command | Action |
| :-- | :-- |
| `pnpm install --frozen-lockfile` | Install the exact locked dependencies. |
| `pnpm exec astro dev --background` | Start the managed Astro server at `http://localhost:4321`. |
| `pnpm exec astro dev status` | Check the background development server. |
| `pnpm exec astro dev logs` | Read background development logs. |
| `pnpm exec astro dev stop` | Stop the background development server. |
| `pnpm run check` | Run Astro and TypeScript diagnostics. |
| `pnpm run test` | Run the Vitest suite once. |
| `pnpm run build` | Build static assets into `dist/`. |
| `pnpm run quality` | Run check, tests, and build in sequence. |

## API configuration

Copy the public example when you need to override the backend URL:

```powershell
Copy-Item .env.example .env
```

`PUBLIC_API_URL` defaults to `http://127.0.0.1:8000` and is embedded into the
static build; it never contains provider secrets. REST clients and Voice Studio
WebSocket (`/api/voice/ws`, `ws`/`wss` derived from the same base) all read this
variable — do not hardcode a different API host. Production builds must set it
to the public HTTPS API origin (for example `https://api.example.com`) at
build time.

The static landing is available at `/`; `/demo` contains Writing Studio, Video
Lab, and Voice Studio. Hands-free VAD needs a secure context (HTTPS or
localhost) and microphone permission; PTT remains available as fallback.

## URL de sitio para producción

Antes de un build de despliegue, definir `SITE_URL` con la URL pública HTTPS final (por ejemplo, en la configuración de Render). Astro usa esta variable para construir los enlaces canonical y Open Graph. En desarrollo local se usa `http://localhost:4321` solo como origen local.
