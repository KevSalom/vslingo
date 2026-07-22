# VSLingo — Plan de implementación

[Volver al README](../README.md) · [Especificación](product-spec.md) · [Estado actual](progress.md)

Este documento contiene el roadmap estable de la Alpha. Describe el orden y el resultado esperado de cada incremento, pero no registra qué está completado ni cuál es el siguiente paso; ese estado mutable pertenece exclusivamente a [`progress.md`](progress.md).

## Principios de ejecución

- Trabajar un único incremento numerado a la vez.
- Aplicar red-green-refactor: contrato o aceptación en rojo, implementación mínima en verde y refactor con la suite todavía verde.
- Terminar cada incremento integrado y demostrable; evitar código huérfano.
- Usar proveedores falsos en la suite normal. Los smoke tests live son opt-in y nunca se ejecutan por defecto.
- No añadir funciones fuera de este roadmap hasta que el recorrido desplegado esté verde.
- Mantener las decisiones de producto y arquitectura de [`product-spec.md`](product-spec.md); este plan no las sustituye.

## Distribución de tres días

| Día | Incrementos | Foco |
| --- | --- | --- |
| Día 1 | `T01`–`T04` | Base reproducible, Writing, Video y TTS compartido |
| Día 2 | `T05`–`T07` | Protocolo Voice, conversación, VAD, audio e interrupción |
| Día 3 | `T08`–`T10` | Sistema visual, protección operativa, integración y despliegue |

El plazo de referencia es de tres días para una persona apoyada por agentes LLM. La distribución expresa prioridad y secuencia; no constituye un registro de avance.

## `T01` — Walking skeleton y riesgos principales

**Objetivo:** establecer una base frontend/backend reproducible y verificar temprano los límites de las integraciones, sin construir todavía las funciones verticales.

### Incrementos de `T01`

#### `T01.1` — Inspección, bootstrap y pruebas iniciales

- Inspeccionar las referencias y validar los supuestos del producto.
- Preparar Astro + React 19 + Tailwind CSS v4 y FastAPI con Python 3.11+.
- Fijar dependencias exactas, lockfiles y herramientas de calidad.
- Redactar los primeros contratos de prueba para configuración, health y workspace.

**Resultado demostrable:** repositorio inicial reproducible, dependencias bloqueadas y contratos de prueba listos para establecer la línea roja.

#### `T01.2` — Línea roja y skeleton ejecutable

- Ejecutar las pruebas iniciales y confirmar que fallan por la ausencia esperada de implementación.
- Implementar el mínimo skeleton: configuración tipada, app factory, health sin secretos y workspace de demo con los tres módulos como puntos de entrada.
- Conectar únicamente lo necesario para convertir esa línea roja en verde, sin implementar las funciones de `T02`–`T10`.

**Resultado demostrable:** frontend y backend mínimos cargan mediante sus puntos de entrada y health responde sin credenciales de proveedores.

#### `T01.3` — Puertos, contratos y smokes opt-in

- Definir puertos explícitos y adaptadores falsos para STT, LLM y TTS.
- Normalizar configuración, readiness y errores de integración.
- Preparar smoke tests opt-in para OpenRouter STT, chat streaming, AWS Polly y Microsoft Edge Neural.
- Garantizar que ningún smoke live forme parte de la suite normal.

**Resultado demostrable:** cada proveedor puede comprobarse de forma aislada y explícita, mientras el recorrido determinista usa falsos.

#### `T01.4` — Validación integrada de la base

- Consolidar comandos reproducibles de lint, tipos, pruebas y build.
- Validar arranque, health, contratos falsos y limpieza de recursos.
- Documentar resultados y riesgos pendientes sin ampliar alcance.

**Resultado demostrable:** walking skeleton validado localmente con una ruta clara hacia los verticales siguientes.

## `T02` — Writing Studio vertical

**Objetivo:** entregar el primer flujo funcional de corrección estructurada.

- Definir contratos tipados de corrección y errores.
- Implementar `CorrectionService` asíncrono y el adaptador OpenRouter con JSON Schema.
- Construir editor, diff categorizado, feedback y acciones de copiar y limpiar.
- Persistir estado reciente con almacenamiento local versionado.
- Cubrir texto correcto, errores múltiples, salida inválida, timeout, entrada vacía y longitud máxima.

**Resultado demostrable:** el usuario envía texto, recibe corrección estructurada, entiende los cambios y puede copiar o limpiar el resultado.

## `T03` — Video Lab básico y resiliente

**Objetivo:** entregar el flujo esencial de vídeo con una demostración estable aunque el proveedor externo falle.

- Separar parser de URL y proveedor de transcripciones.
- Obtener subtítulos ingleses directos o traducidos cuando corresponda.
- Normalizar errores por subtítulos ausentes, bloqueo o URL inválida.
- Implementar transcripción sincronizada, seek y vistas de párrafo y línea.
- Persistir biblioteca y notas localmente.
- Incluir un vídeo técnico de muestra con fixture de transcripción.

**Resultado demostrable:** una URL válida muestra subtítulos navegables y el fixture incorporado mantiene disponible el recorrido de demo.

## `T04` — TTS compartido

**Objetivo:** ofrecer síntesis reutilizable y selección explícita de proveedor para Writing y Voice.

- Definir la interfaz `SpeechSynthesizer`.
- Implementar adaptadores AWS Polly Neural y Microsoft Edge Neural mediante `edge-tts`.
- Devolver MP3 con contrato `audio/mpeg` desde `POST /api/speech`.
- Persistir el proveedor seleccionado y permitir cambiarlo durante la sesión.
- Validar motor, voz, límites, MIME, timeout, cancelación y proveedor inválido.
- No realizar fallback silencioso.

**Resultado demostrable:** el mismo texto se reproduce con cualquiera de los dos proveedores seleccionados de forma explícita.

## `T05` — Protocolo Voice y PTT → STT

**Objetivo:** construir la primera ruta de voz determinista desde push-to-talk hasta transcripción final.

- Definir uniones discriminadas Pydantic/TypeScript y fixtures compartidos para el protocolo WebSocket.
- Crear `VoiceSession`, colas acotadas, writer único, turnos y generaciones.
- Capturar audio del navegador como WAV mono de 16 kHz mediante push-to-talk.
- Implementar `STTConsumer` sobre el puerto de OpenRouter Whisper.
- Cubrir tamaño, orden de frames, timeouts, cola llena, desconexión y limpieza.

**Resultado demostrable:** un segmento PTT produce `transcript.final` con aislamiento por sesión y sin tareas residuales.

## `T06` — Conversación y feedback paralelo

**Objetivo:** convertir la transcripción en una conversación útil sin permitir que el feedback retrase la respuesta.

- Implementar prompts para Daily Standup, System Design / Technical Interview, Salary Negotiation y Libre / Explorar.
- Mantener historial conversacional acotado.
- Generar la conversación en streaming y el feedback estructurado en paralelo.
- Tratar los fallos de feedback como independientes de la respuesta conversacional.
- Mostrar respuesta, diff, vocabulario y resumen.
- Descartar streams o resultados pertenecientes a generaciones obsoletas.

**Resultado demostrable:** cada modo completa un turno con streaming y feedback; un fallo del feedback no bloquea la conversación.

## `T07` — VAD, audio e interrupción

**Objetivo:** completar la experiencia manos libres y el barge-in con reproducción ordenada y cancelable.

- Cargar Silero mediante `@ricky0123/vad-web` sólo al entrar en Voice Studio.
- Servir localmente assets ONNX, WASM y AudioWorklet.
- Conservar push-to-talk como respaldo si VAD no se inicializa.
- Segmentar la salida conversacional por oraciones y alimentar el consumidor TTS.
- Implementar scheduler de audio, waveform, orden de segmentos e interrupción inmediata.
- Cancelar la generación anterior y descartar feedback/audio obsoletos en todas las etapas.

**Resultado demostrable:** el usuario conversa sin pulsar, puede interrumpir al asistente y nunca escucha audio de un turno cancelado.

## `T08` — Sistema visual y landing

**Objetivo:** aplicar la identidad profesional aprobada al workspace y presentar el producto con una landing rápida y accesible.

- Aplicar las skills de diseño, Tailwind y React indicadas en [`AGENTS.md`](../AGENTS.md).
- Implementar tokens, tipografías, shell, activity bar, diffs y panel inferior.
- Usar la transición waveform → diff como firma visual con moderación.
- Cubrir teclado, etiquetas, responsive y `prefers-reduced-motion`.
- Construir hero, módulos, pipeline, integración AWS, privacidad, CTA y metadatos SEO/OG/JSON-LD.
- Mantener la landing casi sin JavaScript y cargar Voice bajo demanda.

**Resultado demostrable:** landing y workspace forman una experiencia coherente, accesible y reconocible sin clonar VS Code.

## `T09` — Seguridad, costes y observabilidad

**Objetivo:** proteger secretos, recursos y presupuesto antes del despliegue público.

- Restringir CORS y validar `Origin` en WebSocket.
- Limitar conexiones, concurrencia, audio, turnos, sesiones y payloads.
- Aplicar timeouts, reintentos acotados, semáforos, rate limiting y backpressure.
- Registrar sólo metadatos de latencia, consumo, coste y error; nunca audio, transcript ni prompts.
- Mostrar métricas resumidas de sesión.
- Configurar límite monetario de OpenRouter y alerta de AWS Budget.

**Resultado demostrable:** los límites y errores se observan de forma segura y las colas/recursos no crecen indefinidamente.

## `T10` — Integración y despliegue

**Objetivo:** desplegar y validar los tres recorridos con infraestructura reproducible.

- Desplegar Astro como Render Static Site.
- Desplegar FastAPI detrás de Caddy en el VPS con TLS y WSS.
- Documentar variables, permisos IAM mínimos y runbook de AWS.
- Consolidar scripts de calidad y configuración de entornos.
- Ejecutar E2E deterministas de Writing, Video y Voice con red/proveedores simulados.
- Mantener los smoke tests reales separados y opt-in.
- Verificar Chrome y Edge, reconexión, limpieza y comunicación HTTPS/WSS Render ↔ VPS.

**Resultado demostrable:** los tres módulos completan sus recorridos críticos desplegados con proveedores falsos y los smokes live pueden invocarse de forma explícita cuando exista autorización.
