# `T07` — VAD, audio e interrupción

[Índice](README.md) · [Producto](../product-spec.md) · [Plan](../implementation-plan.md) · [Estado](../progress.md)

## 1. Objetivo y entrada

Completar Voice Studio manos libres: detectar voz localmente, detener al asistente de inmediato, enviar la utterance, sintetizar la respuesta por oraciones y reproducir segmentos en orden. Ningún audio o feedback de una generación cancelada puede oírse o reaparecer.

Entrada obligatoria: `T06` cerrado y `progress.md` en `T07`. Los contratos T04–T06 deben seguir verdes.

## 2. Alcance

- `@ricky0123/vad-web` y Silero cargados dinámicamente sólo al abrir Voice.
- Assets ONNX, WASM y AudioWorklet servidos por el propio frontend.
- PTT conservado como fallback y control manual.
- Acumulador de oraciones y consumidor TTS backend.
- Eventos binarios de audio y writer único.
- Scheduler Web Audio ordenado, cancelable y generation-aware.
- Barge-in durante STT, LLM, feedback, TTS o playback.
- Waveform funcional y estados accesibles.

### No alcance

- Evaluación fonética/pronunciación, grabaciones guardadas o reproducción de la voz del usuario.
- Rediseño total/landing (`T08`), límites públicos/telemetría económica (`T09`) o E2E/despliegue (`T10`).
- Streaming de audio parcial dentro de una llamada TTS: cada oración produce un MP3 completo.

## 3. Dependencia y assets VAD

Añadir `@ricky0123/vad-web` sólo en este incremento, con versión exacta mediante pnpm; revisar nombre/procedencia antes de instalar y conservar lockfile reproducible. No usar CDN.

Copiar al build desde el paquete, sin editar binarios:

- modelo Silero bajo `/vad/silero_vad_v5.onnx`;
- worklet de VAD bajo `/vad/vad.worklet.bundle.min.js`;
- los ficheros ONNX Runtime WASM requeridos bajo `/vad/` conservando los nombres que la versión fijada solicita.

Configurar `baseAssetPath: "/vad/"` y `onnxWASMBasePath: "/vad/"`. Añadir una prueba/build check que extraiga los nombres esperados de la versión instalada y confirme que cada URL existe en `dist/vad`; no “corregir” nombres adivinando si cambia el paquete.

El módulo que importa `@ricky0123/vad-web` debe estar detrás de `import()` ejecutado al activar Voice, nunca en el bundle inicial de landing ni de Writing/Video.

## 4. Comportamiento de captura

### 4.1 Estados

Extender la máquina Voice con subestado de entrada:

- `initializing_vad`, `vad_ready`, `listening`, `speech`, `encoding`, `fallback_ptt`, `permission_denied`, `input_error`.

Sólo una captura usa el micrófono. VAD y PTT comparten el encoder WAV de T05 y no pueden producir dos utterances simultáneas.

### 4.2 VAD

- Inicialización sólo tras gesto del usuario y sesión WebSocket ready.
- `onSpeechStart`: crear turn UUID, solicitar la próxima generación al estado de sesión, **parar audio local sin await**, limpiar scheduler y enviar `speech.started`.
- `onSpeechEnd`: aceptar audio si dura 100–60 000 ms, codificar WAV 16 kHz mono y enviar begin+binario.
- Si después de `speech.started` el segmento es menor de 100 ms, queda vacío, el usuario lo cancela o falla el encoding: enviar `response.cancel`, no enviar begin/binario y mantener la generación no disponible para config/nuevo turno hasta recibir su único `response.cancelled`.
- Al cambiar módulo, desconectar o terminar sesión: cancelar primero cualquier generación/captura activa, pausar/destruir VAD, detener tracks y cerrar nodos/contextos propios.

Si permisos se deniegan, assets faltan, WASM/ONNX falla o VAD no inicializa: mostrar causa accionable y habilitar `fallback_ptt`. No cerrar la sesión ni ocultar PTT. No cambiar silenciosamente a captura continua.

PTT permanece visible como “Mantén pulsado para hablar” y puede usarse aunque VAD funcione; al activarlo se pausa VAD hasta completar/cancelar ese segmento.

## 5. Backend: texto a oraciones y TTS

### 5.1 Acumulador determinista

Crear una función/clase pura por generación. Recibe `assistant.delta` y produce cero o más segmentos. Reglas exactas:

1. conservar en un acumulador conversacional separado cada delta exactamente como se usará para `assistant.done`; el buffer TTS puede eliminar sólo whitespace exterior al emitir;
2. cortar tras `.`, `?` o `!` únicamente cuando ya se observó un carácter posterior de whitespace; un fin de delta no confirma frontera;
3. al recibir `assistant.done`, tratar el fin definitivo como confirmación de la puntuación final y vaciar cualquier resto no vacío;
4. no cortar en decimal dígito`.`dígito ni tras `Mr.`, `Mrs.`, `Ms.`, `Dr.`, `e.g.`, `i.e.` o `vs.` (case-insensitive); retener puntuación al final de chunk hasta recibir el siguiente carácter permite reconocer estos casos;
5. si el buffer supera 240 caracteres sin frontera confirmada, cortar en el último whitespace entre posiciones 160–240; si no existe, en 240;
6. nunca emitir whitespace ni sintetizar más de una vez el mismo tramo de texto.

Probar puntuación repartida entre chunks, abreviaturas, Unicode, límite forzado y flush final.

### 5.2 Cola y consumidor

Por sesión, `tts_queue` acotada a 8 elementos. Cada item inmutable: `turn_id`, `generation`, `segment_index` empezando en 0, `text`, `provider`. Un único consumidor por sesión sintetiza en orden mediante el `SpeechService` de T04.

Antes y después de TTS, verificar generación vigente. Cancelación o nueva voz:

- cancela la llamada activa cuando sea cancelable;
- elimina items de generaciones anteriores;
- descarta resultados tardíos de SDKs síncronos;
- no emite error por una cancelación esperada.

Fallo de un segmento: emitir `error` no fatal `speech_unavailable`, con turno/generación y retryable según causa; descartar los segmentos siguientes de esa respuesta para evitar audio incompleto fuera de contexto. La respuesta escrita y el feedback siguen visibles. No hacer fallback de proveedor.

## 6. Protocolo de audio

Extender fixture/uniones:

```json
{"type":"audio.begin","turn_id":"UUID","generation":1,"segment_id":"UUID","segment_index":0,"media_type":"audio/mpeg","byte_length":1234}
```

Inmediatamente: un único frame binario de longitud exacta. Después:

```json
{"type":"audio.end","turn_id":"UUID","generation":1,"segment_id":"UUID","segment_index":0}
```

Reglas:

- begin/binario/end es indivisible respecto a otros frames binarios; sólo el outbound writer toca el socket.
- `segment_index` estrictamente creciente desde 0 por generación.
- máximo 2 000 000 bytes por segmento; TTS mayor es respuesta inválida.
- el cliente rechaza MIME, longitud, IDs, índice u orden incoherentes, cancela esa generación y muestra error de protocolo.
- audio de generación obsoleta se drena/ignora sin decodificar ni reproducir.

## 7. Scheduler frontend

Crear `AudioScheduler` independiente de React, inyectable y probado con AudioContext fake. API mínima:

- `enqueue({generation, index, bytes}): Promise<void>`;
- `cancelBefore(generation): void`;
- `stopAll(): void`;
- `close(): Promise<void>`;
- callbacks `onPlaybackStart`, `onSegmentEnd`, `onIdle`, `onError`.

Comportamiento:

1. decodificar MP3 fuera de render;
2. conservar un map temporal por índice y programar sólo el siguiente contiguo;
3. usar un único `AudioContext` por sesión, creado/reanudado tras gesto;
4. programar con `startAt = max(context.currentTime + 0.02, previousEnd)` para evitar solapamiento;
5. cada source se registra por generación y se desconecta al terminar;
6. `stopAll` detiene sources, limpia pendientes/decoded buffers y vuelve idle de inmediato;
7. tras cancelación, una promesa `decodeAudioData` tardía comprueba generación antes de encolar;
8. cerrar contexto y listeners al desmontar.

No crear object URLs ni elementos `<audio>` por segmento. El reproductor HTTP de T04 puede conservar su implementación independiente.

## 8. Barge-in y generación

Al detectar `speech.started` local:

1. `scheduler.stopAll()` sin esperar;
2. marcar generación anterior cancelada en reducer;
3. enviar `speech.started` con la nueva generación y `response.cancel` para la anterior si existía;
4. el servidor actualiza su generación autoritativa, cancela tareas STT/LLM/feedback/TTS anteriores y purga sus colas;
5. cualquier callback tardío comprueba generación y no emite/muta.

Cubrir interrupción durante: reproducción, decode pendiente, TTS, stream LLM, feedback y STT. `response.cancelled` puede confirmar cleanup, pero el navegador no espera esa confirmación para callar audio.

## 9. Waveform y UX

- Waveform deriva de `AnalyserNode` durante entrada y salida; no transmite audio.
- Con `prefers-reduced-motion: reduce`, mostrar nivel estático/medidor sin animación continua.
- Etiquetas visibles: “Escuchando”, “Te escucho”, “Procesando”, “Respondiendo”, “Interrumpido”. No depender sólo de color.
- Selector TTS compartido de T04 está disponible en Voice. El servidor toma un snapshot del proveedor al aceptar `speech.started` y todos los segmentos de esa generación usan ese único proveedor. Cambiar el selector durante una generación activa la cancela/detiene explícitamente y el nuevo valor se aplica sólo a la siguiente generación; nunca se mezclan Polly y Edge en una respuesta.
- Controles de detener respuesta y finalizar sesión accesibles por teclado.

## 10. Línea roja y pruebas

Escribir antes:

- import dinámico y fallback para cada fallo VAD;
- segmento VAD/PTT corto, vacío, cancelado o con encoding fallido produce exactamente `response.cancel`/`response.cancelled` y no deja generación activa;
- existencia de assets de build;
- exclusión del paquete VAD del JS inicial de landing;
- acumulador con todas las fronteras;
- cola TTS ordenada, llena, fallo y cancelación;
- contrato begin/binario/end y writer único;
- scheduler con llegada desordenada, decode tardío, stop y close;
- interrupción determinista en cada etapa usando Events/fakes, no sleeps;
- proveedor cambiado sin fallback;
- cleanup de VAD, media tracks, AudioContext, WebSocket y tareas.

Orden green: assets/import VAD → adaptador de entrada → acumulador → TTS queue/eventos → scheduler → integración/reducer → waveform. Refactor sólo con recorridos anteriores verdes.

## 11. Aceptación y validación

- [ ] Voice funciona manos libres con VAD y con PTT fallback.
- [ ] Respuesta se oye en segmentos continuos, siempre en orden.
- [ ] Hablar durante respuesta la silencia inmediatamente y no reaparece audio viejo.
- [ ] Feedback no bloquea primer audio y su fallo no impide conversación.
- [ ] Cambio Polly/Edge es explícito, persistente y sin fallback.
- [ ] Assets son locales; landing no carga VAD.
- [ ] Ningún audio se guarda en disco, storage o logs.
- [ ] Cleanup deja cero tracks, contexts, sources y tareas.

Ejecutar backend completo, frontend `quality`, inspección de chunks/build y `git diff --check`. Realizar prueba manual de micrófono en Chrome y Edge sólo si están disponibles, registrándola como manual; no sustituye tests. No ejecutar proveedores live sin autorización. Actualizar `progress.md` y pasar a `T08` únicamente con evidencia.
