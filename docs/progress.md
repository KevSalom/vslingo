# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-23.

## Estado actual

- **Roadmap actual:** `T03` completado.
- **Próximo incremento:** `T04` — TTS compartido.
- **Completado:** `T01.1`–`T01.4`, `T02` y `T03`; base reproducible, Writing Studio y Video Lab básico y resiliente.
- **Pendiente:** iniciar la línea roja de `T04` sin adelantar Voice, sistema visual ni protección operativa.
- **Bloqueos:** ninguno.

`T03` quedó cerrado con el recorrido de Video Lab integrado en `/demo`, proveedor aislado y una demostración local que conserva reproducción simulada, sincronización, seek, vistas, biblioteca y notas sin depender de YouTube.

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM, TTS, corrección y transcripciones.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Resiliencia Writing: los terminadores `LF`/`CRLF` se eliminan sólo al final, después de validar el tamaño bruto y antes de llamar al proveedor; los saltos internos permanecen intactos. Hay un máximo de dos intentos sólo ante `INVALID_RESPONSE` o un `original_text` inconsistente; timeouts y demás errores no se reintentan. El diagnóstico registra únicamente proveedor/código, intento, clase de causa y `type`/`loc` de Pydantic, nunca texto, respuesta cruda, mensajes de excepción ni secretos.
- OpenRouter Writing: adaptador asíncrono no streaming con JSON Schema estricto, todas las propiedades requeridas, dos pares few-shot `user`/`assistant`, `temperature=0`, `max_tokens=1000`, limpieza acotada de fences Markdown, timeout y clasificación segura de errores 400/401/403/429/5xx.
- Backend Video: parser separado que acepta únicamente URLs explícitas de hosts YouTube aprobados (`watch`, `youtu.be`, `shorts`, `live` y `embed`), rechaza hosts lookalike e IDs desnudos, y delega en `TranscriptProviderPort` mediante `VideoService`.
- Contrato Video: `POST /api/video/transcript` devuelve `video_id`, `source` y segmentos inmutables `{text,start,duration}` ordenados; URL inválida, captions ausentes, bloqueo, timeout, indisponibilidad y respuesta inválida usan envelopes públicos tipados sin diagnóstico privado.
- Proveedor YouTube: `youtube-transcript-api==1.2.4` fijado en lockfile; prefiere captions ingleses manuales, después ingleses autogenerados y, si no existen, traduce la primera pista traducible. La API síncrona se desplaza a un thread con timeout acotado, sin proxy residencial ni fallback silencioso.
- Resiliencia YouTube: los resultados correctos usan una caché TTL-LRU acotada a 300 segundos y 32 entradas por defecto. Hay un máximo de dos intentos sólo para timeout o indisponibilidad; bloqueos, captions ausentes, respuestas inválidas y demás fallos permanentes no se reintentan ni se almacenan en caché.
- Frontend Video: cliente HTTP validado en runtime, IFrame API nativa sin dependencia adicional, player responsive, estados de carga/error, transcripción navegable, vistas párrafo/línea y autoscroll del segmento activo.
- Concurrencia Video: cada carga recibe `AbortSignal`, una nueva selección cancela la anterior y una generación latest-wins impide que respuestas obsoletas sobrescriban el estado; el desmontaje y la apertura del fixture abortan la solicitud activa.
- Sincronización Video: polling único cada 200 ms sólo durante reproducción; coincidencia estricta en `[start, start + duration)`, fallback al último segmento iniciado para cubrir huecos y actualización inmediata al hacer seek. El cleanup detiene el timer y destruye el player.
- Demo resiliente: `frontend/src/features/video/fixture.ts` incorpora un recorrido técnico para `aircAruvnKk`; `FixturePlayer` aporta un reloj y controles locales sin cargar YouTube, y conserva navegación, vistas, biblioteca y notas cuando falla la red o el proveedor.
- Estado local: claves versionadas `vslingo:writing` y `vslingo:video`; Video persiste hasta 50 elementos de biblioteca y 500 notas con timestamp, además de la preferencia de vista. Incluye migración v0→v1 y tolera datos corruptos, almacenamiento lleno o acceso bloqueado.
- Integración: el workspace React de `/demo` monta Writing Studio y Video Lab; Voice Studio permanece como placeholder hasta su incremento.
- Backend validado con instalación congelada, `uv lock --check`, Ruff global, mypy estricto y 80 tests. La cobertura global de `app` es 85.52%; el adaptador `youtube_transcript` alcanza 94%.
- Frontend validado con instalación congelada, `astro check` (0 errores, warnings o hints), 46 tests Vitest y build estático correcto de `/` y `/demo`.
- `git diff --check` pasó y la revisión de alcance no encontró trabajo de `T04` ni de incrementos posteriores.
- No se ejecutó un E2E de navegador porque la consolidación Playwright pertenece a `T10`; los recorridos de componentes usan player, red y proveedores simulados.
- No se ejecutó una llamada live a YouTube: la selección inglés→traducción, caché, reintentos, clasificación de bloqueos y fallback se verificaron con clientes deterministas. El fixture local cubre la demostración estable exigida por `T03`.
- Las comprobaciones live autorizadas de OpenRouter de `T02` devolvieron correcciones conformes al contrato. El caso exacto con una dirección de email ficticia fue válido tanto en llamada directa como mediante `POST /api/writing/correct`; la recuperación de la intermitencia se verificó con un proveedor scripted para no provocar consumo remoto adicional. Los smokes live de STT, chat genérico, Polly y Edge continúan sin ejecutarse.
- Riesgo conocido de Video: `youtube-transcript-api` consume una API no documentada y YouTube puede bloquear IPs de VPS; el producto usa errores accionables y fixture local, no proxies residenciales.
- Riesgo conocido general: FastAPI/TestClient emite un `StarletteDeprecationWarning` externo sobre la transición de `httpx` a `httpx2`; no afecta los resultados.

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
