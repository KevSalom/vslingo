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
static build; it never contains provider secrets.

The static landing is available at `/`; `/demo` contains the interactive
workspace and the functional Writing Studio vertical. Voice Studio and Video
Lab remain placeholders until their roadmap increments.
