# VSLingo — Estado de ejecución

[Volver al README](../README.md) · [Plan comercial](commercial-mvp-plan.md) · [Alpha histórica](implementation-plan.md)

Este es el único documento para el estado mutable de implementación. Debe actualizarse al cerrar cada incremento, sin convertir el roadmap estable en una lista de estados.

Última actualización documental: 2026-09-15.

## Estado actual

- **Roadmap actual:** MVP comercial Inglés al Grano `F0`–`F8`; la Alpha `T01`–`T10` queda como baseline histórico completado.
- **Fase actual:** `F3 — Historial completo` completada el 2026-09-15.
- **Próximo incremento:** `F4 — Cuotas y costes`.
- **Rama de trabajo:** `codex/ingles-al-grano-mvp`, creada desde `main` en `aa26cab8ac10345a2c596febe78a0ad10c7df5c1` (`feat: add global stylesheet with Tailwind integration and multi-theme design tokens`).
- **Completado:** F0 adoptó el plan y aisló la rama; F1 entregó producto/UI/voz simple; F2 añadió identidad y SQLite; F3 incorporó historial sincronizado de escritura, videos, notas y voz, además de preferencias de cuenta.
- **Pendiente:** F4–F7; F8 permanece posterior al lanzamiento y sujeto al cierre de condiciones comerciales.
- **Bloqueos:** ninguno para iniciar F4 con fakes. La configuración y validación de un tenant Clerk real sigue siendo un gate externo del fundador; OpenRouter/PayPal, Meta y dispositivos físicos se requieren en fases posteriores o en sus validaciones live.

## Evidencia de F0

- Árbol inicial limpio en `main`; no había cambios del usuario que preservar.
- Baseline backend: `uv lock --check`, Ruff y mypy en verde; **138 tests** pasaron. Se observó una advertencia de deprecación de Starlette/TestClient.
- Baseline frontend: `astro check` con 0 errores, 0 warnings y 5 hints de APIs Web Audio obsoletas; **130 tests Vitest** pasaron; build estático completado.
- Baseline E2E: **12/21 pasaron**. Siete casos del proyecto Playwright `chromium` no arrancaron porque no está instalado su binario administrado. El caso de creación de nota falló en Chrome y Edge por un selector accesible ambiguo que coincide también con “Eliminar nota”.
- El script raíz `scripts/check-quality.ps1` imprimió “All Quality Checks Passed” y terminó con código 0 pese al fallo de Playwright; corregir su propagación de errores forma parte del saneamiento inicial de F1.
- No se ejecutaron smokes live, proveedores pagos, micrófono físico, compras ni campañas.

## Evidencia de F1

- Landing y shell se reorientaron a **Inglés al Grano** con los módulos Hablar, Escribir y Videos, rutas estables `/app`, `/app/hablar`, `/app/escribir` y `/app/videos`, CTA «Probar gratis», precio de **US$2.99** y oferta textual de **60 minutos de tu voz, hasta 180 intervenciones**.
- Hablar usa sólo pulsar/tocar para hablar, maneja teclado, `pointercancel` y pérdida de foco; el tema inicial es libre y los prompts dejaron de limitarse a software. Se retiraron dependencias, assets, imports y pruebas específicas de VAD del frontend activo.
- **Pulido visual y de usabilidad solicitado antes de publicar:** la UI adopta la paleta de English Corrector (marfil, tinta y terracota), Outfit y superficies suaves; queda sólo modo claro por defecto más modo oscuro persistente. Se retiraron el selector y los cinco temas heredados de VSLingo; cualquier preferencia antigua migra a claro.
- El shell dejó la metáfora de IDE: navegación con enlaces reales y soporte atrás/adelante, títulos visibles con foco gestionado, controles convencionales y lenguaje orientado a tareas. «Explorer», «fixture/demo técnica», nombres de archivo y diagnósticos de sincronización se sustituyeron por «Mis videos y notas», «video de ejemplo» y «Tu borrador». Guardar video aparece sólo cuando hay un resultado que guardar.
- Revisión heurística: **5/10 antes → 9/10 después**. Se resolvieron jerarquía competida, estado oscuro impuesto, jerga técnica, iconos sin contexto y navegación sin semántica de enlace. Queda para validación posterior observar a usuarios reales y certificar lector de pantalla/dispositivos físicos; no bloquea F2.
- Edge TTS quedó como único proveedor de voz del backend, con Aria/Guy (EE. UU.) y Sonia/Ryan (Reino Unido). El protocolo v2 conserva texto por segmento, voz seleccionada e identidad de turno/generación/índice; el navegador toma cada segmento fallido sin duplicar audio y descarta MP3 tardíos.
- Se retiraron AWS Polly de configuración, proveedor, readiness, smokes, dependencias, deploy y pruebas activas. El script `scripts/check-quality.ps1` ahora propaga el código de salida de cada comando nativo.
- Backend completo: Ruff y mypy en verde; **135 tests pytest** pasaron. Se mantiene una advertencia de deprecación de Starlette/TestClient.
- Frontend completo: Astro check con **0 errores y 0 warnings** (5 hints por `ScriptProcessorNode` legado), **124 tests Vitest** pasaron y el build estático generó las seis rutas públicas esperadas. El conteo bajó respecto del baseline al eliminar suites obsoletas de VAD y de la presentación pública retirada, y volvió a crecer con cobertura de tema y navegación.
- E2E del build actualizado: **7/7 en Chrome** y **7/7 en Edge**. Cubren landing y navegación, transcripción y notas de Videos, controles PTT/voz de Hablar y limpieza de borrador en Escribir. El explorador de notas volvió a ser accesible como drawer también en escritorio. El proyecto Playwright `chromium` administrado no se ejecutó porque su binario continúa sin instalarse; no afecta estas dos matrices del sistema.
- Verificación renderizada con Chrome: landing revisada a 320 y 1440 px; Hablar, Escribir y Videos a 390 px, con Hablar tanto claro como oscuro. No hubo desbordamiento horizontal en 320/390 px; navegación, selectores, CTA y control PTT permanecieron visibles. Los pares de texto principales, secundarios, CTA, diffs y acentos activos se midieron con el contrast checker WCAG; el acento textual derivado alcanza AA en fondos suaves.
- No se hicieron llamadas live a proveedores, ni se certificaron micrófono o audio en dispositivos físicos. La emulación visual no sustituye el gate móvil real de F7. Auth, persistencia, cuotas y pagos pertenecen a F2–F6.

## Evidencia de F2

- El backend integra el SDK oficial de Clerk con verificación de `session_token`, clave JWT local, partes autorizadas y extracción exclusiva de `sub`/`sid` verificados. `AUTH_MODE=fake` funciona sin secretos sólo en desarrollo/pruebas y se rechaza fuera de esos entornos.
- Todas las operaciones de proveedor (Writing, Video, Speech y emisión de ticket Voice) requieren bearer válido. El usuario se deriva de la sesión; parámetros o IDs enviados por el cliente no cambian la identidad efectiva. Logout revoca la sesión y todos sus tickets pendientes.
- SQLite aplica migraciones monotónicas para `users`, `preferences`, `trial_grants` y `ws_tickets`, con foreign keys, WAL, busy timeout, transacciones inmediatas y cierre durante el lifespan. Una prueba reabre el archivo y confirma persistencia; las suites usan memoria para no dejar artefactos.
- Preferencias usan versión optimista y consultas filtradas por Clerk ID autenticado. La suite prueba que el usuario A no modifica ni lee las preferencias de B.
- Voice obtiene por REST autenticado un ticket aleatorio breve. Sólo se guarda SHA-256, se consume atómicamente una vez, expira en el límite exacto y nunca coloca el token Clerk ni un ID de usuario en la URL WebSocket. `Origin` se valida antes de aceptar.
- El frontend integra `@clerk/react`: gate de inicio de sesión, cuenta/logout y token de la sesión activa. En fake muestra claramente «Sesión local». Cambiar de cuenta desmonta el workspace y limpia borradores/cachés anónimos o de la cuenta anterior antes de montar la nueva; cerrar sesión desmonta primero para cancelar audio y callbacks.
- Configuración documentada para desarrollo, frontend estático y backend de producción. Render exige la clave pública; Dokploy exige Clerk servidor y monta SQLite bajo `/data` con una sola réplica/worker. No se añadieron valores secretos al repositorio.
- Backend: lock válido, Ruff y mypy estricto en verde; **149 tests pytest** pasaron. Se conserva una advertencia de deprecación Starlette/TestClient.
- Frontend: Astro check con **0 errores y 0 warnings** (5 hints heredados de `ScriptProcessorNode`), **129 tests Vitest** pasaron y el build generó seis rutas. E2E: **7/7 Chrome** y **7/7 Edge**.
- No se creó ni configuró un tenant Clerk, no se usaron credenciales reales y no se hicieron llamadas live. El adaptador Clerk se cubrió con estados firmados simulados; la vuelta real desde correo/Google pertenece al gate externo de configuración.

## Evidencia de F3

- La migración `0002_study_history.sql` añade escrituras, videos guardados, notas versionadas, conflictos preservados, conversaciones y turnos. Todas las relaciones se filtran por el usuario autenticado y la suite prueba que un usuario B no puede leer ni reanudar contenido de A.
- Escribir guarda cada corrección terminada con `operation_id` idempotente, muestra pendiente/éxito/fallo y permite listar, reabrir sin nueva corrección y borrar.
- Videos conserva de forma explícita la transcripción ya obtenida para reabrirla sin consultar de nuevo al proveedor. Las notas se autoguardan con ID estable, versión optimista y estado visible; un conflicto 409 preserva la versión remitida en `note_conflicts` en vez de sobrescribirla silenciosamente.
- Hablar crea una conversación por práctica, persiste sólo pares completos y adjunta feedback tardío al turno existente. Se puede listar, reabrir, continuar o borrar; al continuar el servidor carga como máximo los últimos seis pares completos y conserva el escenario. Un callback tardío no recrea una conversación borrada.
- Los tickets WebSocket enlazan la reanudación al dueño verificado: enviar el ID de una conversación ajena produce un error fatal tipado. El protocolo compartido admite `conversation_id` opcional y entrega el error antes del cierre de política.
- Tema y voz se cargan desde las preferencias de cuenta al montar el workspace y los cambios se sincronizan; cambiar de cuenta sigue desmontando y limpiando el estado local anterior. No se importa ninguna base ni `localStorage` de productos anteriores.
- El esquema y una prueba explícita confirman que no existen columnas WAV, MP3 ni blobs de audio. Sólo se persisten texto, feedback estructurado y metadatos necesarios.
- Backend completo: Ruff y mypy estricto en verde; **157 tests pytest** pasaron. Se conserva una advertencia de deprecación Starlette/TestClient.
- Frontend completo: Astro check con **0 errores y 0 warnings** (5 hints heredados de `ScriptProcessorNode`), **133 tests Vitest** pasaron y el build estático generó seis rutas. E2E: **7/7 Chrome** y **7/7 Edge**.
- No se hicieron llamadas live, no se probó un segundo dispositivo físico ni se configuró Clerk real. El comportamiento multiusuario/multisesión se verificó con identidades, archivos SQLite y estados simulados independientes.

## Inventario y riesgos considerados en F1 (histórico)

- Reutilizar `DemoWorkspace`, `VoiceStudio`, captura PTT, scheduler, protocolo tipado, acumulador/colas TTS, Writing y Video existentes.
- Retirar VAD del recorrido público y AWS Polly de código, dependencias, configuración, deploy y tests específicos; no confundir retiro con borrar la evidencia histórica de documentación.
- Implementar Edge TTS con cuatro voces permitidas y un coordinador de fallback `speechSynthesis` por segmento/generación; el texto debe sobrevivir a cualquier fallo de audio.
- Mantener proveedor falso por defecto y evitar credenciales o llamadas live durante las pruebas normales.
- Verificar interacción a 320 px, 390 px y escritorio, teclado, `pointercancel`, pérdida de foco y `prefers-reduced-motion`. La emulación no certifica micrófono o dispositivos reales.
- **Polish post-T10 (2026-07-24):** Video Lab — biblioteca y notas en explorer tree estilo VS Code; notas agnósticas del video (`title` + `text` + `timestamp?`, storage v2); área de estudio limpia; modales Guardar video/nota; hover copiar/guardar frase en vista línea; drawer Explorer en móvil.
- **Bugfix post-T10 (2026-07-26):** Audio Waveform Amplitude (`.kiro/specs/audio-waveform-amplitude`) — medidor visual calibrado (`audioLevel.ts`) con supresión de ruido de fondo, normalización de voz útil, curva perceptual de raíz cuadrada y suavizado con factores de ataque/liberación independientes; integrado en `onFrameLevel` de `vadClient.ts`.
- **Polish post-T10 (2026-07-27):** Voice Studio UI — se quitó «Iniciar Sesión»; botón circular on/off en `control.voice` (Iniciar / Activo / Pausar); estado de entrada destacado en el header; escenarios como `<select>` al estilo del proveedor TTS; sin badge «en espera» en `conversation.stream`.
- **Bugfix post-T10 (2026-07-27):** Voice WebSocket dejaba URL hardcodeada `ws://localhost:8000/api/voice/ws`; ahora deriva de `PUBLIC_API_URL` igual que REST (`resolveVoiceWebSocketUrl`). Documentado en `.env.example`, `frontend/README.md` y `deploy/README.md`.
- **Bugfix post-T10 (2026-07-27):** Voice Studio — etiquetas fijas; ondas mic/VAD/PTT; ganancia agente; historial al cambiar solo proveedor TTS; modo exclusivo de entrada **Manos libres | Pulsar para hablar** (evita `invalid_event` por frames binarios de VAD al apretar PTT a mitad de turno).
- **Polish post-T10 (2026-07-27):** Landing — sección `#sin-ruido` (anti-rachas/gemas/rutas); audiencia y prompts ampliados de B1-B2 a **B1-C1** (copy, `product-spec`, monorepo docs, `voice.py`, `writing.py`); hero con ciclo CSS de 3 firmas (voice / writing / video), sin JS de cliente.
- **Polish post-T10 (2026-07-27):** Voice lazy fallback — el «Cargando Voice Studio…» de una línea se sustituyó por un skeleton con la misma rejilla `voice-split` para evitar el salto de layout al montar el chunk.
- **Polish post-T10 (2026-07-27):** Fuentes — migradas de `@import` Fontsource a la Fonts API de Astro (`fontProviders.fontsource` + `<Font preload />`); fallbacks con `size-adjust`/`ascent-override` para reducir FOUT/CLS; eliminados `@fontsource/*` del `package.json`.

`T10` introdujo la suite E2E determinista con Playwright (`@playwright/test` 1.50.1) cubriendo Landing, Writing Studio, Video Lab y Voice Studio; los archivos de despliegue `render.yaml` (Render Static Site), `deploy/Caddyfile.example`, `deploy/vslingo-api.service.example`, `backend/nixpacks.toml` y la guía paso a paso [`deploy/dokploy-nixpacks.md`](../deploy/dokploy-nixpacks.md) para Dokploy en VPS; y el script raíz unificado de calidad [`scripts/check-quality.ps1`](../scripts/check-quality.ps1).

## Evidencia disponible

- Backend base: `Settings` tipado, app factory, `GET /api/health`, readiness sin secretos y puertos/fakes para STT, LLM, TTS, corrección, transcripciones y feedback.
- Backend Writing: contratos Pydantic inmutables, límite de 1000 caracteres, `CorrectionService` asíncrono, `CorrectionProviderPort`, fake determinista y `POST /api/writing/correct` con errores públicos tipados.
- Backend Speech (TTS): servicio `SpeechService` con selección explícita entre `aws_polly` y `edge_tts` sin fallback automático. Límite de 3000 caracteres Unicode sobre texto bruto antes del trim, validación de voz y respuesta binaria `audio/mpeg`.
- Backend Voice (WebSocket, STT, Chat Streaming, Feedback & TTS Streaming): `speech.started` cancela sólo la generación previa; `turn_id` y generación se validan juntos; escenario/proveedor se snapshottean por turno; cancelaciones obsoletas no interrumpen turnos nuevos; la conversación produce dos oraciones cortas y encola la primera para TTS mientras la segunda continúa en streaming; `TTSConsumer` acotado cancela síntesis activa, descarta resultados tardíos y entrega cada tríada de audio como una unidad al writer único.
- Frontend Voice: VAD se inicia tras `session.ready` sin pulsar PTT; misfires y fallos cancelan su generación; PTT usa “Mantén pulsado para hablar”, pausa VAD y restaura la escucha; el selector compartido persiste Polly/Edge; cambios rápidos de escenario se confirman por revisión; begin/binario/end valida generación, longitud, IDs e índice antes de decodificar; y `onFrameLevel` entrega amplitudes perceptibles, suavizadas y proporcionales transformadas por `createAmplitudeMeter`.
- Revalidación completa T09 Backend: Ruff sin errores (`ruff check app tests`), `mypy app` estricto en verde (43 archivos) y 138 tests pasados en `pytest` (incluyendo la suite completa de protecciones T09).
- Revalidación completa T10 Frontend & E2E: `pnpm run quality` completado con 0 errores de Astro check, 118 tests de Vitest pasados en verde (incluyendo `audioLevel.test.ts`, `vadClient.test.ts` y `VoiceStudio.test.tsx`), y build estático limpio.
- Polish Video Lab UI & Bugfix Audio Amplitude: `pnpm run quality` en frontend con 0 errores de check, **118** tests Vitest pasados y build estático limpio. Suites dirigidas: `audioLevel` (PBT propiedad 1 voz perceptible, propiedad 2 silencio/estabilidad rampa, límites y clamps), `vadClient` (emisión de nivel visual calibrado), `VoiceStudio` (actualización de transform de barras).
- Guías de despliegue listas: Dokploy en VPS con Nixpacks ([`deploy/dokploy-nixpacks.md`](../deploy/dokploy-nixpacks.md)), Caddy/systemd ([`deploy/Caddyfile.example`](../deploy/Caddyfile.example)) y Render ([`render.yaml`](../render.yaml)).
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
