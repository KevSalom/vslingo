# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-22.

## Estado actual

- **Roadmap actual:** `T02`.
- **Próximo incremento:** `T02` — Writing Studio vertical.
- **Completado:** `T01.1`–`T01.4`; bootstrap reproducible, skeleton ejecutable, puertos y fakes, smokes opt-in, validación integrada y preparación local para proveedores.
- **Pendiente:** iniciar la línea roja de los contratos tipados de Writing sin ampliar el alcance a Video, TTS o Voice. Añadir credenciales reales sólo cuando se autorice un smoke live.
- **Bloqueos:** ninguno.

`T01` quedó cerrado con frontend y backend ejecutables. La suite normal es determinista y no consume proveedores remotos o pagos.

## Evidencia disponible

- Backend: `Settings` tipado con defaults seguros, app factory, `GET /api/health` sin secretos, readiness normalizado y puertos/fakes para STT, LLM y TTS.
- Frontend: landing mínima en `/`, workspace React en `/demo` y navegación entre Voice Studio, Writing Studio y Video Lab.
- Configuración local lista: `backend/.env.example` y el `.env` ignorado local contienen placeholders vacíos y seguros para OpenRouter y AWS; los smokes live continúan sin ejecutarse.
- Frontend migrado a pnpm `10.32.0`, fijado en `package.json` con `pnpm-lock.yaml` reproducible; `package-lock.json` fue retirado. `pnpm install --frozen-lockfile` y `pnpm audit --prod` finalizaron correctamente sin vulnerabilidades conocidas.
- Backend validado con `uv lock --check`, Ruff, mypy estricto, 10 tests y un health smoke en proceso con cierre explícito.
- Los tests backend incluyen 5 casos offline de smokes para contenido útil, aislamiento, timeouts y cierre de clientes/streams sin llamar proveedores reales.
- Frontend validado con `astro check` (0 diagnósticos), 2 tests Vitest y build estático de `/` y `/demo`.
- Smokes live: CLI opt-in aislado para OpenRouter STT, OpenRouter chat streaming, AWS Polly Neural y Microsoft Edge Neural; `--help` verificado.
- Los cuatro smokes live no se ejecutaron porque requieren autorización explícita, credenciales y límites de coste; no forman parte de la suite normal.
- Riesgo conocido: FastAPI/TestClient emite un `StarletteDeprecationWarning` externo sobre la transición de `httpx` a `httpx2`; no afecta los resultados de T01.

## Estado de skills

La ubicación canónica es [`.agents/skills/`](../.agents/skills/). Están presentes:

- `frontend-design`
- `tailwind-design-system`
- `vercel-react-best-practices`
- `playwright-cli`

[`skills-lock.json`](../skills-lock.json) registra las tres primeras. `playwright-cli` todavía no aparece en el lockfile; su procedencia deberá verificarse antes de una futura actualización del lock. No se deben modificar hashes o entradas manualmente.

## Regla de actualización

Al finalizar un incremento:

1. Registrar qué incremento quedó completado y la evidencia de validación realmente ejecutada.
2. Mover **Próximo incremento** al siguiente identificador aprobado.
3. Actualizar pendientes y bloqueos sin reescribir el roadmap.
4. Indicar con precisión cualquier test, build, smoke o revisión que no se haya ejecutado.
