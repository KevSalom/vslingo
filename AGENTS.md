# Instrucciones para agentes

Este archivo rige el trabajo de Kiro, Antigravity y otros agentes LLM en todo el repositorio VSLingo. El historial de chat no es una fuente de verdad.

## Orden de lectura

Antes de cambiar código o documentación:

1. Leer [`README.md`](README.md) para comprender el producto y navegar el repositorio.
2. Leer [`docs/product-spec.md`](docs/product-spec.md) para conocer alcance, arquitectura, contratos y decisiones aprobadas.
3. Leer [`docs/implementation-plan.md`](docs/implementation-plan.md) para identificar la secuencia estable `T01`–`T10` y los límites del incremento.
4. Leer [`docs/progress.md`](docs/progress.md) para conocer el estado real, el próximo incremento y las validaciones pendientes.
5. Si el incremento activo está entre `T04` y `T10`, leer su especificación operativa exacta en [`docs/spec/`](docs/spec/README.md). No usar la spec de un incremento posterior como autorización para adelantar trabajo.
6. Inspeccionar el código y las pruebas relevantes; no asumir que la estructura objetivo ya está implementada.
7. Leer la skill canónica aplicable antes de diseñar, implementar React/Tailwind o preparar E2E.

## Fuentes de verdad

| Tema | Fuente |
| --- | --- |
| Presentación y navegación | [`README.md`](README.md) |
| Alcance, arquitectura, contratos y decisiones | [`docs/product-spec.md`](docs/product-spec.md) |
| Roadmap estable `T01`–`T10` | [`docs/implementation-plan.md`](docs/implementation-plan.md) |
| Estado actual, próximo incremento, bloqueos y evidencia | [`docs/progress.md`](docs/progress.md) |
| Ejecución detallada del incremento activo `T04`–`T10` | [`docs/spec/`](docs/spec/README.md) y la spec enlazada allí |
| Forma de trabajar de agentes | [`AGENTS.md`](AGENTS.md) |

Las specs de `docs/spec/` son instrucciones operativas derivadas: cierran payloads, secuencias, pruebas y criterios de aceptación sin reemplazar las tres fuentes superiores. Si una spec no coincide con `product-spec.md`, `implementation-plan.md`, `progress.md` o con el estado real del árbol, no elegir una interpretación ni adaptar el producto silenciosamente: detenerse, citar la contradicción y pedir una decisión. No convertir observaciones del árbol actual en nuevas decisiones de producto.

## Un solo incremento cada vez

- Confirmar en `progress.md` cuál es el próximo incremento antes de trabajar.
- Ejecutar sólo ese incremento o el subconjunto explícitamente solicitado por el usuario.
- No adelantar trabajo de identificadores posteriores ni añadir mejoras “aprovechando” un cambio.
- Un encargo exclusivamente documental no autoriza a comenzar el siguiente incremento de implementación.
- Mantener cada incremento integrado, demostrable y sin código huérfano.
- Al finalizar, actualizar `progress.md` con resultado, evidencia real, siguiente incremento, pendientes y bloqueos.

## Ciclo red-green-refactor

1. **Red:** ejecutar primero las pruebas o contratos dirigidos y confirmar que fallan por la razón esperada. Si todavía deben redactarse pruebas, limitarse al comportamiento aprobado.
2. **Green:** implementar el mínimo cambio útil que satisfaga el contrato, sin ampliar alcance.
3. **Refactor:** mejorar estructura y nombres sólo con la cobertura relevante en verde.
4. **Validar:** repetir las pruebas dirigidas y las comprobaciones aplicables antes de declarar terminado el incremento.

No afirmar que una prueba estaba roja o verde si no se ejecutó. Registrar explícitamente en `progress.md` cualquier validación omitida.

## Validaciones obligatorias

Aplicar sólo las comprobaciones relevantes al cambio, pero completar todas las que correspondan:

- Pruebas unitarias o de integración dirigidas al comportamiento modificado.
- Lint y comprobación de tipos del paquete afectado.
- Build no interactivo cuando cambie código de entrega o configuración de empaquetado.
- E2E determinista para recorridos de usuario afectados cuando el harness ya exista; la introducción y consolidación inicial de Playwright pertenece a `T10`, que debe cubrir retrospectivamente los tres recorridos con red y proveedores falsos.
- `git diff --check` y revisión de que el diff no excede el incremento.
- Para cambios sólo documentales: enlaces/rutas, reglas de ignore cuando proceda y `git diff --check`; no ejecutar suites de aplicación sin una razón específica.

No iniciar manualmente servidores persistentes, watchers ni procesos interactivos como parte de la validación automatizada. Se permiten servidores efímeros no interactivos iniciados y detenidos por el propio comando de prueba —por ejemplo `astro preview` bajo LHCI o `webServer` de Playwright—; el comando debe garantizar cleanup incluso al fallar. No usar el éxito de un comando irrelevante como evidencia del criterio de aceptación.

## Proveedores y pruebas live

- La suite normal debe usar puertos/adaptadores falsos y nunca consumir APIs pagas.
- STT, LLM, Polly, Edge, YouTube y cualquier otro smoke live son **opt-in**.
- No ejecutar pruebas live por defecto. Requieren solicitud o autorización explícita, credenciales preparadas y límites de coste conocidos.
- Nunca enviar código, secretos, audio, transcripts ni datos del usuario a servicios externos para diagnosticar o validar.

## Dependencias y lockfiles

- Usar versiones exactas; no introducir rangos abiertos.
- Añadir una dependencia sólo cuando el incremento aprobado la necesite.
- Actualizar mediante el gestor correspondiente y conservar el lockfile reproducible; no editar hashes o entradas de lock manualmente.
- No cambiar dependencias o lockfiles como efecto lateral de una tarea documental.
- Revisar nombres y procedencia para evitar paquetes erróneos o typosquatting.

## Límites de alcance

La Alpha no incluye:

- autenticación o Clerk;
- base de datos o historial sincronizado entre dispositivos;
- pagos, Stripe, billing o pricing definitivo;
- funciones avanzadas no incluidas en el incremento activo;
- Redis, múltiples workers o escalado horizontal;
- certificación de Safari o móviles.

No implementar estas áreas ni agregar funcionalidades no solicitadas. Mantener `localStorage` versionado para el estado local aprobado y respetar las restricciones de privacidad y seguridad de la especificación.

## Skills canónicas

La única ubicación canónica para las skills del proyecto es [`.agents/skills/`](.agents/skills/), que debe permanecer versionable. No duplicar su contenido dentro de estas instrucciones.

Leer explícitamente la ruta aplicable:

- Diseño y dirección visual: [`.agents/skills/frontend-design/SKILL.md`](.agents/skills/frontend-design/SKILL.md).
- Tailwind y sistema de diseño: [`.agents/skills/tailwind-design-system/SKILL.md`](.agents/skills/tailwind-design-system/SKILL.md).
- React y rendimiento: [`.agents/skills/vercel-react-best-practices/SKILL.md`](.agents/skills/vercel-react-best-practices/SKILL.md).
- E2E: [`.agents/skills/playwright-cli/SKILL.md`](.agents/skills/playwright-cli/SKILL.md).

Kiro debe abrir estas rutas cuando correspondan. Antigravity debe usar la misma copia canónica. Antes de una futura actualización de `skills-lock.json`, comprobar en `progress.md` el estado de procedencia de skills no bloqueadas y verificar su origen; nunca inventar ni editar hashes a mano.

## Git y entrega

- No ejecutar `git add`, commit, push, reset, checkout destructivo ni alterar staging sin autorización explícita.
- Preservar cambios existentes del usuario y distinguirlos de los realizados por el agente.
- No modificar frontend, backend, dependencias, skills o lockfiles cuando la solicitud esté limitada a documentación.
- Antes del handoff, enumerar archivos modificados, validaciones realizadas, validaciones no realizadas y el próximo incremento indicado en `progress.md`.
- Nunca crear un commit por iniciativa propia.
