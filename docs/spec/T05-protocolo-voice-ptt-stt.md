# `T05` — Protocolo Voice y PTT → STT

[Índice](README.md) · [Producto](../product-spec.md) · [Plan](../implementation-plan.md) · [Estado](../progress.md)

## 1. Objetivo y condición de entrada

Construir la primera ruta Voice determinista: abrir una sesión WebSocket, capturar un único segmento con push-to-talk (PTT), enviarlo como WAV mono PCM 16-bit a 16 kHz y recibir `transcript.final`. Debe haber aislamiento por conexión, backpressure, protocolo tipado y cleanup completo.

Sólo comenzar si `progress.md` marca `T05` y `T04` está cerrado. TTS HTTP debe seguir verde, pero T05 no sintetiza respuesta conversacional.

## 2. Alcance y no alcance

### Incluido

- Contrato WebSocket v1 compartido mediante fixture JSON.
- `VoiceSession`, turnos, generaciones, colas acotadas y writer único.
- Endpoint `WS /api/voice/ws`; la validación de `Origin` se implementa exclusivamente en `T09`.
- Adaptador productivo OpenRouter Whisper detrás de `SpeechToTextPort`.
- Captura PTT, remuestreo/encoding WAV y UI mínima de Voice.
- Errores de protocolo, timeout, cola llena, orden, desconexión y cleanup.

### Prohibido en T05

- LLM, prompts, historial, feedback o respuesta streaming (`T06`).
- VAD, TTS conversacional, scheduler, waveform o barge-in completo (`T07`).
- Validación de `Origin`, rediseño global, rate limiting global o métricas de coste (`T08`–`T09`).
- Audio WebM, MP3 de entrada o múltiples frames por utterance.

## 3. Contrato WebSocket v1

### 3.1 Reglas de transporte

- URL: `/api/voice/ws`.
- Texto = un objeto JSON UTF-8. Arrays, texto no JSON, campos extra o tipos incorrectos son inválidos.
- Binario = exclusivamente el frame inmediatamente posterior a un `utterance.begin` aceptado.
- Una utterance contiene exactamente un frame binario; no se aceptan eventos de texto entre begin y frame.
- Audio exacto: WAV RIFF, PCM lineal signed 16-bit little-endian, 1 canal, 16 000 Hz.
- Duración declarada: 100–60 000 ms. Tamaño máximo: **2 000 044 bytes**. `byte_length` debe coincidir con el frame.
- `turn_id`: UUID v4 generado por cliente. No se reutiliza en la sesión.
- La generación es autoritativa del servidor. `session.ready` informa `generation: 0`; cada `speech.started` propone exactamente `generation_actual + 1`. El servidor valida el valor y, en una operación atómica, incrementa su generación a ese número y vuelve obsoletas todas las menores. Reusar o saltar un número produce `invalid_generation` sin cambiar la generación vigente.
- Eventos de turno contienen `turn_id` y `generation`; eventos de sesión sólo contienen generación donde esta spec lo declara.
- Tras un error `fatal: true`, el servidor envía el error y cierra con código 1008. Errores no fatales dejan la sesión utilizable.

### 3.2 Cliente → servidor

```json
{"type":"session.start","protocol_version":1}
{"type":"session.config","scenario":"daily_standup","speech_provider":"aws_polly"}
{"type":"speech.started","turn_id":"UUID","generation":1}
{"type":"utterance.begin","turn_id":"UUID","generation":1,"media_type":"audio/wav","byte_length":32044,"duration_ms":1000}
```

Después de `utterance.begin`, se envía un único frame binario. También existen:

```json
{"type":"response.cancel","turn_id":"UUID","generation":1}
{"type":"session.end"}
```

En T05, `session.config` sólo valida y conserva `scenario` (`daily_standup`, `system_design`, `salary_negotiation`, `free`) y `speech_provider` (`aws_polly`, `edge_tts`) para estabilizar el protocolo; no ejecuta LLM/TTS. `session.start` debe ser el primer evento y sólo puede ocurrir una vez. `session.config` puede enviarse tras `session.ready` y entre turnos, nunca entre begin/frame.

`speech.started` vuelve obsoleta cualquier generación menor y prepara el turno. `response.cancel` es idempotente para una generación conocida; no cierra sesión.

### 3.3 Servidor → cliente

```json
{"type":"session.ready","protocol_version":1,"session_id":"UUID","generation":0}
{"type":"session.configured","scenario":"daily_standup","speech_provider":"aws_polly","config_revision":1}
{"type":"transcript.final","turn_id":"UUID","generation":1,"text":"I deployed the API.","duration_seconds":1.0}
{"type":"response.cancelled","turn_id":"UUID","generation":1}
{"type":"error","code":"invalid_audio","message":"El audio no es válido.","retryable":false,"fatal":false,"turn_id":"UUID","generation":1}
```

`session.configured` confirma la aplicación de `session.config`; el servidor incrementa `config_revision` desde 1 y devuelve los valores efectivos. La config sólo se acepta cuando no hay begin pendiente ni generación con STT/conversación/feedback/TTS activa; en caso contrario devuelve `invalid_event` no fatal y conserva la anterior. En T05, el turno queda inactivo al emitir `transcript.final` o su error/cancelación final; T06 amplía esta definición hasta que conversación y feedback terminen o se cancelen.

`turn_id` y `generation` son `null`/ausentes sólo cuando el error no pertenece a un turno. Códigos v1 cerrados:

| Código | Uso | retryable | fatal |
| --- | --- | --- | --- |
| `invalid_event` | JSON/schema/orden de evento | false | según si se perdió framing |
| `invalid_generation` | generation reutilizada o distinta de actual+1 | false | false |
| `unsupported_protocol` | versión distinta de 1 | false | true |
| `invalid_audio` | WAV/formato/longitud incoherente | false | false |
| `audio_too_large` | supera límite | false | false |
| `turn_timeout` | no llega frame o STT excede timeout | true | false |
| `queue_full` | no hay capacidad | true | false |
| `provider_not_configured` | falta OpenRouter | false | false |
| `provider_unavailable` | fallo STT transitorio | true | false |
| `invalid_provider_response` | transcript vacío/inválido | true | false |
| `internal_error` | fallo no clasificado sin detalle privado | true | true |

No enviar traceback, excepción, audio, credenciales ni respuesta cruda.

### 3.4 Fixture contractual

Crear `docs/contracts/voice-protocol-v1.json` con ejemplos válidos para **cada tipo** de evento, más `protocol_version: 1`. Backend y frontend deben cargar ese mismo fixture en tests y validar sus uniones discriminadas; no mantener copias divergentes. El fixture no contiene audio ni datos personales.

## 4. Backend

### 4.1 `VoiceSession`

Una instancia por WebSocket, sin estado mutable global. Debe poseer:

- `session_id` UUID generado por servidor;
- generación actual, turn IDs vistos y config;
- `utterance_queue` con capacidad 2;
- cola de salida con capacidad 32;
- un `TaskGroup` con reader, `STTConsumer` y único outbound writer;
- máximo un begin pendiente, con timeout de 5 s para recibir binario.

El reader es el único que llama `receive`; el writer es el único que llama `send_json`/`send_bytes`. En T05 el writer sólo envía JSON, pero la regla queda fijada para T07. La cola llena se rechaza sin bloquear indefinidamente. Al desconectar, `session.end`, error fatal o cancelación: cancelar tareas, vaciar/rechazar pendientes, cerrar recursos y salir del TaskGroup sin tareas huérfanas.

Validar el WAV en backend (RIFF/WAVE, chunk `fmt ` PCM=1, mono, 16 kHz, 16 bit, chunk `data` coherente). No confiar sólo en metadata del cliente. No escribirlo en disco.

### 4.2 OpenRouter STT

Implementar el adaptador productivo usado por `SpeechToTextPort`:

- `POST {OPENROUTER_BASE_URL}/audio/transcriptions` multipart con archivo `utterance.wav`, modelo configurado y bytes en memoria;
- cliente HTTP asíncrono, timeout acotado y cleanup;
- aceptar sólo texto no vacío; normalizar opcionalmente `usage.seconds` y `usage.cost` en `Transcription`;
- no fallback automático de Turbo a V3;
- aplicar esta matriz sin exponer body ni mensaje privado:

| Causa OpenRouter/STT | Código de protocolo | retryable | fatal |
| --- | --- | --- | --- |
| key/modelo ausente o HTTP 401/403 | `provider_not_configured` | false | false |
| HTTP 400 tras validación WAV local | `invalid_audio` | false | false |
| HTTP 429, 5xx o error de transporte | `provider_unavailable` | true | false |
| timeout total | `turn_timeout` | true | false |
| JSON malformado, texto vacío o usage inválido | `invalid_provider_response` | true | false |
| cancelación de tarea/generación | sin `error`; cleanup y, si aplica, `response.cancelled` | — | — |

- cancelación se propaga y cierra request/cliente.

La app factory recibe el puerto/servicio por inyección para tests. Health no exige credenciales.

## 5. Frontend PTT mínimo

Crear `frontend/src/features/voice/` con separaciones equivalentes a:

- `protocol.ts`: uniones, guardas y parser estricto;
- `voiceSocket.ts`: estado de conexión y transporte inyectable;
- `audioCapture.ts`/worker local: captura PCM, remuestreo a 16 kHz y encoder WAV;
- `VoiceStudio.tsx`: UI y máquina de estados explícita;
- tests unitarios por responsabilidad.

Máquina mínima: `idle → connecting → ready → recording → transcribing → ready`, más `error` y `closed`. No derivar estados incompatibles de varios booleanos.

UI en español:

- botón “Conectar Voice Studio”;
- control PTT accesible “Mantén pulsado para hablar”; soporta pointer y teclado (`Space`/`Enter`), y siempre libera captura en pointer cancel/blur;
- estado de conexión/grabación/transcripción con `aria-live`;
- transcript final visible;
- acción reconectar tras cierre/error.

Al iniciar captura: solicitar micrófono sólo por gesto del usuario, generar `turn_id`, calcular exactamente `generation_actual + 1` desde el último estado aceptado y enviarlo en `speech.started`; el servidor sigue siendo la autoridad y un `invalid_generation` cancela localmente esa captura sin enviar begin/binario. Al soltar: detener tracks/nodos, obtener un solo WAV, enviar begin y después frame. Si tras `speech.started` la captura queda vacía, dura menos de 100 ms, se cancela por UI o falla el encoding, enviar `response.cancel` para ese turn/generation, no enviar begin/binario y esperar un único `response.cancelled` antes de considerar la generación inactiva. Al desmontar/cambiar módulo: detener tracks y AudioContext, cancelar captura/generación activa, enviar `session.end` si es posible y cerrar socket.

El encoder debe tener pruebas byte a byte del header WAV y del remuestreo con muestras sintéticas; JSDOM no usa micrófono real.

## 6. Línea roja y orden de implementación

Escribir primero tests que fallen por ausencia de:

1. parsing de todas las variantes y rechazo de campos extra;
2. orden start/ready/config/configured/speech/begin/binary y rechazo de config durante un turno activo;
3. incremento exacto de generación, rechazo de reuso/salto y transcript final con fake STT;
4. aislamiento de dos conexiones con mismos números de generación;
5. frame tardío, doble frame, tamaño, WAV inválido, timeout y cola llena;
6. captura vacía/corta, cancelación UI y fallo de encoding envían `response.cancel`, reciben un solo `response.cancelled` y dejan la generación inactiva;
7. desconexión durante recepción y STT sin tareas pendientes;
8. adapter OpenRouter con multipart/modelo/usage y clasificación de errores;
9. fixture v1 consumido por Python y TypeScript;
10. encoder 16 kHz mono WAV y cleanup de PTT;
11. UI de conectar, grabar, transcript y reconectar.

Implementar después en orden: contrato/fixture → dominio de sesión → endpoint con fake → STT productivo → cliente socket → encoder/captura → UI integrada. No crear prompts ni eventos `assistant.*` funcionales.

## 7. Archivos previstos

- `docs/contracts/voice-protocol-v1.json`.
- `backend/app/domain/voice.py`, `app/voice/session.py`, `messages.py`, `stt.py`.
- `backend/app/providers/openrouter_stt.py`, `app/api/voice.py`, composición en `main.py`.
- `backend/tests/test_voice_protocol.py`, `test_voice_session.py`, `test_openrouter_stt.py`.
- `frontend/src/features/voice/*` y tests.
- `frontend/public/` sólo para el AudioWorklet propio imprescindible; assets Silero pertenecen a T07.
- `DemoWorkspace.tsx`: sustituir placeholder por Voice Studio mínimo, sin rediseñarlo.

Las rutas pueden ajustarse a una estructura equivalente, pero protocolo, límites y responsabilidades no.

## 8. Criterios de aceptación

- [ ] Fixture único valida todas las uniones Pydantic/TypeScript.
- [ ] Un PTT genera WAV válido y termina en un único `transcript.final` correcto.
- [ ] Dos sesiones no comparten generación, colas, historial ni cancelación.
- [ ] Sólo el writer escribe al socket y todas las colas están acotadas.
- [ ] Orden, tamaño, timeout, cola llena y audio inválido producen códigos estables.
- [ ] Desconectar en cada etapa deja cero tareas y cierra micrófono/AudioContext/socket.
- [ ] Suite normal usa fakes; no llama a OpenRouter.
- [ ] No hay LLM, feedback, VAD o TTS conversacional adelantado.

## 9. Validación y handoff

Ejecutar backend completo y frontend `quality` según README, además de tests dirigidos durante red/green. Ejecutar `git diff --check`. No realizar smoke STT live salvo autorización explícita; si se autoriza, usar un WAV corto sin datos sensibles y registrar coste/resultado sin transcript.

Actualizar `progress.md` con evidencia real, omisiones y riesgos. Sólo entonces señalar `T06` como próximo incremento.
