# Inglés al Grano — plan de implementación del MVP comercial

Fecha: 2026-09-14. Destino de implementación: repositorio VSLingo, en la rama `codex/ingles-al-grano-mvp`. Estado: **implementación activa; consultar [`progress.md`](progress.md) para la fase vigente y la evidencia real**.

Este documento sustituye las propuestas del 11 de septiembre para el nuevo MVP. Las decisiones confirmadas proceden del usuario; los valores de configuración y criterios técnicos siguientes concretan ese alcance. Los documentos antiguos se conservan como contexto histórico, no como instrucciones vigentes.

## 1. Decisiones cerradas y límites de alcance

| Tema | Decisión vigente |
|---|---|
| Producto | Inglés al Grano: practicar inglés intermedio, no aprender desde cero |
| Público | Jóvenes adultos hispanohablantes; adquisición inicial propuesta para mayores de 18 años |
| Base | Reutilizar VSLingo: Astro, React/TypeScript, Tailwind, FastAPI, audio, contratos y pruebas existentes |
| Diseño | Estilo cómodo de Inglés al Grano; tres módulos visibles: Hablar, Escribir, Videos |
| Oferta | Un único plan de **US$2,99/mes**, prueba gratuita sin tarjeta y login obligatorio para practicar |
| Identidad | Clerk: Google y código por correo; sin cuestionarios de onboarding |
| Estado | SQLite transaccional, persistencia y aislamiento por usuario, historial automático sin audio |
| Datos anteriores | Cuentas nuevas; no importar datos de ninguno de los productos anteriores |
| LLM / STT | OpenRouter: `google/gemini-3.1-flash-lite` / `openai/whisper-large-v3-turbo` |
| TTS | Edge TTS con voces seleccionables; respaldo con `speechSynthesis` del navegador; retirar AWS Polly |
| Pago | PayPal Business Venezuela; usuario confirma recepción USD y captura muestra Subscriptions habilitado en Sandbox y Live |
| Distribución | Web instalable como PWA; Android/iPhone y escritorio requieren validación real |
| Publicidad | Meta aún sin configurar: preparar integración; ensayo posterior de US$70 durante siete días |
| Referidos | Última fase: enlace y panel simple de colaborador, con liquidación manual |

No incluir app nativa, idiomas adicionales, cursos/rutas, gamificación, anuncios dentro de la app, preguntas IA sobre videos, grabaciones guardadas, migración de datos antiguos, edición colaborativa, sincronización offline de cambios, múltiples workers/Redis, planes anuales, recargas ni catálogo de planes.

La captura no acredita un cobro ya probado ni disponibilidad Live de Payouts. No volver a preguntar si Subscriptions está habilitado; comprobar su funcionamiento durante la integración. Payouts no es necesario para este MVP.

Mensaje de landing:

> **Ya sabes inglés. Ahora practícalo.**
> Habla a tu ritmo, mejora lo que escribes y entrena el oído con videos.
> **Cuando quieras, sin perder el tiempo.** Explicaciones en español, directo al punto.

## 2. Oferta configurable y reglas de consumo

Estos son los valores iniciales de implementación, ajustables tras medir uso. Centralizarlos en un archivo de configuración tipado del servidor; no dispersarlos por componentes/prompts. Frontend y landing leen el contrato público de planes y límites, con precio coherente con PayPal.

| Recurso | Prueba única por cuenta verificada | Cada periodo mensual pagado |
|---|---:|---:|
| Audio enviado por el alumno | 600 segundos / 10 minutos | 3.600 segundos / 60 minutos |
| Intervenciones de voz | Hasta 30 | Hasta 180 |
| Correcciones terminadas | 10 | 100 |
| Videos nuevos con transcripción | 3 | 20 |
| Longitud de texto por corrección | 1.000 caracteres | 1.000 caracteres |
| Longitud de nota | 2.000 caracteres | 2.000 caracteres |

Voz se agota al alcanzar minutos **o** intervenciones. Publicar “60 minutos de tu voz, hasta 180 intervenciones”, además del saldo en Cuenta; no ocultar la segunda condición. No cuentan respuestas del tutor, pausas entre turnos, lectura ni tiempo de espera. El servidor verifica duración del audio a partir de su formato/datos, no confía en `duration_ms` enviado por el cliente. Entrada máxima por intervención: 60 segundos, reducida al saldo restante y comunicada antes de grabar.

Separar del plan los límites operativos: un socket de voz activo por cuenta, un turno pendiente, concurrencia global, tamaños máximos, timeouts y rate limits. Conservar inicialmente sesión máxima de 15 minutos/30 turnos existente, con fin claro y continuación del chat guardado sin reiniciar cuota. Evitar VAD en el recorrido público y mantener respuestas conversacionales de dos frases, hasta 600 caracteres, con límites efectivos de salida/contexto. El razonamiento y feedback deben quedar acotados y medidos.

Contrato de configuración sugerido:

```text
plan_code=monthly_v1; currency=USD; price_minor=299
trial.voice_seconds=600; trial.voice_turns=30; trial.writing=10; trial.videos=3
monthly.voice_seconds=3600; monthly.voice_turns=180; monthly.writing=100; monthly.videos=20
content.writing_max_chars=1000; content.note_max_chars=2000
voice.max_input_seconds=60; voice.context_pairs=6; voice.context_max_chars=12000
voice.max_reply_chars=600; voice.max_session_seconds=900; voice.max_session_turns=30
features.meta_enabled=false; features.affiliates_enabled=false
```

Las claves concretas pueden adaptarse al estilo del repositorio. Guardar versión y snapshot de límites en cada concesión/periodo. Cambiar configuración afecta a nuevas concesiones/periodos, nunca reduce silenciosamente un periodo pagado. Un aumento manual puede concederse explícitamente con auditoría. Cambiar precio exige nuevo plan/configuración PayPal y política de transición; cambiar `price_minor` no cambia por sí solo las suscripciones existentes. Por ahora mantener US$2,99.

Reglas obligatorias:

- Reserva atómica de segundos/turno/corrección/video antes del proveedor; liquidación idempotente y liberación de sobrantes. Sin transacciones SQL abiertas durante STT/LLM/TTS/YouTube.
- Escritura consume una unidad si el resultado termina y queda persistido. Una respuesta errónea no consume unidad del usuario; los costes del proveedor sí se registran internamente.
- Voz consume audio aceptado y un turno cuando obtiene respuesta textual válida. Fallar solo TTS o feedback no duplica ni reinicia STT/LLM. Si la operación no puede completarse, devolver cuota según su estado, preservando costes incurridos. Limitar reintentos y cancelaciones abusivas.
- Reservar para terminar el turno aceptado; no interrumpirlo para mostrar checkout. Reconexión/reintento con el mismo identificador recupera la operación existente.
- Video consume unidad solo tras obtener su transcripción por primera vez para ese usuario/video/idioma. Reabrir material obtenido, refrescar o editar notas no consume otra. La caché del proveedor no evita la primera unidad de otro usuario; no compartir sus notas.
- Historial, notas y lectura de resultados guardados no consumen IA. Reproducir texto existente no genera de nuevo conversación/feedback; síntesis remota sigue autenticada, acotada y limitada por frecuencia. Evitar que `/api/speech` permita eludir las protecciones.
- Una prueba por identidad verificada; borrar caché, reinstalar PWA o iniciar sesión en otro equipo no la reinicia. No prometer detección perfecta de múltiples cuentas de una misma persona.
- El primer periodo pagado sustituye la prueba: no se suman sus saldos. Las cuotas mensuales no se acumulan. Cancelar o dejar vencer la suscripción no reactiva la prueba. El historial sigue disponible para consultar y borrar con sesión iniciada; las nuevas operaciones de IA requieren cuota vigente.
- Tras una caída del proceso, reconciliar las reservas: liquidar operaciones cuyo resultado ya quedó persistido y liberar solamente reservas abandonadas sin resultado. Si una llamada externa tiene resultado incierto, no repetirla automáticamente; registrar la incertidumbre y aplicar una resolución acotada que evite doble cobro y reservas permanentes.
- Cobros y límites pertenecen al servidor. Mostrar fecha de fin del periodo y próxima renovación; periodos de calendario del proveedor, no sumar siempre 30 días desde un webhook.

## 3. Recorridos y contratos de UX

### Navegación

Landing pública `/`: mensaje, tres módulos, ejemplo sintético, precio/límites y CTA “Probar gratis” / “Entrar”. No llamada paga para mostrar el ejemplo. Aplicación bajo `/app` con rutas estables de Hablar, Escribir, Videos y Cuenta. Mantener compatibilidad con enlaces antiguos mediante redirects/aliases documentados; no dejar una demo anónima que ejecute proveedores en el nuevo despliegue.

Nuevo usuario: registro → módulo, sin test de nivel ni entrevista. Recurrente: último módulo. Permiso de micrófono al activar voz; invitación PWA después de una práctica, descartable. Detalles de precio, renovación y cancelación visibles antes de contratar. Ajustes de voz/tema secundarios, sin obligar a configurarlos.

### Hablar

Conversación en una columna, tema libre por defecto y PTT principal. Primer gesto “Activar micrófono”; tras permiso, “Mantén pulsado para hablar”. Soltar envía, estados legibles “Grabando”, “Preparando respuesta”, “Respondiendo”. Una mejora prioritaria por turno, explicación desplegable y posibilidad de volver a practicar. Sin selector de proveedor, métricas STT/tokens/coste o panel de editor.

“Detener respuesta” y “Terminar práctica” tienen funciones estables. Durante reproducción, detenerla antes de grabar; no grabación automática ni barge-in. Proporcionar alternativa de toque iniciar/detener para quien no pueda sostener el botón, manteniendo el límite de duración. Teclado, pérdida de foco, puntero fuera y `pointercancel` no dejan micrófono activo. Cambiar escenario inicia una conversación nueva; cambiar voz conserva la actual y afecta al siguiente turno.

Historial automático con título por tema/fecha, sin llamada IA para titular. Se puede consultar, continuar o borrar. Continuar toma solo los últimos pares completos dentro del contexto acotado, no todos los chats. Un turno parcial queda identificado; no se presenta como respuesta completa ni se reenvía inadvertidamente al modelo.

### Escribir y Videos

Escribir conserva entrada, diff, explicaciones claras e historial automático; volver a abrir no recorrección. Copiar y editar para una nueva corrección son acciones distintas. Videos conserva reproductor/transcripción sincronizada, biblioteca sencilla y notas con referencia temporal opcional; eliminar el árbol de archivos de VS Code. Guardar un video es intención explícita del usuario, y los datos del video/transcripción obtenidos se conservan para reabrir; las notas creadas se autoguardan con estado visible.

No guardar cada token ni cada pulsación de nota: persistir resultados/turnos en hitos y usar debounce con versión para notas. Un conflicto de nota entre dispositivos preserva ambas versiones para elección; nunca sobrescribir silenciosamente. Loading, vacío, error, saldo agotado, guardado pendiente/fallido y acceso vencido deben tener contenido y recuperación concretos.

## 4. Edge TTS y respaldo del navegador

Edge es el único sintetizador remoto de lanzamiento. Ofrecer cuatro voces inglesas verificadas al implementar, por ejemplo dos estadounidenses y dos británicas, con una predeterminada. Validar IDs contra catálogo permitido y guardar preferencia de cuenta. Retirar Polly de proveedores, configuración, tipos, dependencias, UI, deploy y tests exclusivamente AWS; conservar pruebas genéricas de síntesis y cancelación. No configurar proveedores pagos adicionales.

El fallback usa `speechSynthesis`, no reconocimiento de voz del navegador: Whisper sigue transcribiendo. Consultar `getVoices()` al iniciar y reaccionar a `voiceschanged`. Seleccionar voz inglesa, preferiblemente local; si no existe la preferida, escoger una disponible sin bloquear. Preferencias específicas del dispositivo no se fuerzan sobre otro dispositivo.

Las voces y calidad dependen del sistema; pueden usar servicio remoto. No anunciar que todo funciona offline. Aviso breve “Usando la voz del navegador”. Si hace falta gesto para reproducción, mostrar “Escuchar respuesta”; si no hay síntesis disponible, conservar texto y explicación. [MDN SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis), [localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

El protocolo requiere trabajo real, no solo un `catch`:

1. Emitir texto completo por segmento con `turn_id`, `generation`, `segment_id`, índice y texto antes de sintetizarlo; usar el mismo acumulador que Edge. No pronunciar repetidamente deltas acumulados.
2. Un coordinador frontend controla MP3 y síntesis del navegador con estados queued/playing/completed/failed/cancelled por segmento.
3. Error Edge antes de reproducir un segmento: conservar anteriores terminados, cambiar a navegador desde ese segmento y descartar MP3 tardíos del resto del turno. No superponer motores.
4. Error después de empezar a reproducir un segmento: detener, indicar interrupción y ofrecer repetición explícita; no fingir reanudación exacta por palabra ni repetir automáticamente toda la respuesta.
5. No volver a Edge a mitad del turno; usar pausa breve configurable tras fallos reiterados. Timeouts y reintentos acotados.
6. Cancelar, logout, desconectar o salir del módulo detienen ambos motores e invalidan callbacks anteriores. Si también falla navegador, queda texto, sin llamada nueva al LLM.
7. El `playback.started` actual solo reconoce primer MP3 enviado. Extender el contrato para reproducción de navegador validando segmento/generación. ACK es coordinación/telemetría, nunca autoridad de cobro/cuota.

Actualizar juntos contrato JSON, validadores Python/TypeScript, pruebas y versión de protocolo cuando corresponda. No guardar WAV/MP3 en disco, BD, service worker, logs ni backups. Buffers efímeros en memoria se liberan al terminar. La falta de garantías comerciales de Edge documentada por su mantenedor permanece como riesgo operativo; el fallback mejora continuidad, no acredita condiciones de servicio. [Fuente del mantenedor](https://github.com/rany2/edge-tts/discussions/261).

## 5. Arquitectura, datos e identidad

Un frontend estático y FastAPI en VPS, inicialmente un worker. SQLite en volumen persistente local con foreign keys, WAL, busy timeout, migraciones y backups consistentes/restaurables. Un único límite de concurrencia global por proceso; no escalar a múltiples workers sin rediseñar su coordinación. PostgreSQL queda para contención/escala demostrada.

Clerk autentica correo/Google. Backend verifica firma, emisor, tiempos y partes autorizadas; obtiene usuario del token. No confiar en IDs o roles enviados por frontend. WebSocket usa ticket opaco, breve, de un solo uso, emitido por REST autenticado; validar Origin y consumir atómicamente. No poner token Clerk duradero en URL/logs. Sesiones y autorización revalidadas antes de cada operación; token/socket no conceden acceso comercial perpetuo. Cambiar cuenta limpia memoria/cachés de la anterior.

Entidades mínimas:

| Grupo | Tablas / invariantes |
|---|---|
| Identidad | users con Clerk ID único; preferences; trial_grants única por usuario |
| Estudio | notes con versión; saved_videos; writing_entries; voice_conversations y voice_turns con secuencia única por conversación y operation_id |
| Cobro | subscriptions, payments con transaction_id único; paypal_events con event_id único; billing_attempts ligados al usuario |
| Consumo | usage_periods con snapshot de límites; usage_operations con reservation/status/unidades/coste; ws_tickets consumibles |
| Marketing | consentimiento/versionado, atribución permitida y marketing_outbox idempotente |
| Última fase | affiliates, referrals, commission_ledger y settlement_batches; sin pago automático |

Todas las lecturas, cambios y borrados se filtran por usuario autenticado; UUID no es autorización. Relaciones y claves únicas resuelven carreras, no solo un `if` previo. Dinero en unidades menores y moneda; uso/coste con precisión adecuada; timestamps UTC. Lista paginada con orden estable. Al borrar chat se borran sus turnos; un callback tardío no recrea contenido borrado. Mantener datos financieros mínimos separados del contenido de estudio conforme a la política de retención aplicable.

No importar SQLite antiguo ni localStorage anónimo. Conservar productos anteriores y backups intactos durante desarrollo; cuentas nuevas empiezan vacías. No montar el viejo volumen de datos como la nueva BD. Inicialmente sin sincronización de escrituras offline: preservar borrador temporal de la cuenta y mostrar pendiente; al reconectar solicitar sesión válida y resolver conflicto antes de guardar.

Contratos HTTP sugeridos (nombres finales documentados en OpenAPI): plan público; perfil/cuota; CRUD propio de estudio; corrección con operation_id; ticket WS; intento/cancelación/estado de suscripción; webhook PayPal; eventos marketing permitidos. No construir CRUD genérico con nombre de tabla recibido por cliente. La ruta de speech solo procesa texto acotado o contenido propio, con controles equivalentes.

## 6. PayPal: fuente de verdad económica

Un producto y un plan recurrente mensual USD de US$2,99; sin prueba automática de PayPal ni setup fee. La prueba se concede en la app sin tarjeta. Crear intento autenticado ligado al usuario, plan permitido en servidor y aprobación PayPal. No asociar cuentas por coincidencia de email PayPal; no activar por `onApprove` o por un callback del cliente.

Webhook HTTPS: verificar firma/entorno/merchant esperado, persistir evento y procesar de forma recuperable. Para Subscriptions, `PAYMENT.SALE.COMPLETED` y lifecycle `BILLING.SUBSCRIPTION.*`, con refunded/reversed según catálogo oficial; no copiar solo eventos Capture de Orders. Verificar transacción, importe, moneda, plan, suscripción y relación con el intento; eventos duplicados y fuera de orden deben converger al mismo estado. [Integración](https://developer.paypal.com/subscriptions/integrate), [eventos](https://developer.paypal.com/api/rest/webhooks/event-names/).

Transacción local registra pago y periodo de acceso/cuota una sola vez. Idempotencia por transacción económica además del webhook. Periodo derivado de datos verificados, no del momento de llegada. Si hay discrepancia, conservar estado pendiente y conciliar contra API; no volver a cobrar ni regalar periodos. Un temporizador/command de conciliación recuperable y solapamiento impedido bastan; no Redis/Celery obligatorio.

Cuenta muestra plan, saldo, periodo y cancelar renovación. Cancelar impide cobros futuros y conserva acceso ya pagado. Impago no concede nueva cuota; suspensión/expiración siguen estado verificado y fecha de acceso. Reembolsos/reversiones ajustan cobros, acceso y comisiones bajo regla explícita, sin borrar ledger. Inicialmente reembolso manual en PayPal, recibido por webhook. Si falla la cancelación no mostrar éxito.

Un reembolso total o una reversión invalida únicamente el periodo financiado por ese cobro y su cuota restante; conserva el consumo histórico y no revoca periodos posteriores pagados correctamente. Un reembolso parcial requiere un ajuste manual auditado, sin conceder cuota ni revocar automáticamente todo el acceso. Reembolsar un cobro y cancelar las renovaciones futuras son operaciones separadas.

Proteger compra repetida/doble clic: un usuario no debe crear dos suscripciones activas por accidente; recuperar intento pendiente antes de abrir otro. Reintentos soportados usan `PayPal-Request-Id` estable. Un pago confirmado concede acceso aunque el comprador cierre el navegador. No prometer checkout sin cuenta PayPal para cualquier tarjeta/país sin haberlo verificado.

## 7. Meta y atribución antes de publicidad

Arrancar con integración desactivada si falta cuenta; modo fake/Test Events separado de producción. Variables protegidas: dataset/pixel ID, token CAPI, versión Graph fijada y test_event_code solo en test. Sin claves en frontend o en el encargo del agente.

| Evento | Fuente y deduplicación |
|---|---|
| PageView | Navegación real de navegador, ruta sanitizada, UUID de vista; mismo ID si se envía por Pixel y CAPI |
| Lead | Primer registro verificado y persistido; mismo ID en reintentos, nunca cada login |
| Purchase inicial | Transacción PayPal confirmada; CAPI solo inicialmente; source website para compra iniciada en web |
| Purchase renovación | ID diferente por transacción; source system_generated; distinguir renewal de first_payment |

No emitir Lead y CompleteRegistration como dos adquisiciones; la definición aprobada aquí es Lead=registro. No enviar Purchase por onApprove, por visitar gracias ni desde un endpoint libre del frontend. Si luego se añade Pixel Purchase, devolver desde servidor el mismo event_name/event_id del cobro ya confirmado.

Outbox SQL: guardar pago/acceso primero y evento permitido dentro de esa transacción; enviar Meta después, con reintentos que no cambian event_id. Una caída de Meta no retrasa práctica ni revierte derechos. Respetar consentimiento del usuario también al despachar; un rechazo no impide usar/pagar. Hash no es anonimización. Datos permitidos normalizados; no inventar IP/browser de comprador con los del webhook. Nunca audio, notas, frases, feedback, nivel inferido ni URLs con contenido privado/tokens. Permitir solo nombres y campos concretos, con control de spam sobre eventos de navegador.

Conciliar importes reales y separar renovaciones de adquisición en informes. CAPI no determina ingresos del producto: manda el ledger PayPal. Reembolsos no se inventan como Purchase negativo. Probar payloads sintéticos y dedupe en Test Events antes de publicidad. [SDK oficial: eventos](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/serverside/event.py), [origen automático](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/serverside/action_source.py).

## 8. Fases ejecutables

La ejecución del agente empieza en F0, no en F8. En cada fase: contrato/test dirigido, implementación mínima, validación pertinente y actualización de `docs/progress.md`. Los tests normales usan fakes. Leer las skills canónicas del repositorio para diseño/React/Tailwind/E2E y aplicar accesibilidad al implementar interacción. No ejecutar pruebas live por defecto.

| Fase | Dependencia | Entrega integrada | Criterio de cierre |
|---|---|---|---|
| **F0 — Base y documentación** | Ninguna | Rama aislada; baseline; adoptar este alcance en docs; inventario de configuración y riesgos | Estado/commit base registrados, cambios previos preservados, suite existente ejecutada y resultados reales documentados; siguiente F1 |
| **F1 — UI y voz simple** | F0 | Marca, tres módulos, PTT, prompts generales, Edge/voces y fallback navegador; prototipo funcional con fakes | Navegación clara a 320/390 px y escritorio; ninguna descarga VAD en PTT; casos de audio/cancelación abajo cubiertos; no llamadas AWS |
| **F2 — Identidad y SQLite** | F0, F1 integrada | Clerk, migraciones, repositorios por usuario, tickets WS, sesión y logout | Anónimo bloqueado en operaciones de proveedores; A no accede a B; ticket no reusable; BD persiste tras reinicio; instancias dev arrancan sin secretos con fakes |
| **F3 — Historial completo** | F2 | Escrituras, chats, notas, videos/preferencias persistentes; listas, retomar y borrar | Reabrir/segundo dispositivo recupera propios datos; no audio guardado; guardado fallido/conflicto/feedback tardío cubiertos; cero importación antigua |
| **F4 — Cuotas y costes** | F3 | Configuración única, prueba, snapshots, reserva/liquidación por operación, saldo UI | Dos pestañas no gastan el último crédito dos veces; límites exactos; tras una caída se liquidan resultados persistidos y se liberan reservas abandonadas sin repetir llamadas inciertas; cambios de configuración no reducen el periodo concedido |
| **F5 — PayPal y Cuenta** | F4 | Suscripción sandbox, webhook/conciliación, cuotas pagas, cancelar/impago/devolución | Compra da acceso solo tras cobro, duplicados no duplican periodos, retorno ausente funciona, cancelación conserva periodo; integraciones falsas y sandbox diferenciadas |
| **F6 — Medición y operación** | F5 | Meta outbox/PageView/Lead/Purchase, consentimiento, estado de pagos/coste para operador | Rechazo no envía tracking; Meta caída no bloquea pago; compra/renovación únicas; modo desactivado funciona si aún falta dataset |
| **F7 — PWA y lanzamiento** | F1–F6 | Instalación, móvil real, landing final, soporte/textos comerciales, backups y runbook | Matriz de lanzamiento aprobada, restore probado, oferta coherente, compra live autorizada conciliada; beta paga antes de ads |
| **F8 — Referidos** | Después de F7 | Enlace, atribución y panel colaborador/admin con comisiones | A solo ve su agregado; pagos/refunds/dedupe correctos; ledger y liquidación manual probados; no integración Payouts requerida |

Estimación orientativa para F0–F7: **15–24 jornadas concentradas**, incluyendo integración y correcciones; F8, otras 2–3. No es promesa de fecha ni horas de generación del modelo: depende de baseline, audio móvil, revisión y servicios externos. Para acelerar, mantener el alcance y terminar incrementos; no sustituir las pruebas de pago/audio por velocidad aparente. F8 no bloquea cobrar. Meta sin credenciales no bloquea desarrollo ni beta orgánica, pero sí el ensayo publicitario medido.

### Archivos existentes a reutilizar

Rutas relativas a VSLingo:

- Shell/visual: `frontend/src/components/DemoWorkspace.tsx`, `pages/index.astro`, `pages/demo.astro`, `styles/global.css`, `shared/theme/` (los cuatro últimos bajo `frontend/src`).
- Voz frontend: `frontend/src/features/voice/VoiceStudio.tsx`, `audioCapture.ts`, `audioScheduler.ts`, `voiceSocket.ts`, `voiceState.ts`, `protocol.ts` y tests del mismo directorio.
- Voz backend: `backend/app/voice/session.py`, `tts_queue.py`, `accumulator.py`; `backend/app/domain/voice_protocol.py`, `history.py`; `docs/contracts/voice-protocol-v1.json`.
- Proveedores/prompts: `backend/app/providers/`, `backend/app/prompts/`; speech compartido `frontend/src/shared/speech/`.
- Otros módulos: `frontend/src/features/writing/`, `frontend/src/features/video/`; API/servicios en `backend/app/api/` y `services/`.
- Protecciones: `backend/app/core/protection.py`, `config.py`, `observability.py`.
- Validación y deploy: `backend/tests/`, `frontend/e2e/`, `scripts/check-quality.ps1`, `deploy/` y lockfiles.

Inglés al Grano es referencia visual, no una segunda implementación que mantener: `english-corrector/frontend/src/App.jsx`, `index.css`, componentes MainCorrector/VideoPracticer y assets. No portar su backend CRUD global ni sobrescribir ambos repos con una copia masiva.

## 9. Matriz de aceptación obligatoria

| ID | Dado / acción | Resultado demostrable |
|---|---|---|
| A01 | Nuevo visitante llega a landing | Ve producto, tres módulos y US$2,99 con límites sin contestar preguntas |
| A02 | Login y práctica | Vuelve al destino; no se impone una entrevista; operación/resultado disponible sin ajustes obligatorios |
| A03 | PTT con puntero/teclado; pérdida de foco | Captura/envío/cancelación coherentes; micrófono liberado al salir; alternativa de toque usable |
| A04 | Edge falla antes de primer audio o segundo segmento | Navegador reproduce solo segmentos pendientes; no doble audio ni nueva llamada LLM; audio tardío descartado |
| A05 | MP3 ya empezado falla, voces inicialmente vacías o API ausente | Repetición explícita si parcial; carga de voces posterior; texto siempre disponible; gesto de reproducción si necesario |
| A06 | Detener/logout/nueva generación durante cualquier playback | Ambos motores y callbacks antiguos quedan cancelados; ACK falso no altera saldo |
| A07 | Usuario B intenta ID de contenido/ticket de A | Rechazo REST y WS; tampoco aparece en caché, historial ni panel |
| A08 | Reintento tras red/caída y feedback tardío | Una operación/turno; guardado explícito; sin resucitar un chat borrado; coste y cuota auditables |
| A09 | Último saldo en dos pestañas y caída antes/después de persistir el resultado | Solo se acepta lo disponible; reconciliación sin saldo negativo, doble liquidación, reservas permanentes ni repetición automática de llamadas inciertas |
| A10 | Reinstalar/cambiar dispositivo/cerrar sesión | No se reinicia prueba; historial propio persiste; no importación anónima |
| A11 | Cobro PayPal duplicado/desordenado/cierre navegador | Un pago y periodo; acceso solo confirmado; conciliación recupera pendientes |
| A12 | Cancelar, impago, reembolso total/parcial y reversión de cobro actual/anterior | Sin nueva cuota impaga ni prueba reactivada; total/reversión afecta solo su periodo, parcial requiere ajuste auditado; conserva periodos posteriores pagados e historial; sin doble comisión ni éxito falso |
| A13 | Rechazo marketing, Meta caída, renovación | Cero envíos no permitidos; acceso intacto; outbox recuperable; nueva renovación con ID propio |
| A14 | PWA sin red/actualización/retorno externo | Shell informa sin conexión; no audio/cobros en cola oculta; sesión y pago revalidados; actualización no corta grabación |
| A15 | Zoom, móvil vertical/horizontal y teclado virtual | Sin recorte de botones ni contenido inaccesible; foco/etiquetas claros; acciones esenciales alcanzables |
| A16 | Restaurar backup en entorno aislado | BD consistente, pagos/cuotas/contenido conservados; secretos y audio ausentes; no se reenvían cobros/marketing reales |
| A17 | Historial consultado/continuado/borrado en otro dispositivo | Resultado correcto por usuario y paginación; contexto modelo acotado; no pérdida silenciosa de notas |
| A18 | Afiliado abre panel y recibe pago/reembolso atribuido | Solo estadísticas propias, cálculo neto exacto y ledger reversible; no email/chat de alumnos |

Verificar componentes con Vitest/pytest y recorridos con Playwright existentes. `scripts/check-quality.ps1` o comandos por paquete según documentación; ejecutar lint/tipos/build del paquete afectado y `git diff --check`. No borrar tests para conservar números históricos ni afirmar que están verdes sin ejecutarlos. No crear suites que solo repitan la implementación: privilegiar carreras, errores y límites de confianza.

Matriz manual real F7: Chrome/Edge escritorio, Chrome Android, Safari iPhone en navegador y PWA instalada. Probar micrófono, denegación, auriculares, interrupción por llamada/bloqueo/cambio de app, vuelta desde Clerk/PayPal y audio navegador. Emulación de viewport o fakes no certifican micrófono físico.

## 10. Operación y gates externos

Se puede desarrollar con fakes/configuración vacía sin pedir secretos al usuario. Antes del sandbox/live, el operador configura directamente variables protegidas de Clerk/OpenRouter/PayPal en su entorno. Meta puede llegar después. Documentar nombres de variables, no valores en repositorio ni chat. No instalar servicios o ejecutar compras solo por existir este plan.

| Gate | Responsable | Condición |
|---|---|---|
| Configuración real | Fundador + implementador | Clerk producción/dominio, OpenRouter, PayPal Sandbox/Live separados y webhook configurado |
| Voz remota | Fundador + implementador | Comportamiento desde VPS y fallback probado; riesgo/condiciones de Edge documentados, sin promesa de servicio garantizado |
| Economía | Implementador | Medir sesiones sintéticas autorizadas, tokens facturados por chat+feedback, STT, reintentos y uso extremo antes de publicidad |
| Oferta/soporte | Fundador | Contacto real, precio, cuotas, renovación, cancelación, privacidad/borrado y política de devoluciones visibles |
| Pago Live | Fundador + implementador | Compra/cancelación controladas con importe/autorización explícitos; cobro y acceso conciliados; no repetir revisión de elegibilidad ya confirmada |
| Dispositivos | Fundador + implementador | Evidencia de Android/iPhone reales; no marcar paso manual como pasado por un mock |
| Meta | Fundador | Cuenta publicitaria, dataset/token y eventos test; luego habilitar envío comercial conforme consentimiento |
| Afiliados | Fundador | Antes de activar F8, fijar porcentaje/duración/condiciones; default propuesto 20% de neto PayPal en tres primeros pagos |

Backups consistentes mediante API/backup de SQLite, cifrados/protegidos y con política de rotación/restauración documentada; no copiar solo `.db` ignorando WAL activo. La persistencia se mantiene al reiniciar contenedor. Evitar logs con texto/voz/tokens. Herramienta interna mínima protegida para ver suscripción, cuota, coste y errores, ejecutar conciliación segura y exportar lo necesario; no dashboard empresarial extenso.

Deploy: staging con fakes/sandbox → backup → migraciones compatibles → nuevo frontend/backend coherentes → pruebas controladas → dominio. Rollback a release comercial estable conservando ledger; no volver a API anónima sin cuotas ni restaurar un backup que pierda pagos recientes. Al restaurar, separar entornos y conciliar antes de servir.

## 11. Ensayo de captación: US$70, después de validar la beta

Presupuesto objetivo del usuario: US$10/día durante siete días. Configurar un presupuesto total de campaña/conjunto de **US$70 con inicio/fin**, verificando límites y facturación en su cuenta; no interpretar un presupuesto diario como máximo rígido de cada día. Reservar cargos/impuestos según su cuenta, sin ejecutarlos durante desarrollo.

Preparación durante desarrollo: crear/configurar el negocio en [Meta Business Suite](https://business.facebook.com/), la cuenta en [Administrador de anuncios](https://adsmanager.facebook.com/) y el dataset en [Administrador de eventos](https://business.facebook.com/events_manager2/). Guardar los identificadores y configurar el token directamente en el entorno protegido cuando F6 lo necesite; no compartir secretos en el chat.

Hipótesis inicial recomendada: un conjunto en México, público adulto y anuncios/landing en español. Si se quiere limitar a ciudades, CDMX, Guadalajara y Monterrey dentro del mismo conjunto; es una elección práctica de ensayo, no una afirmación demostrada de mejor CAC o mayor disposición a pagar. Dos videos cortos: demo PTT y antes/después de escritura. No cuatro países × varias ciudades × varios anuncios con US$70. Colombia/Ecuador se ensayan después con lo aprendido. Brasil queda para una validación de idioma/mercado porque el producto y feedback inicial son en español.

Antes de gastar: cinco personas externas completan una práctica, checkout opera y eventos están conciliados. Sin suficientes compras, una campaña de registros puede servir de ensayo, pero medir conversión real a pago y no confundir Lead con ingresos. No construir la oferta alrededor de intereses socioeconómicos supuestos; probar problema/interés en práctica intermedia y la claridad de la demo.

Métricas: registro → práctica → pago → uso en días distintos → renovación, por cohorte/canal. Informar gasto/usuarios/compradores con denominador y ventana, separando renovación de adquisición. US$0,61 de IA mensual del análisis anterior es un escenario de 120 turnos, no garantía. Con 180 turnos, 60 minutos de audio y 100 correcciones, manteniendo los mismos tokens medios, recarga y margen de contingencia, la estimación sube a US$0,76. La contribución aproximada a US$2,99 pasa de US$1,86 a US$1,71 antes de fijos, captación y otros cargos; salidas más extensas también cambian el coste.

Regla inicial de adquisición: buscar recuperación en 1–2 meses de contribución; incluir pruebas gratuitas y comisiones. Si el ensayo gastara US$70 y consiguiera 10 compradores, CAC publicitario sería US$7, antes de pruebas: superaría esa referencia de dos meses. Puede aportar aprendizaje, pero no justifica escalar automáticamente. Pausar al alcanzar presupuesto o descubrir fallos de pago/activación. Primeras renovaciones se evalúan cuando realmente vencen, no durante la primera semana.

## 12. Referidos, última fase

F8 no es requisito para publicar la app. Capturar atribución mínima en F6 si conviene evita rehacer registro, pero no activar programa hasta definir condiciones. Una comisión sobre neto después de PayPal no equivale a porcentaje de beneficio contable: excluir impuestos/devoluciones y precisar cómo se reparte la comisión real de procesamiento ante refund parcial.

Panel colaborador: enlace propio, registros y compradores atribuidos agregados, pendientes/disponibles/pagadas; sin nombres, correos, chats o textos de alumnos. Panel operador: asignación de colaborador/porcentaje, ledger, ajustes y lotes pagados con referencia manual. Registro de un usuario nunca le permite autoconcederse rol afiliado/admin. Reglas: primer referido válido al registrarse, sin autorreferidos, sin reasignación arbitraria, ID de pago único y ajustes por refund/reversal. Referidos no se reconstruyen retroactivamente como si hubieran sido observados.

Predeterminado propuesto configurable: 20% durante tres pagos elegibles; confirmación comercial antes de habilitar. Con US$2,99 y tarifa de referencia, alrededor de US$0,51 por pago elegible, antes de otros costes del negocio. PayPal Payouts no está habilitado Live en la captura y no se necesita: liquidación manual con ledger. No crear contrato, pagar colaboradores ni enviar propuestas desde el agente sin encargo específico.

## 13. Handoff y estado de esta entrega

Copiar este documento a `vslingo/docs/commercial-mvp-plan.md` en F0 y enlazarlo desde las fuentes canónicas. Actualizar product-spec/implementation-plan/progress para distinguir Alpha T01–T10 histórica de MVP F0–F8. Las antiguas exclusiones de auth/pagos/BD/móvil están sustituidas por el alcance explícito del usuario para esta etapa; no usarlas para impedir el trabajo nuevo. No reescribir el registro de pruebas anteriores.

El encargo de implementación se originó en `english-corrector/docs/encargo-agente-mvp.md`. Este documento ya fue adoptado en VSLingo durante F0; el estado de fases, pruebas, omisiones y siguiente paso se registra únicamente en [`progress.md`](progress.md).
