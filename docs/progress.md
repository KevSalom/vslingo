# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan estable](implementation-plan.md) · [Especificación](product-spec.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-07-23.

## Estado actual

- **Roadmap actual:** `T05` completado.
- **Próximo incremento:** `T06` — Conversación y Feedback.
- **Completado:** `T01.1`–`T01.4`, `T02`, `T03`, `T04` y `T05`; base reproducible, Writing Studio, Video Lab básico/resiliente, TTS compartido y Protocolo Voice con PTT → STT.
- **Pendiente:** iniciar la línea roja de `T06` sin adelantar VAD, sistema visual ni protección operativa.
- **Bloqueos:** ninguno.

`T05` quedó cerrado con el protocolo WebSocket v1 bidireccional en `/api/voice/ws`, fixture de contrato `docs/contracts/voice-protocol-v1.json`, gestión de sesiones autoritativas con actor model y OutboundWriter en `VoiceSession`, validación estricta de WAV PCM mono 16 kHz, adaptador OpenRouter Whisper STT con fakes deterministas, y componente frontend `VoiceStudio` con captura PCM, remuestreador a 16 kHz y Push-To-Talk.

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM, TTS, corrección y transcripciones.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Backend Speech (TTS): servicio `SpeechService` con selección explícita entre `aws_polly` y `edge_tts` sin fallback automático. Límite de 3000 caracteres Unicode sobre texto bruto antes del trim, validación de voz y respuesta binaria `audio/mpeg` con cabeceras `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.
- Backend Voice (WebSocket & STT): endpoint `WS /api/voice/ws`, modelos Pydantic inmutables en `app/domain/voice_protocol.py`, validación de cabeceras WAV 16kHz mono 16-bit, `VoiceSession` con `TaskGroup` y cola de salida acotada (capacidad 32), adaptador `OpenRouterSpeechToTextProvider` e integración en `main.py`.
- Frontend Voice: cliente `VoiceSocketClient`, parser estricto de eventos v1, módulos de captura `audioCapture.ts` con remuestreador PCM a 16 kHz y codificador WAV, y componente `VoiceStudio.tsx` con Push-To-Talk (soporte para mouse/pointer y espacio/enter).
- Contratos: `docs/contracts/voice-protocol-v1.json` validado bidireccionalmente por Pydantic y TypeScript.
- Backend validado con `uv sync --frozen --all-groups`, Ruff global sin advertencias (0 errores), `mypy app` estricto en verde (33 archivos sin errores) y 104 tests en `pytest` pasando.
- Frontend validado con `npx astro check` (0 errores), Vitest en verde (61 tests pasando) y `npm run build` correcto de `/` y `/demo`.
- `git diff --check` pasó limpiamente.
- No se ejecutó una llamada live a OpenRouter STT: la suite usa `FakeSpeechToText` y mocks de HTTP.
- Los smokes live de STT, chat genérico, Polly y Edge continúan sin ejecutarse.

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
