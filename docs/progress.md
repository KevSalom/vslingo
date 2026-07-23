# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-23.

## Estado actual

- **Roadmap actual:** `T06` completado.
- **Próximo incremento:** `T07` — VAD, audio e interrupción.
- **Completado:** `T01.1`–`T01.4`, `T02`, `T03`, `T04`, `T05` y `T06`; base reproducible, Writing Studio, Video Lab básico/resiliente, TTS compartido, Protocolo Voice con PTT → STT y Conversación B1-B2 con Feedback Paralelo.
- **Pendiente:** iniciar la línea roja de `T07` sin adelantar el rediseño visual masivo (`T08`) ni observabilidad (`T09`).
- **Bloqueos:** ninguno.

`T06` quedó cerrado con los 4 escenarios B1-B2 (`daily_standup`, `system_design`, `salary_negotiation`, `free`), historial por sesión acotado a 6 pares / 12k caracteres con mutación atómica, adaptación streaming `OpenRouterChatLanguageModel` y estructurada `OpenRouterVoiceFeedbackProvider`, protocolo WebSocket v1 extendido con `assistant.delta`, `assistant.done` y `feedback.ready`, y componente frontend `VoiceStudio` con streaming de respuesta, tarjetas de feedback (resumen, correcciones con diffs y vocabulario) y selector de escenarios con persistencia local `vslingo:voice`.

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM, TTS, corrección, transcripciones y feedback.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Backend Speech (TTS): servicio `SpeechService` con selección explícita entre `aws_polly` y `edge_tts` sin fallback automático. Límite de 3000 caracteres Unicode sobre texto bruto antes del trim, validación de voz y respuesta binaria `audio/mpeg`.
- Backend Voice (WebSocket, STT, Chat Streaming & Feedback): endpoint `WS /api/voice/ws`, extensión de `voice_protocol.py` y `feedback.py`, `ConversationHistory` atómico, adaptadores `OpenRouterChatLanguageModel` y `OpenRouterVoiceFeedbackProvider`, tareas hermanas concurrentes en `VoiceSession` con descarte por generación y códigos de error no fatales (`feedback_unavailable`, `conversation_unavailable`).
- Frontend Voice: cliente `VoiceSocketClient`, parser de eventos v1 extendido, reducer/preferencias `voiceState.ts` (`vslingo:voice`), y componente `VoiceStudio.tsx` con selector de escenarios, respuesta streaming con `aria-live="polite"`, tarjetas de feedback y Push-To-Talk no bloqueante.
- Contratos: `docs/contracts/voice-protocol-v1.json` extendido y validado bidireccionalmente por Pydantic y TypeScript.
- Backend validado con `uv sync --frozen --all-groups`, Ruff global sin advertencias (0 errores), `mypy app` estricto en verde (38 archivos sin errores) y 117 tests en `pytest` pasando.
- Frontend validado con `npx astro check` (0 errores), Vitest en verde (66 tests pasando) y `npm run build` correcto de `/` y `/demo`.
- `git diff --check` pasó limpiamente sin advertencias de formato.
- No se ejecutaron llamadas live a OpenRouter Chat/Feedback: la suite utiliza `FakeLanguageModel`, `FakeVoiceFeedback` y fakes/mocks deterministas.
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
