# `T10` — Integración y despliegue

[Índice](README.md) · [Producto](../product-spec.md) · [Plan](../implementation-plan.md) · [Estado](../progress.md)

## 1. Objetivo y condición de entrada

Consolidar calidad, E2E deterministas, configuración y runbooks; desplegar Astro en Render y FastAPI detrás de Caddy/TLS en el VPS; verificar HTTPS/WSS sin depender de proveedores live.

Sólo empezar con `T09` cerrado y `progress.md` en `T10`. Despliegues, DNS, IAM, presupuestos y secretos son cambios de infraestructura: antes de mutar recursos reales, describir acción/riesgo/reversión y obtener confirmación explícita. Sin autorización, completar archivos, validación local y runbook, y dejar despliegue real como bloqueo documentado.

## 2. Entregables

1. Playwright fijado a versión exacta, config y E2E de Writing, Video y Voice.
2. Backend E2E local con puertos falsos y cero red a proveedores.
3. Scripts únicos de calidad/CI no interactivos.
4. Render Static Site reproducible.
5. Caddy + servicio FastAPI de un worker en VPS.
6. Variables/env examples y runbooks de deploy, rollback, AWS y verificación.
7. Evidencia Chrome/Edge, reconexión, cleanup y HTTPS/WSS.

### No alcance

- Proveedor live como requisito de deploy; datos seed remotos; auth, DB, billing, Redis, múltiples workers o Kubernetes.
- Certificación Safari/móvil.
- Guardar secretos en repo, frontend, Render blueprint o logs.
- Cambiar el producto para facilitar E2E.

## 3. Entorno E2E determinista

### 3.1 Dependencias y scripts

Leer la skill Playwright. Añadir `@playwright/test` con versión exacta mediante pnpm y lockfile. Scripts mínimos:

```json
"test:e2e": "playwright test",
"test:e2e:chrome": "playwright test --project=chrome",
"test:e2e:edge": "playwright test --project=edge"
```

Config no abre reportes (`html` con `open: "never"` o line reporter), conserva trace sólo on-first-retry y screenshot sólo en fallo. Artefactos quedan en rutas ya ignoradas. No usar modo UI/watch en validación.

### 3.2 Servidores

Playwright inicia dos `webServer` no interactivos o un script coordinador:

- FastAPI E2E en `127.0.0.1:8000`, construido por `create_app` con fakes para Correction, Transcript, STT, chat, feedback y ambos TTS;
- Astro build/preview en `127.0.0.1:4321` con `PUBLIC_API_URL=http://127.0.0.1:8000`.

El entry E2E vive bajo tests/config, nunca se activa por env ambiguo en producción. Debe fallar al arrancar si se intenta usar un adaptador productivo. Bloquear solicitudes externas en Playwright salvo localhost y los assets del build; cualquier intento a OpenRouter, AWS, Edge, YouTube, CDN o analytics falla el test.

Fakes con respuestas y demoras controlables, sin sleeps largos. El fake TTS devuelve un fixture MP3 pequeño versionado/licenciado o bytes decodificables generados localmente; no simular éxito con bytes inválidos en navegador.

### 3.3 Navegadores y audio

Proyectos:

- `chrome`: channel `chrome` si instalado; si CI usa Chromium, no declarar que eso certifica Google Chrome.
- `edge`: channel `msedge`.

Conceder permiso de micrófono sólo a localhost. Usar flags oficiales de fake media y un WAV corto sintético sin voz/datos personales, o inyección del adapter de captura en build E2E explícito. La ruta ejercita PTT/VAD state, WebSocket y scheduler real hasta donde el navegador permita; nunca pide micrófono físico en automatización.

## 4. Recorridos E2E obligatorios

Cada test comienza con storage limpio y usa roles/labels, no selectores CSS frágiles.

### Writing

1. abrir `/demo`, activar Writing;
2. escribir texto con errores y revisar;
3. verificar corrected text, diff y feedback;
4. copiar mediante permiso/mock determinista;
5. seleccionar cada TTS, escuchar/detener y comprobar request provider;
6. recargar y verificar estado/preferencia versionados;
7. limpiar y comprobar storage/UI.

### Video

1. activar Video y abrir fixture incorporado (sin YouTube);
2. reproducir reloj fake/local, verificar cambio de segmento y seek;
3. cambiar párrafo/línea;
4. añadir biblioteca/nota y verificar recarga;
5. simular error de transcript y confirmar recorrido fixture sigue usable.

### Voice

1. conectar y recibir `session.ready`;
2. elegir cada uno de los cuatro escenarios al menos a través de test parametrizado;
3. producir tres turnos en uno de ellos usando audio fake;
4. verificar transcript, deltas/done, feedback y audio ordenado;
5. forzar feedback fallido y comprobar que conversación/audio continúan;
6. iniciar respuesta y luego nueva voz: audio viejo se detiene y eventos tardíos no aparecen;
7. cambiar Polly/Edge durante sesión;
8. forzar cierre/reconectar y completar otro turno;
9. salir del módulo y verificar desde backend fake que sesión/tareas/conexión se liberaron.

### Shell/landing

- CTA landing→demo, navegación por teclado, focus, responsive 320/768/1280 y reduced motion;
- metadata/JSON-LD por tests de build, no snapshots gigantes;
- ninguna petición externa y Voice chunk sólo al activarlo.

## 5. Flakiness y contrato

- Esperar estados observables (`expect`) y eventos del fake; prohibido `waitForTimeout` salvo explicación excepcional.
- IDs/tiempos se controlan por fakes o se comparan por patrón.
- Cada test es independiente y paralelo sólo si usa puertos/storage/sesiones aislados.
- Retries CI máximo 1 para diagnóstico, 0 local; un retry exitoso no convierte flakiness conocida en cierre.
- Trazas/screenshots se inspeccionan ante fallo y no se versionan.
- Validar fixture WebSocket compartido antes de E2E.

## 6. Render Static Site

Crear `render.yaml` o documentación equivalente con:

- root/build context correcto para `frontend`;
- Node compatible con `package.json` y pnpm fijado;
- build `pnpm install --frozen-lockfile && pnpm run build`;
- publish `frontend/dist` según contexto real;
- `PUBLIC_API_URL=https://<api-host-aprobado>` y URL pública/canonical como env no secreta;
- rewrite SPA **no necesario**: `/` y `/demo` son HTML estático generado;
- headers estáticos recomendados sin romper WASM/worklets: nosniff, referrer policy, frame ancestors/CSP probada.

No incluir secretos de proveedores en Render. Verificar que `/`, `/demo`, fonts, OG image y `/vad/*` responden 200/MIME correcto.

## 7. VPS, Uvicorn y Caddy

Archivos previstos:

- `deploy/Caddyfile.example`;
- `deploy/vslingo-api.service.example`;
- `deploy/README.md` con provisioning, deploy, rollback y health;
- `deploy/aws-polly.md` con IAM/budget de T09.

### Servicio

- usuario Linux dedicado sin shell/root;
- checkout/release directory y venv/`uv sync --frozen --no-dev` según lock;
- un worker/proceso, restart on failure, env file fuera del repo con permisos 600;
- bind `127.0.0.1:8000`, no exponer Uvicorn directo;
- graceful stop suficiente para cleanup WebSocket;
- logs de journald con allowlist ya implementada.

No copiar el `.env` local ni credenciales mediante comandos que queden en historial. Documentar backup/rollback a release anterior y prueba health antes de cambiar tráfico.

### Caddy

- dominio API aprobado con TLS automático;
- reverse proxy a loopback, soporte WebSocket por defecto;
- request body máximo coherente con endpoints (no menor que WAV contractual; no ilimitado);
- timeouts que permiten sesión WS de 900 s y respuestas HTTP, sin conexiones eternas;
- headers de seguridad y redacción de access logs (sin query sensible);
- preservar `Origin`; forwarded headers sólo desde Caddy.

Arrancar Uvicorn con proxy headers confiando exclusivamente en `127.0.0.1`/`::1`, para que rate limiting use IP real sin aceptar spoofing directo.

## 8. Variables y secretos

Documentar matriz por entorno y obligatoriedad:

- comunes: `APP_ENV`, `FRONTEND_ORIGIN`, timeouts/límites;
- OpenRouter: key/modelos/base URL;
- Polly: access key, secret, region, voice;
- Edge voice;
- frontend públicas: API URL y site/canonical.

Producción y desarrollo arrancan aunque falten credenciales de proveedores opcionales: health/readiness los marca no configurados y su invocación devuelve `provider_not_configured` controlado. Sólo una configuración estructural obligatoria e inválida —por ejemplo origen o límite fuera de rango— puede impedir el arranque con mensaje seguro. Ningún valor real en ejemplos. Rotación y revocación deben estar en runbook.

## 9. Verificación desplegada

Con autorización y recursos disponibles:

1. DNS/TLS válidos y sin mixed content;
2. `GET /api/health` por HTTPS sin secretos;
3. landing/demo por HTTPS y assets 200;
4. navegador abre WSS y fake/deterministic mode **no está habilitado en producción**;
5. CORS/Origin rechazan un origen ajeno;
6. reconexión y cleanup;
7. Chrome y Edge completan los recorridos certificados; si uno no está disponible, la verificación desplegada y T10 quedan bloqueadas;
8. revisar logs: sólo metadata.

No ejecutar Writing/Voice/YouTube live automáticamente. Los smokes de proveedor son comandos separados, uno por vez, sólo tras autorización/coste. E2E desplegado con proveedores falsos sólo es aceptable en un entorno preview aislado y explícito, nunca exponiendo un switch fake en producción pública.

## 10. Calidad consolidada

Proveer un comando/script raíz no interactivo (PowerShell compatible o documentación exacta) que ejecute:

```powershell
Set-Location backend
uv sync --frozen --all-groups
uv lock --check
uv run ruff check app tests
uv run mypy
uv run pytest

Set-Location ..\frontend
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
pnpm run build
$env:PLAYWRIGHT_HTML_OPEN = "never"
pnpm run test:e2e
```

Más `git diff --check`. CI, si se añade, usa lockfiles, caché por hash y no contiene secretos/live tests. Separar jobs backend/frontend/E2E sólo si conserva la misma cobertura.

## 11. Línea roja, cierre y handoff

Primero hacer fallar E2E por recorridos/config inexistentes, no por browsers sin instalar. Después implementar harness/fakes → recorridos → scripts → deploy files → validación local → deploy autorizado → verificación.

Criterios:

- [ ] E2E Writing, Video y Voice verdes sin red/proveedor externo.
- [ ] Voice cubre tres turnos, cuatro modos, interrupción, cambio TTS, reconexión y cleanup.
- [ ] Chrome y Edge reales completaron los recorridos certificados. Chromium puede aportar cobertura adicional, pero no sustituye ninguno; si falta un navegador, `T10`/Alpha queda pendiente con bloqueo documentado.
- [ ] Render/VPS/Caddy son reproducibles y no contienen secretos.
- [ ] HTTPS/WSS, CORS/Origin y assets VAD funcionan en destino autorizado.
- [ ] Smokes live siguen opt-in y separados.
- [ ] Todas las suites, tipos, lint, build y `git diff --check` pasan.
- [ ] `progress.md` registra resultados, URLs no sensibles, omisiones y riesgos. Sólo declara `T10`/Alpha completado cuando despliegue autorizado y validaciones obligatorias —incluidos Chrome y Edge— tienen evidencia; en otro caso conserva el incremento pendiente con bloqueo concreto.

Si no hay autorización, dominio, VPS, credenciales, Google Chrome o Microsoft Edge para las verificaciones obligatorias, no declarar T10 completo: cerrar únicamente los entregables locales y registrar el bloqueo concreto y la acción que lo desbloquea.
