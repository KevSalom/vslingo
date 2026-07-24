# Guía de Despliegue Backend en Dokploy con Nixpacks (VPS)

Este documento describe el procedimiento paso a paso para desplegar el backend FastAPI de VSLingo en tu propio VPS utilizando **Dokploy** y **Nixpacks**.

---

## 1. Requisitos Previos en Dokploy

1. Tener un panel de **Dokploy** instalado y funcionando en tu VPS.
2. Tener un subdominio apuntado hacia la IP de tu VPS (ejemplo: `api.vslingo.app` en tu proveedor DNS como Cloudflare).
3. Repositorio de VSLingo conectado a Dokploy (vía GitHub, GitLab o Git genérico).

---

## 2. Creación del Aplicativo en Dokploy

1. En el panel de Dokploy, ve a **Projects** (o crea uno llamado `VSLingo`).
2. Selecciona **Create Application**.
3. Elige la fuente de código: **GitHub** (o Git Repository) y selecciona el repositorio de `vslingo`.
4. Elige la rama de producción (`main` o `master`).

---

## 3. Configuración de Construcción (Build Settings)

Configura los parámetros de compilación en el tab **General** / **Build**:

* **Build Type:** `Nixpacks`
* **Root Directory:** `backend` *(¡Muy importante! Apunta al subdirectorio backend)*
* **Port:** `8000`
* **Health Check Path:** `/api/health`

### Archivo `nixpacks.toml` opcional (en `backend/nixpacks.toml` si requiere comando personalizado)

Nixpacks detecta automáticamente Python y `uv`/`pip`. El comando de inicio que utilizará es:

```toml
[start]
cmd = "uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"
```

---

## 4. Variables de Entorno en Dokploy

En la pestaña **Environment Variables** de tu aplicación en Dokploy, añade las siguientes variables:

```dotenv
APP_ENV=production
FRONTEND_ORIGIN=https://tu-frontend-subdomain.pages.dev  # O el dominio exacto de tu frontend en Render/Vercel
PORT=8000

# Proveedor OpenRouter (Whisper STT y LLM)
OPENROUTER_API_KEY=sk-or-v1-tu-clave-aqui
OPENROUTER_STT_MODEL=openai/whisper-large-v3-turbo

# Proveedor AWS Polly (TTS) - Opcional si usas Edge TTS
AWS_ACCESS_KEY_ID=tu-aws-access-key
AWS_SECRET_ACCESS_KEY=tu-aws-secret-key
AWS_REGION=us-east-1
AWS_POLLY_VOICE_ID=Matthew

# Proveedor Edge TTS (Gratuito)
EDGE_TTS_VOICE=en-US-GuyNeural

# Tiempos de espera y límites
PROVIDER_TIMEOUT_SECONDS=30.0
PROVIDER_ACQUIRE_TIMEOUT_SECONDS=1.0
MAX_HTTP_REQUESTS_PER_MINUTE=30
MAX_SPEECH_REQUESTS_PER_MINUTE=10
MAX_WS_CONNECTIONS=20
MAX_WS_CONNECTIONS_PER_IP=2
```

---

## 5. Dominio, SSL y WebSocket (Traefik)

1. Ve a la pestaña **Domains** en Dokploy.
2. Añade tu subdominio (ejemplo: `api.vslingo.app`).
3. Activa la casilla de **HTTPS / SSL Certificate** (Dokploy genera el certificado con Let's Encrypt automáticamente).
4. El puerto de destino debe ser `8000`.
5. Traefik (el proxy interno de Dokploy) soporta conexiones WebSocket (`wss://api.vslingo.app/api/voice/ws`) de forma nativa sin configuración adicional.

---

## 6. Despliegue y Verificación

1. Haz clic en **Deploy**.
2. Inspecciona los logs de compilación en Dokploy.
3. Una vez finalizado, verifica la salud del backend desde tu navegador o terminal:
   ```bash
   curl -i https://api.vslingo.app/api/health
   ```
   Debe responder `200 OK` con JSON libre de secretos:
   ```json
   {
     "status": "ok",
     "service": "VSLingo API",
     "version": "0.1.0",
     "environment": "production",
     "providers": { ... }
   }
   ```
