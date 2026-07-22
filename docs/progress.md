# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-22.

## Estado actual

- **Roadmap actual:** `T01`.
- **Próximo incremento:** `T01.2`.
- **Completado:** inspección, bootstrap, dependencias exactas y tests iniciales redactados.
- **Pendiente:** ejecutar tests rojos, implementar skeleton, contratos/smokes y validación.
- **Bloqueos:** ninguno.
- **Tests existentes todavía no ejecutados.**

`T01.1` reúne el trabajo completado descrito arriba. Esta reorganización documental no ejecutó ni inició `T01.2`.

## Evidencia disponible

- Backend: contratos iniciales redactados para configuración y health.
- Frontend: contrato inicial redactado para `DemoWorkspace` y los puntos de entrada de Voice, Writing y Video.
- La implementación del skeleton necesaria para satisfacer esos contratos todavía no forma parte del estado completado.
- No se han ejecutado tests de frontend/backend, builds, servidores ni APIs live durante esta reorganización.

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
