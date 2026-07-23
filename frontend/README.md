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
| `pnpm run dev` | Start the local Astro development server at `http://localhost:4321`. |
| `pnpm run check` | Run Astro and TypeScript diagnostics. |
| `pnpm run test` | Run the Vitest suite once. |
| `pnpm run build` | Build static assets into `dist/`. |
| `pnpm run quality` | Run check, tests, and build in sequence. |

The static landing is available at `/`; the interactive T01 workspace is at
`/demo`. T02 will add the Writing Studio vertical without changing the package
manager or lockfile workflow.
