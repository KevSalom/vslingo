# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-23.

## Estado actual

- **Roadmap actual:** `T04` completado.
- **Próximo incremento:** `T05` — Protocolo Voice y PTT → STT.
- **Completado:** `T01.1`–`T01.4`, `T02`, `T03` y `T04`; base reproducible, Writing Studio, Video Lab básico/resiliente y TTS compartido con AWS Polly y Edge TTS.
- **Pendiente:** iniciar la línea roja de `T05` sin adelantar conversación, VAD, sistema visual ni protección operativa.
- **Bloqueos:** ninguno.

`T04` quedó cerrado con la capacidad de síntesis compartida mediante `POST /api/speech`, adaptadores AWS Polly Neural y Microsoft Edge Neural, selector de proveedor en Writing Studio con persistencia `vslingo:speech` y controlador de audio cancelable.

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM, TTS, corrección y transcripciones.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Backend Speech (TTS): servicio `SpeechService` con selección explícita entre `aws_polly` y `edge_tts` sin fallback automático. Límite de 3000 caracteres Unicode sobre texto bruto antes del trim, validación de voz y respuesta binaria `audio/mpeg` con cabeceras `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.
- Adaptador AWS Polly: motor `neural`, formato `mp3`, 24 kHz y gestión de timeouts de lectura/conexión. Liberación limpia de `AudioStream` y mapeo de excepciones botocore sin filtrar secretos ni diagnósticos privados.
- Adaptador Edge TTS: comunicación asíncrona mediante `edge_tts.Communicate`, recolección de audio MP3 en memoria, timeout y soporte de cancelación asíncrona real.
- Frontend Speech: módulo compartido `frontend/src/shared/speech/` con cliente HTTP `synthesizeSpeech` (con `AbortSignal`), almacenamiento versionado `vslingo:speech`, selector `SpeechProviderControl` y hook `useSpeechPlayer` que gestiona reproducción, interrupción, cleanup y revocación de Object URLs.
- Integración Writing: selector de proveedor de voz y botón "Escuchar"/"Detener" integrados junto a `corrected_text`. Descarte de reproducciones obsoletas y detención automática de audio al limpiar o reenviar borradores.
- Backend validado con `uv sync --frozen --all-groups`, `uv lock --check`, Ruff global sin advertencias, `mypy` estricto en verde y 92 tests en `pytest`.
- Frontend validado con instalación congelada, `astro check` (0 errores, 0 warnings, 0 hints), 53 tests Vitest en verde y `pnpm run build` correcto de `/` y `/demo`.
- `git diff --check` pasó limpiamente y sin archivos ni lógica fuera de `T04`.
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
