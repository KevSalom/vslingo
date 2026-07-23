# `T04` — TTS compartido

[Índice](README.md) · [Producto](../product-spec.md) · [Plan](../implementation-plan.md) · [Estado](../progress.md)

## 1. Objetivo y condición de entrada

Implementar una única capacidad de síntesis reutilizable por Writing y por el futuro Voice Studio. Al cerrar el incremento, Writing debe poder reproducir su texto corregido con **AWS Polly Neural** o **Microsoft Edge Neural**, seleccionados explícitamente, mediante `POST /api/speech` y audio MP3.

Condición de entrada: `progress.md` debe indicar `T04` como próximo incremento y `T03` debe seguir verde. Si no es así, no implementar esta spec.

## 2. Baseline que debe conservarse

Antes de escribir pruebas, comprobar el árbol real. En el baseline de `T03` ya existen:

- `SpeechSynthesizerPort.synthesize(text, voice=None)` y `SynthesizedSpeech(audio, media_type="audio/mpeg")`;
- `FakeSpeechSynthesizer`;
- settings y readiness para `aws_polly` y `edge_tts`;
- dependencias exactas `boto3` y `edge-tts`, y smokes opt-in para ambos;
- app factory con dependencias explícitas y errores HTTP `{ "error": { "code", "message", "retryable" } }`;
- Writing Studio con resultado corregido y almacenamiento `vslingo:writing`.

No duplicar estos elementos. Refinarlos sólo donde esta spec lo exige y mantener health operativo sin credenciales.

## 3. Alcance obligatorio

1. Dominio y servicio de Speech con selección explícita de proveedor.
2. Adaptadores productivos Polly y Edge detrás del puerto existente.
3. Endpoint binario `POST /api/speech`.
4. Preferencia frontend versionada y compartida.
5. Selector Polly/Edge y control reproducir/detener en Writing.
6. Cancelación, limpieza de recursos, errores públicos y pruebas deterministas.
7. Documentación de configuración y smoke live, sin ejecutar el smoke salvo autorización.

### No alcance

- WebSocket, captura de micrófono, STT, prompts o UI funcional de Voice (`T05`–`T07`).
- Rediseño global o landing (`T08`).
- Rate limiting, métricas económicas o despliegue (`T09`–`T10`).
- Catálogo remoto de voces, SSML, descarga de audio o fallback automático.
- Guardar audio en disco, logs, `localStorage` o caché persistente.

## 4. Decisiones cerradas

### 4.1 Identificadores y límites

- Enum backend y unión TypeScript: `"aws_polly" | "edge_tts"`.
- Proveedor inicial cuando no hay estado válido: `aws_polly`.
- El texto es vacío si, tras eliminar whitespace exterior, no queda contenido.
- El máximo de **3000** caracteres Unicode se calcula sobre el texto bruto recibido, antes del trim, para que no pueda evadirse con espacios. Si es válido, el servicio entrega al adaptador el texto con whitespace exterior eliminado y conserva intactos los saltos/espacios interiores.
- `voice` es opcional. Ausente o `null` usa `AWS_POLLY_VOICE_ID` o `EDGE_TTS_VOICE`. Si se envía, debe tener 1–100 caracteres, sin controles; no se interpreta como SSML.
- Salida única: MP3 con `audio/mpeg`. Una respuesta vacía o con otro MIME es inválida.
- No hay fallback: el proveedor pedido es el único que puede invocarse.

### 4.2 Servicio

Crear `SpeechService` con un mapping inyectado `SpeechProvider -> SpeechSynthesizerPort`. Debe:

1. validar texto/proveedor/voz sin invocar adaptadores ante error;
2. elegir exactamente un adaptador;
3. propagar cancelación (`asyncio.CancelledError` nunca se normaliza como error de proveedor);
4. validar bytes no vacíos y MIME `audio/mpeg` antes de devolver;
5. normalizar fallos mediante los códigos de integración existentes, sin registrar texto, audio, excepción cruda ni secretos.

### 4.3 Contrato HTTP exacto

`POST /api/speech`, `Content-Type: application/json`:

```json
{
  "text": "The deployment is ready.",
  "provider": "aws_polly",
  "voice": null
}
```

`voice` puede omitirse. Campos extra se rechazan. Éxito `200`:

- cuerpo: bytes MP3;
- `Content-Type: audio/mpeg`;
- `Cache-Control: no-store`;
- `X-Content-Type-Options: nosniff`.

Envelope de error: `{ "error": { "code": string, "message": string en español, "retryable": boolean } }`.

| Caso | HTTP | `code` | retryable |
| --- | ---: | --- | --- |
| vacío | 422 | `empty_text` | false |
| más de 3000 | 422 | `text_too_long` | false |
| proveedor/voz/payload inválido | 422 | `invalid_request` | false |
| proveedor sin configuración | 503 | `provider_not_configured` | false |
| timeout | 504 | `provider_timeout` | true |
| indisponibilidad | 503 | `provider_unavailable` | true |
| respuesta vacía/MIME inválido | 502 | `invalid_provider_response` | true |

Nunca incluir `provider`, credenciales, texto o diagnóstico privado en el body público.

### 4.4 Adaptador AWS Polly

- Usar `Engine="neural"`, `OutputFormat="mp3"`, `SampleRate="24000"`, `TextType="text"` y la voz pedida/default.
- Crear el cliente con región y credenciales de `Settings`; no usar cadena de credenciales implícita si faltan las credenciales configuradas para VSLingo.
- El SDK síncrono debe ejecutarse fuera del event loop. Configurar timeouts de conexión/lectura con `provider_timeout_seconds` y cero reintentos internos no controlados.
- Leer y cerrar siempre `AudioStream`; cerrar el cliente. Si la coroutine se cancela, ignorar el resultado tardío y liberar recursos en cuanto el SDK lo permita.
- Mapear credenciales ausentes, timeout, errores transitorios y respuesta inválida a `IntegrationError`; no exponer mensajes de botocore.

### 4.5 Adaptador Microsoft Edge Neural

- Usar `edge_tts.Communicate(text, voice)` y recopilar únicamente chunks `audio` en memoria.
- Rechazar resultado sin chunks o no MP3.
- Envolver la operación completa con el timeout configurado y permitir cancelación real de la tarea.
- Presentarlo siempre como “Microsoft Edge Neural”, nunca Azure Speech.

### 4.6 Frontend compartido

Crear una capacidad `frontend/src/shared/speech/` (o ubicación equivalente ya existente) con:

- tipos y guardas runtime;
- cliente `synthesizeSpeech` que envía el contrato exacto, exige `audio/mpeg`, usa `AbortSignal` y traduce el envelope tipado;
- almacenamiento `vslingo:speech`, `{ "version": 1, "state": { "provider": "aws_polly" } }`;
- carga tolerante a JSON corrupto, versión desconocida, acceso bloqueado o cuota llena;
- `SpeechProviderControl` reutilizable y un controlador/hook de reproducción.

El controlador mantiene como máximo una solicitud y un elemento `Audio` activos. Al reproducir de nuevo, cambiar de proveedor, pulsar detener, desmontar o limpiar Writing: aborta fetch, pausa audio, elimina handlers y revoca cualquier object URL. Respuestas obsoletas no pueden iniciar reproducción. Estados visibles: inactivo, sintetizando, reproduciendo y error.

Writing añade junto al texto corregido:

- selector accesible “Proveedor de voz” con opciones “AWS Polly Neural” y “Microsoft Edge Neural”;
- botón “Escuchar” que cambia a “Detener” durante síntesis/reproducción;
- error accionable en español con `role="alert"`;
- el texto enviado es exactamente `corrected_text`.

No persistir audio ni estado transitorio de reproducción.

## 5. Archivos previstos

Inspeccionar antes de crear. Responsabilidades esperadas:

- `backend/app/domain/speech.py`: enum, límites y errores de entrada.
- `backend/app/services/speech.py`: selección y validación.
- `backend/app/providers/aws_polly.py` y `edge_speech.py`: adaptadores.
- `backend/app/api/speech.py`: modelos HTTP y router.
- `backend/app/main.py`, `core/config.py`, `providers/readiness.py`: composición mínima.
- `backend/tests/test_speech.py`, `test_aws_polly.py`, `test_edge_speech.py`.
- `frontend/src/shared/speech/*` y sus tests.
- `frontend/src/features/writing/WritingStudio.tsx` y test dirigido.
- `backend/README.md` y `.env.example` sólo si falta explicar una variable ya aprobada.

No modificar lockfiles: las dependencias requeridas ya están fijadas.

## 6. Secuencia red-green-refactor

### Red

Escribir y ejecutar primero pruebas que demuestren:

1. endpoint feliz para ambos proveedores con bytes y headers exactos;
2. proveedor inválido no invoca ningún fake;
3. no hay fallback cuando el adaptador elegido falla;
4. límites, voz y errores se mapean según la tabla;
5. Polly usa parámetros Neural/MP3/24 kHz y cierra stream/cliente;
6. Edge reúne audio, respeta timeout y cancelación;
7. el cliente frontend valida MIME/envelope y aborta;
8. storage migra sólo datos válidos y sobrevive a errores;
9. Writing envía `corrected_text`, cambia proveedor y limpia reproducción.

Confirmar que fallan por comportamiento ausente, no por imports rotos.

### Green

Implementar en este orden: dominio → servicio/fakes → endpoint/composición → adaptadores → cliente/storage/control compartido → integración Writing. No comenzar Voice.

### Refactor

Eliminar duplicación de envelopes sólo si no cambia contratos de Writing/Video. Mantener dependencias inyectables y funciones documentadas/tipadas.

## 7. Criterios de aceptación

- [ ] Un texto válido devuelve MP3 con cada proveedor elegido explícitamente.
- [ ] Writing reproduce y detiene su corrección, y el selector persiste tras recarga.
- [ ] Cambiar proveedor afecta la siguiente solicitud y cancela una anterior activa.
- [ ] No existe fallback, audio persistido ni contenido sensible en logs/errores.
- [ ] Health arranca sin secretos y readiness sigue siendo secreto-cero.
- [ ] Todos los casos de motor, voz, límite, MIME, timeout, cancelación y proveedor inválido están cubiertos con dobles.
- [ ] Los smokes live siguen separados y no fueron ejecutados sin autorización.

## 8. Validación de cierre

```powershell
Set-Location backend
uv sync --frozen --all-groups
uv lock --check
uv run ruff check app tests
uv run mypy
uv run pytest

Set-Location ..\frontend
pnpm install --frozen-lockfile
pnpm run quality

Set-Location ..
git diff --check
```

Además, revisar el diff contra esta spec y confirmar que no hay archivos de Voice, diseño global, protección o despliegue. Actualizar `progress.md` con comandos y resultados reales; el siguiente incremento sólo pasa a `T05` si todos los criterios aplicables están verdes.
