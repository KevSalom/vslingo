# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-24.

## Estado actual

- **Roadmap actual:** `T09` completado.
- **Próximo incremento:** `T10` — Integración y despliegue.
- **Completado:** `T01.1`–`T01.4`, `T02`, `T03`, `T04`, `T05`, `T06`, `T07`, `T08` y `T09`; base reproducible, Writing Studio, Video Lab básico/resiliente, TTS compartido, Protocolo Voice con PTT → STT, Conversación B1-B2 con Feedback Paralelo, VAD local manos libres con Audio Streaming e Interrupción (*barge-in*), sistema visual con landing estática, y seguridad, costes y observabilidad.
- **Pendiente:** iniciar `T10` para integración y despliegue final.
- **Bloqueos:** ninguno.

`T09` aplicó protecciones operativas, límites de rate limit e IP, semáforos de proveedores, restricciones de CORS y origen WebSocket 403 antes de accept, headers de seguridad HTTP, control de sesión/turnos de Voice, observabilidad limpia sin canarios ni contenido sensible, y la integración de métricas de sesión (latencias STT/tokens/audio y coste acumulado/estimado) en la interfaz del cliente, respaldado por el runbook de presupuesto en `deploy/aws-polly.md`.

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM, TTS, corrección, transcripciones y feedback.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Backend Speech (TTS): servicio `SpeechService` con selección explícita entre `aws_polly` y `edge_tts` sin fallback automático. Límite de 3000 caracteres Unicode sobre texto bruto antes del trim, validación de voz y respuesta binaria `audio/mpeg`.
- Backend Voice (WebSocket, STT, Chat Streaming, Feedback & TTS Streaming): `speech.started` cancela sólo la generación previa; `turn_id` y generación se validan juntos; escenario/proveedor se snapshottean por turno; cancelaciones obsoletas no interrumpen turnos nuevos; la conversación produce dos oraciones cortas y encola la primera para TTS mientras la segunda continúa en streaming; `TTSConsumer` acotado cancela síntesis activa, descarta resultados tardíos y entrega cada tríada de audio como una unidad al writer único.
- Frontend Voice: VAD se inicia tras `session.ready` sin pulsar PTT; misfires y fallos cancelan su generación; PTT usa “Mantén pulsado para hablar”, pausa VAD y restaura la escucha; el selector compartido persiste Polly/Edge; cambios rápidos de escenario se confirman por revisión; y begin/binario/end valida generación, longitud, IDs e índice antes de decodificar.
- Revalidación completa T09 Backend: Ruff sin errores (`ruff check app tests`), `mypy app` estricto en verde (43 archivos) y 138 tests pasados en `pytest` (incluyendo la suite completa de protecciones T09).
- Revalidación completa T09 Frontend: `pnpm run quality` completado con 0 errores de Astro check, 84 tests de Vitest pasados y build estático de `/` y `/demo` limpio.
- `git diff --check` pasado sin advertencias de formato.
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
