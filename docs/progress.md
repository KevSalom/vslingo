# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-23.

## Estado actual

- **Roadmap actual:** `T07` completado.
- **Próximo incremento:** `T08` — Sistema visual y landing.
- **Completado:** `T01.1`–`T01.4`, `T02`, `T03`, `T04`, `T05`, `T06` y `T07`; base reproducible, Writing Studio, Video Lab básico/resiliente, TTS compartido, Protocolo Voice con PTT → STT, Conversación B1-B2 con Feedback Paralelo, y VAD local manos libres con Audio Streaming e Interrupción (Barge-in).
- **Pendiente:** iniciar la línea roja de `T08` (rediseño visual masivo y landing) sin adelantar observabilidad (`T09`).
- **Bloqueos:** ninguno.

`T07` fue re-auditado y corregido contra su spec: VAD local manos libres usando `@ricky0123/vad-web` y Silero ONNX servido desde `/public/vad/` sin CDN; PTT real por pulsación sostenida con exclusión mutua del VAD; selector persistente AWS Polly/Microsoft Edge; cambios deterministas de escenario/proveedor; generaciones y callbacks obsoletos descartados; acumulador determinista de oraciones; `TTSConsumer` cancelable con backpressure y enmarcado atómico `audio.begin` -> binario MP3 -> `audio.end`; y `AudioScheduler` ordenado que invalida decodificaciones tardías tras *barge-in*.

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM, TTS, corrección, transcripciones y feedback.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Backend Speech (TTS): servicio `SpeechService` con selección explícita entre `aws_polly` y `edge_tts` sin fallback automático. Límite de 3000 caracteres Unicode sobre texto bruto antes del trim, validación de voz y respuesta binaria `audio/mpeg`.
- Backend Voice (WebSocket, STT, Chat Streaming, Feedback & TTS Streaming): `speech.started` cancela sólo la generación previa; `turn_id` y generación se validan juntos; escenario/proveedor se snapshottean por turno; cancelaciones obsoletas no interrumpen turnos nuevos; la conversación produce dos oraciones cortas y encola la primera para TTS mientras la segunda continúa en streaming; `TTSConsumer` acotado cancela síntesis activa, descarta resultados tardíos y entrega cada tríada de audio como una unidad al writer único.
- Frontend Voice: VAD se inicia tras `session.ready` sin pulsar PTT; misfires y fallos cancelan su generación; PTT usa “Mantén pulsado para hablar”, pausa VAD y restaura la escucha; el selector compartido persiste Polly/Edge; cambios rápidos de escenario se confirman por revisión; y begin/binario/end valida generación, longitud, IDs e índice antes de decodificar.
- Backend revalidado con Ruff global sin errores, `mypy app` estricto en verde (40 archivos) y 132 tests en `pytest` pasando; la batería T07 incluye una prueba determinista que confirma que la primera oración llega a TTS antes de finalizar el stream LLM.
- Frontend revalidado con `pnpm run quality`: Astro check con 0 errores (5 hints por `ScriptProcessorNode` deprecado), 78 tests Vitest y build correcto de `/` y `/demo`; los seis assets VAD/ORT requeridos están en `dist/vad/`, el paquete VAD quedó en chunk dinámico y la landing raíz no carga JavaScript. La batería Voice dirigida pasó 25 tests, incluido cleanup de PTT durante cambio de configuración y waveform local con `prefers-reduced-motion`.
- Línea roja del re-audit: VoiceStudio falló 4 de 5 pruebas dirigidas (PTT por clic, selector ausente y cancelación incompleta) y backend rechazó TTS de la generación recién aceptada; las mismas pruebas quedaron verdes tras el ajuste.
- `git diff --check` pasó limpiamente sin advertencias de formato.
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
