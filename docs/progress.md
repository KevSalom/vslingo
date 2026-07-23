# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-22.

## Estado actual

- **Roadmap actual:** `T03`.
- **Próximo incremento:** `T03` — Video Lab básico y resiliente.
- **Completado:** `T01.1`–`T01.4` y `T02`; base reproducible, límites de proveedores y vertical completo de Writing Studio.
- **Pendiente:** iniciar la línea roja del parser de URL y del proveedor de transcripciones de `T03`, sin adelantar TTS o Voice. Añadir credenciales reales sólo para recorridos live expresamente autorizados.
- **Bloqueos:** ninguno.

`T02` quedó cerrado con corrección estructurada integrada entre FastAPI y React. La suite normal usa proveedores falsos o transporte HTTP simulado y no consume APIs remotas o pagas.

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM y TTS.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Resiliencia Writing: los terminadores `LF`/`CRLF` se eliminan sólo al final, después de validar el tamaño bruto y antes de llamar al proveedor; los saltos internos permanecen intactos. Hay un máximo de dos intentos sólo ante `INVALID_RESPONSE` o un `original_text` inconsistente; timeouts y demás errores no se reintentan. El diagnóstico registra únicamente proveedor/código, intento, clase de causa y `type`/`loc` de Pydantic, nunca texto, respuesta cruda, mensajes de excepción ni secretos.
- OpenRouter Writing: adaptador asíncrono no streaming con JSON Schema estricto, todas las propiedades requeridas, dos pares few-shot `user`/`assistant`, `temperature=0`, `max_tokens=1000`, limpieza acotada de fences Markdown, timeout y clasificación segura de errores 400/401/403/429/5xx.
- Frontend Writing: editor accesible, contador y atajo de teclado, estados de carga/error, texto corregido, diff por gramática/ortografía/puntuación/estilo, feedback, copiar y limpiar.
- Estado local: clave `vslingo:writing` versionada, migración v0→v1, restauración de borrador/resultado y tolerancia a datos corruptos o acceso bloqueado a `localStorage`.
- Integración: el workspace React de `/demo` monta Writing Studio; el cliente valida la respuesta en runtime y consume la URL pública configurable del backend.
- Backend validado con `uv lock --check`, Ruff, mypy estricto y 36 tests. La cobertura dirigida de dominio y servicio Writing fue 90.91%, por encima del objetivo de 85%.
- Frontend validado con `astro check` (0 diagnósticos), 15 tests Vitest y build estático correcto de `/` y `/demo`.
- Revisión semántica final aprobada sin bloqueantes ni hallazgos de severidad alta o media; `git diff --check` también pasó.
- No se ejecutó un E2E de navegador porque el proyecto aún no tiene configuración Playwright y la consolidación E2E pertenece a `T10`; el recorrido de componente usa red/proveedor simulados.
- Las comprobaciones live autorizadas de OpenRouter devolvieron correcciones conformes al contrato. El caso exacto con una dirección de email ficticia fue válido tanto en llamada directa como mediante `POST /api/writing/correct`; la recuperación de la intermitencia se verificó con un proveedor scripted para no provocar consumo remoto adicional. Los smokes live de STT, chat genérico, Polly y Edge continúan sin ejecutarse.
- Riesgo conocido: FastAPI/TestClient emite un `StarletteDeprecationWarning` externo sobre la transición de `httpx` a `httpx2`; no afecta los resultados de `T02`.

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
