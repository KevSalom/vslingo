# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-26.

## Estado actual

- **Roadmap actual:** `T10` completado (Alpha 1.0 lista).
- **Próximo incremento:** Despliegue en producción autorizado (Dokploy en VPS para backend y Render/Vercel/Pages para frontend).
- **Completado:** `T01`–`T10` completos; base reproducible, Writing Studio, Video Lab básico/resiliente, TTS compartido, Protocolo Voice con PTT → STT, Conversación B1-B2 con Feedback Paralelo, VAD local manos libres con Audio Streaming e Interrupción (*barge-in*), sistema visual con landing estática, seguridad, costes y observabilidad, e integración con pruebas E2E deterministas y guías de despliegue en Dokploy con Nixpacks.
- **Pendiente:** despliegue real en producción VPS/PaaS.
- **Bloqueos:** ninguno.
- **Polish post-T10 (2026-07-24):** Video Lab — biblioteca y notas en explorer tree estilo VS Code; notas agnósticas del video (`title` + `text` + `timestamp?`, storage v2); área de estudio limpia; modales Guardar video/nota; hover copiar/guardar frase en vista línea; drawer Explorer en móvil.
- **Bugfix post-T10 (2026-07-26):** Audio Waveform Amplitude (`.kiro/specs/audio-waveform-amplitude`) — medidor visual calibrado (`audioLevel.ts`) con supresión de ruido de fondo, normalización de voz útil, curva perceptual de raíz cuadrada y suavizado con factores de ataque/liberación independientes; integrado en `onFrameLevel` de `vadClient.ts`.
- **Polish post-T10 (2026-07-27):** Voice Studio UI — se quitó «Iniciar Sesión»; botón circular on/off en `control.voice` (Iniciar / Activo / Pausar); estado de entrada destacado en el header; escenarios como `<select>` al estilo del proveedor TTS; sin badge «en espera» en `conversation.stream`.
- **Bugfix post-T10 (2026-07-27):** Voice WebSocket dejaba URL hardcodeada `ws://localhost:8000/api/voice/ws`; ahora deriva de `PUBLIC_API_URL` igual que REST (`resolveVoiceWebSocketUrl`). Documentado en `.env.example`, `frontend/README.md` y `deploy/README.md`.

`T10` introdujo la suite E2E determinista con Playwright (`@playwright/test` 1.50.1) cubriendo Landing, Writing Studio, Video Lab y Voice Studio; los archivos de despliegue `render.yaml` (Render Static Site), `deploy/Caddyfile.example`, `deploy/vslingo-api.service.example`, `backend/nixpacks.toml` y la guía paso a paso [`deploy/dokploy-nixpacks.md`](../deploy/dokploy-nixpacks.md) para Dokploy en VPS; y el script raíz unificado de calidad [`scripts/check-quality.ps1`](../scripts/check-quality.ps1).

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM, TTS, corrección, transcripciones y feedback.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Backend Speech (TTS): servicio `SpeechService` con selección explícita entre `aws_polly` y `edge_tts` sin fallback automático. Límite de 3000 caracteres Unicode sobre texto bruto antes del trim, validación de voz y respuesta binaria `audio/mpeg`.
- Backend Voice (WebSocket, STT, Chat Streaming, Feedback & TTS Streaming): `speech.started` cancela sólo la generación previa; `turn_id` y generación se validan juntos; escenario/proveedor se snapshottean por turno; cancelaciones obsoletas no interrumpen turnos nuevos; la conversación produce dos oraciones cortas y encola la primera para TTS mientras la segunda continúa en streaming; `TTSConsumer` acotado cancela síntesis activa, descarta resultados tardíos y entrega cada tríada de audio como una unidad al writer único.
- Frontend Voice: VAD se inicia tras `session.ready` sin pulsar PTT; misfires y fallos cancelan su generación; PTT usa “Mantén pulsado para hablar”, pausa VAD y restaura la escucha; el selector compartido persiste Polly/Edge; cambios rápidos de escenario se confirman por revisión; begin/binario/end valida generación, longitud, IDs e índice antes de decodificar; y `onFrameLevel` entrega amplitudes perceptibles, suavizadas y proporcionales transformadas por `createAmplitudeMeter`.
- Revalidación completa T09 Backend: Ruff sin errores (`ruff check app tests`), `mypy app` estricto en verde (43 archivos) y 138 tests pasados en `pytest` (incluyendo la suite completa de protecciones T09).
- Revalidación completa T10 Frontend & E2E: `pnpm run quality` completado con 0 errores de Astro check, 118 tests de Vitest pasados en verde (incluyendo `audioLevel.test.ts`, `vadClient.test.ts` y `VoiceStudio.test.tsx`), y build estático limpio.
- Polish Video Lab UI & Bugfix Audio Amplitude: `pnpm run quality` en frontend con 0 errores de check, **118** tests Vitest pasados y build estático limpio. Suites dirigidas: `audioLevel` (PBT propiedad 1 voz perceptible, propiedad 2 silencio/estabilidad rampa, límites y clamps), `vadClient` (emisión de nivel visual calibrado), `VoiceStudio` (actualización de transform de barras).
- Guías de despliegue listas: Dokploy en VPS con Nixpacks ([`deploy/dokploy-nixpacks.md`](../deploy/dokploy-nixpacks.md)), Caddy/systemd ([`deploy/Caddyfile.example`](../deploy/Caddyfile.example)) y Render ([`render.yaml`](../render.yaml)).
- No se realizó prueba manual de micrófono en Chrome/Edge desde este entorno CLI; sigue pendiente como validación manual y no fue sustituida por los tests.
- No se ejecutaron llamadas live a OpenRouter Chat/Feedback o TTS proveedores reales: la suite utiliza `FakeLanguageModel`, `FakeVoiceFeedback` y fakes/mocks deterministas.
- Los smokes live de STT, chat streaming, feedback, Polly y Edge continúan sin ejecutarse.

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
