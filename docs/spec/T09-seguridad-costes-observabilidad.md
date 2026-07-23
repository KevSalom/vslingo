# `T09` — Seguridad, costes y observabilidad

[Índice](README.md) · [Producto](../product-spec.md) · [Plan](../implementation-plan.md) · [Estado](../progress.md)

## 1. Objetivo y entrada

Proteger la Alpha antes de exponerla: secretos sólo backend, orígenes explícitos, recursos acotados, errores seguros, telemetría sin contenido y presupuesto observable. Las protecciones no deben romper fakes, health ni cancelación de Voice.

Entrada: `T08` cerrado y `progress.md` en `T09`. Este incremento endurece recorridos existentes; no agrega funciones de aprendizaje.

## 2. Modelo de amenaza acotado

Proteger contra:

- orígenes web no autorizados y payloads malformados;
- abuso accidental/básico de endpoints costosos sin autenticación;
- conexiones/sesiones eternas, colas o concurrencia sin límite;
- exposición de claves, audio, transcripts, prompts, respuestas o excepciones en logs/errores;
- gasto sin visibilidad y fallos de proveedor no normalizados.

No prometer defensa DDoS de red, cuentas por usuario, WAF, Redis ni escalado horizontal. Los límites son en memoria y por proceso, coherentes con un único worker Alpha.

## 3. Configuración tipada y defaults

Añadir a `Settings` y `.env.example`, con validación positiva y topes razonables:

```dotenv
FRONTEND_ORIGIN=http://localhost:4321
MAX_HTTP_REQUESTS_PER_MINUTE=30
MAX_SPEECH_REQUESTS_PER_MINUTE=10
MAX_WS_CONNECTIONS=20
MAX_WS_CONNECTIONS_PER_IP=2
MAX_VOICE_SESSION_SECONDS=900
MAX_VOICE_TURNS=30
MAX_AUDIO_SECONDS=60
MAX_AUDIO_BYTES=2000044
MAX_CONCURRENT_STT=4
MAX_CONCURRENT_LLM=8
MAX_CONCURRENT_TTS=4
MAX_CONCURRENT_VIDEO=4
POLLY_USD_PER_MILLION_CHARS=16
```

Los límites de protocolo de T04/T05 no aumentan si env permite más: usar el menor entre límite contractual y operativo. Los tests pueden inyectar valores pequeños. No leer env dentro de servicios; inyectar settings/limiters.

`FRONTEND_ORIGIN` es un único origen completo `scheme://host[:port]`, sin path, query, fragment, wildcard ni lista separada por comas. Producción debe usar `https`; localhost puede usar `http` en development/test.

## 4. CORS, WebSocket y headers

HTTP:

- `allow_origins` exactamente origen normalizado;
- credentials false;
- métodos `GET, POST, OPTIONS` y headers necesarios (`Content-Type`) únicamente;
- no `*` en producción.

WebSocket: validar header `Origin` **antes** de `accept`. Si está ausente o no coincide, llamar `close()` antes de aceptar para que Starlette deniegue el handshake con HTTP 403; no esperar un close frame 1008 porque la conexión nunca se estableció. No iniciar sesión, tareas ni proveedores. Comparar esquema/host/puerto normalizados, no prefijos de string.

Añadir middleware/headers sobre respuestas API sin interferir con Astro/Caddy:

- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- `Cache-Control: no-store` en Writing, Speech, Video y handshake/error HTTP sensible; health puede ser `no-store`;
- no añadir CSP al API JSON/binario; la CSP del frontend se define/documenta en T10/Caddy según assets reales.

## 5. Rate limiting y concurrencia

### 5.1 Identidad

Limiter en memoria con reloj inyectable. Clave por IP de conexión. No confiar en `X-Forwarded-For` en app durante T09; T10 configurará Uvicorn para confiar sólo en loopback Caddy. Tests verifican que un header forjado no cambia identidad.

### 5.2 Ventanas

Algoritmo token bucket o sliding window determinista que cumpla:

- global HTTP costoso: 30/min/IP entre Writing, Video y Speech;
- Speech además 10/min/IP;
- apertura WS: consume del global y respeta máximo 2 activas/IP y 20 globales;
- rechazos HTTP: `429`, envelope común, `code="rate_limited"`, `retryable=true`, header entero `Retry-After`;
- exceso de conexión antes de accept: denegación de handshake HTTP 403, sin sesión/tareas;
- una sesión abierta que intenta superar 30 utterances recibe `error` fatal `turn_limit_reached` y cierre 1008. El timeout de 900 s recibe `error` fatal `session_limit_reached` y cierre 1008. Código 1000 queda reservado para `session.end` normal.

Liberar siempre contadores de conexión en disconnect/error/cancelación. Limpiar buckets inactivos para que el mapa no crezca indefinidamente.

### 5.3 Semáforos

Semáforos globales inyectados por app para STT, LLM (chat+feedback), TTS y Video con defaults indicados. Adquirir con timeout corto configurable/no mayor al timeout del proveedor; nunca encolar infinitamente. Saturación en HTTP devuelve `503` con envelope común `{ "error": { "code": "provider_busy", "message": string en español, "retryable": true } }`. Saturación durante Voice emite `error` no fatal `provider_busy` con `turn_id`/`generation` y `retryable=true`; conversación y feedback conservan su independencia. Añadir `provider_busy` a enums/uniones y `voice-protocol-v1.json`, y probar ambos transportes. Liberar todo semáforo en `finally`, incluida cancelación.

Conservar colas por sesión acotadas de T05/T07. No reemplazarlas por semáforos ni viceversa.

## 6. Sesión Voice

Aplicar de forma autoritativa:

- 900 s desde `session.ready`;
- 30 utterances aceptadas;
- audio <=60 s y <=2 000 044 bytes;
- timeout begin→binario de 5 s y provider timeout existente;
- queues 2 utterances, 8 TTS, 32 outbound, sin crecimiento;
- un máximo de una generación activa por sesión.

Al límite de tiempo o turnos: cancelar la generación, emitir respectivamente `session_limit_reached` o `turn_limit_reached` con `fatal=true`, limpiar y cerrar 1008. `session.end` solicitado por el cliente realiza cleanup y cierre normal 1000. No aceptar otro frame mientras cierra.

## 7. Reintentos y errores

Auditar todos los adaptadores. Regla común:

- máximo dos intentos sólo cuando la operación es segura/idempotente y no se emitió resultado parcial;
- retry únicamente timeout/indisponibilidad transitoria aprobada por el adaptador;
- no retry en 400/401/403, payload inválido, cancelación, bloqueo YouTube, captions ausentes o stream LLM tras primer delta;
- backoff corto cancelable, sin `sleep` bloqueante y sin exceder timeout total;
- no fallback de proveedor/modelo.

No cambiar políticas específicas ya probadas de Writing/Video salvo para hacerlas más acotadas de acuerdo con esta regla. Los errores públicos usan códigos estables; desconocidos se vuelven mensaje genérico, nunca `str(exc)`.

## 8. Logging y telemetría

Usar logging estructurado con allowlist de campos. Evento mínimo:

```json
{
  "event":"voice_stage_completed",
  "session_id":"opaque-id",
  "turn_id":"opaque-id",
  "generation":2,
  "stage":"stt_final",
  "latency_ms":842,
  "provider":"openrouter",
  "error_code":null,
  "usage_seconds":3.2,
  "usage_tokens":null,
  "cost_usd":0.00004
}
```

Allowlist: event, IDs opacos, generación, etapa, latencia, provider, error_code, status code, conteos/segundos/tokens, cost_usd. Prohibido: audio/bytes/base64, transcript, texto Writing, captions/notas, prompts, respuesta LLM/TTS, URLs con query, credenciales, headers auth, raw body, traceback o mensajes de excepción en logs operativos.

Un test instala handler capturador, ejecuta éxito/error con canarios secretos y verifica que no aparecen. En development, traceback puede existir sólo en salida de test explícita, no en logger de request/provider ni respuesta pública.

Hitos Voice cerrados: `speech_end`, `stt_final`, `llm_first_token`, `llm_done`, `feedback_done`, `tts_first_byte`, `playback_started`, `turn_cancelled`.

Extender `voice-protocol-v1.json` y las uniones Pydantic/TypeScript con estos contratos exactos:

```json
{"type":"playback.started","turn_id":"UUID","generation":2,"segment_id":"UUID"}
{"type":"metrics.stage","turn_id":"UUID","generation":2,"stage":"stt_final","latency_ms":842,"provider":"openrouter","usage_seconds":3.2,"usage_tokens":null,"cost_usd":0.00004,"estimated":false}
```

Reglas normativas:

- `playback.started` es cliente→servidor, referencia el primer `audio.begin` de la generación y se acepta exactamente una vez cuando empieza reproducción real; ID desconocido, duplicado o generación obsoleta produce `invalid_event` no fatal y no altera métricas.
- `metrics.stage` es servidor→cliente. `stage` pertenece al enum cerrado anterior; `turn_id`/`generation` siempre identifican el turno. `latency_ms` es entero 0–3 600 000. `provider` es `openrouter`, `aws_polly`, `edge_tts` o `null`. `usage_seconds` y `cost_usd` son números finitos >=0 o `null`; `usage_tokens` es entero >=0 o `null`; `estimated` es boolean y sólo puede ser true cuando `cost_usd` es una estimación.
- Para `playback_started`, el servidor mide al recibir la confirmación con su reloj monotónico; el cliente no envía tiempos. Los demás hitos se miden en backend. `turn_cancelled` no exige usage/cost.
- Ningún evento contiene texto, audio, prompts o mensajes de error privados. Tests Python y TypeScript deben leer el fixture actualizado y rechazar campos extra, enums y números fuera de rango.

Todas las latencias son acumuladas desde `t0`, definido como el instante monotónico en que el servidor termina de recibir y validar el frame WAV del turno. No reportar duración aislada de etapa bajo `latency_ms`.

| `stage` | Instante final usado para `latency_ms = final - t0` |
| --- | --- |
| `speech_end` | `t0`; valor 0 |
| `stt_final` | transcript STT válido disponible |
| `llm_first_token` | primer delta conversacional válido disponible |
| `llm_done` | `assistant.done` construido |
| `feedback_done` | feedback válido o fallo independiente definitivo |
| `tts_first_byte` | primer MP3 válido de la generación disponible |
| `playback_started` | servidor recibe el único `playback.started` válido |
| `turn_cancelled` | cleanup de la generación cancelada termina |

Usar `time.monotonic()` para `t0` y finales, y UTC sólo para timestamp de log. Tests con reloj fake fijan cada instante y verifican los milisegundos acumulados.

## 9. Costes y panel

Fuente:

- OpenRouter STT: `usage.seconds`/`usage.cost` reportados son autoritativos.
- OpenRouter LLM/feedback: usage/cost reportado cuando exista; si no, `cost_usd=null`, no inventar.
- Polly: estimación `len(text)` facturable × `POLLY_USD_PER_MILLION_CHARS / 1_000_000`; marcar `estimated=true`.
- Edge: `cost_usd=null` y `estimated=false`; no afirmar gratuito.
- YouTube no se suma a coste de sesión Voice.

Acumular métricas sólo en memoria de `VoiceSession`. Eventos `metrics.stage` al cliente contienen etapa, latency_ms, usage y cost nullable, `estimated`; nunca contenido. Panel inferior muestra latencias STT/primer token/primer audio y coste acumulado conocido con etiqueta “estimado” cuando corresponda. Al terminar/recargar se pierde; no usar localStorage.

No tratar objetivos 1.5 s/2.5 s como SLA. Mostrar observaciones, no promesas.

## 10. Presupuesto externo

Documentar en `deploy/aws-polly.md` o runbook equivalente:

- IAM mínimo aprobado, identidad no-root y región;
- pasos para crear alerta AWS Budget y valor elegido por el propietario;
- cómo verificar sin revelar account ID/credenciales;
- límite monetario OpenRouter configurado en su panel.

Crear/modificar presupuesto o límite remoto es una acción financiera/infra de alto impacto: el agente debe pedir confirmación explícita y valor antes de ejecutarla. Sin autorización, entregar pasos y registrar “no configurado/verificado”, nunca fingir evidencia.

## 11. Línea roja

Cubrir antes:

1. preflight/headers CORS para el origen configurado y denegación HTTP 403 del handshake WS antes de accept;
2. payload/tamaño/límites de sesión;
3. rate limits, `Retry-After`, aislamiento IP y cleanup de buckets/conexiones;
4. saturación/liberación de cada semáforo, incluida cancelación;
5. queues no crecen;
6. matriz de retries por adaptador;
7. canarios no aparecen en logs/respuestas;
8. latencias con reloj fake y coste reportado/estimado/null;
9. `metrics.stage` y panel, sin persistencia;
10. health sin secretos y app sin credenciales.

Evitar sleeps reales: reloj y limiters inyectables.

## 12. Aceptación y validación

- [ ] CORS permite al navegador sólo el origen configurado y los handshakes WebSocket de otros orígenes se deniegan con HTTP 403. Un cliente HTTP directo sin `Origin` sigue sujeto a rate limits; CORS no se presenta como autenticación/autorización.
- [ ] Límite/rate/concurrencia producen errores tipados y liberan recursos.
- [ ] Sesiones, turnos, audio y colas están acotados.
- [ ] Logs y errores no contienen ningún contenido/sensible canario.
- [ ] Métricas/costes distinguen reportado, estimado y desconocido.
- [ ] Panel muestra resumen de sesión sin persistirlo.
- [ ] Presupuesto/IAM están documentados; acciones remotas sólo con autorización.
- [ ] Todos los recorridos T02–T08 siguen verdes con fakes.

Ejecutar suites completas, cobertura backend >=85%, quality/build frontend y `git diff --check`. Añadir pruebas de carga unitarias pequeñas, no bombardear servicios ni usar live providers. Actualizar `progress.md`; `T10` sólo pasa a próximo si las protecciones están demostradas.
