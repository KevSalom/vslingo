# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-24.

## Estado actual

- **Roadmap actual:** `T08` completado.
- **Próximo incremento:** `T09` — Seguridad, costes y observabilidad.
- **Completado:** `T01.1`–`T01.4`, `T02`, `T03`, `T04`, `T05`, `T06`, `T07` y `T08`; base reproducible, Writing Studio, Video Lab básico/resiliente, TTS compartido, Protocolo Voice con PTT → STT, Conversación B1-B2 con Feedback Paralelo, VAD local manos libres con Audio Streaming e Interrupción (*barge-in*), y sistema visual con landing estática.
- **Pendiente:** iniciar `T09` sin alterar los flujos ya validados de Voice.
- **Bloqueos:** ninguno.

`T08` añadió tokens CSS-first, tipografías locales Sora/IBM Plex Sans/JetBrains Mono y una identidad visual centrada en la transición waveform → diff. La landing de Astro es estática, accesible y SEO-completa; el workspace ofrece navegación por módulos con estado y foco accesibles, y Voice Studio se conserva como carga diferida sin modificar sus flujos VAD/PTT/WebSocket/TTS.

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM, TTS, corrección, transcripciones y feedback.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Backend Speech (TTS): servicio `SpeechService` con selección explícita entre `aws_polly` y `edge_tts` sin fallback automático. Límite de 3000 caracteres Unicode sobre texto bruto antes del trim, validación de voz y respuesta binaria `audio/mpeg`.
- Backend Voice (WebSocket, STT, Chat Streaming, Feedback & TTS Streaming): `speech.started` cancela sólo la generación previa; `turn_id` y generación se validan juntos; escenario/proveedor se snapshottean por turno; cancelaciones obsoletas no interrumpen turnos nuevos; la conversación produce dos oraciones cortas y encola la primera para TTS mientras la segunda continúa en streaming; `TTSConsumer` acotado cancela síntesis activa, descarta resultados tardíos y entrega cada tríada de audio como una unidad al writer único.
- Frontend Voice: VAD se inicia tras `session.ready` sin pulsar PTT; misfires y fallos cancelan su generación; PTT usa “Mantén pulsado para hablar”, pausa VAD y restaura la escucha; el selector compartido persiste Polly/Edge; cambios rápidos de escenario se confirman por revisión; y begin/binario/end valida generación, longitud, IDs e índice antes de decodificar.
- Backend revalidado con Ruff global sin errores, `mypy app` estricto en verde (40 archivos) y 132 tests en `pytest` pasando; la batería T07 incluye una prueba determinista que confirma que la primera oración llega a TTS antes de finalizar el stream LLM.
- Frontend revalidado con `pnpm run quality`: Astro check con 0 errores (5 hints existentes por `ScriptProcessorNode` deprecado), 80 tests Vitest y build correcto de `/` y `/demo`; los seis assets VAD/ORT requeridos están en `dist/vad/`, el paquete VAD quedó en chunk dinámico y la landing raíz no carga JavaScript de cliente.
- T08: `pnpm install --frozen-lockfile` pasó; los contratos dirigidos de landing y workspace pasaron 4/4; `pnpm run quality` pasó con 80/80 tests; y `pnpm run audit:lighthouse` pasó sobre el build final con Performance 98, Accessibility 100 y SEO 100 (umbrales ≥90).
- Inspección del build T08: `/index.html` no contiene scripts de módulo ni referencias a Voice/VAD; `VoiceStudio` se emitió como chunk dinámico. La landing incluye `lang="es"`, canonical, Open Graph/Twitter, JSON-LD `SoftwareApplication` y favicon local.
- Revisión visual T08 con Playwright sobre servidor estático local: landing en 320, 768, 1280 y 1440 px, y workspace en 320 y 768 px sin overflow horizontal; `prefers-reduced-motion` confirmó `scroll-behavior: auto`. La cabecera Voice conserva el foco inicial en `body` y apila su acción en móvil.
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
