# VSLingo — Guías y Runbooks de Despliegue

Este directorio contiene las guías, plantillas y runbooks para el despliegue del frontend y backend de VSLingo en entornos de desarrollo, preview y producción.

---

## Archivos Disponibles

1. **[`dokploy-nixpacks.md`](dokploy-nixpacks.md):** Guía paso a paso para desplegar el backend FastAPI en un VPS con **Dokploy y Nixpacks** (PaaS self-hosted con SSL Traefik automático).
2. **[`aws-polly.md`](aws-polly.md):** Runbook para presupuestos AWS Billing, políticas IAM de Polly Neural y límites de gasto en OpenRouter.
3. **[`Caddyfile.example`](Caddyfile.example):** Configuración de Caddy reverse proxy si prefieres desplegar directamente sobre Debian/Ubuntu en VPS sin Dokploy.
4. **[`vslingo-api.service.example`](vslingo-api.service.example):** Servicio `systemd` para ejecutar Uvicorn como demonio Linux en VPS tradicional.

---

## Opciones de Despliegue

### Frontend (Landing estática + Workspace React)
* **PaaS Gratuita Recomendada:** Render Static Site (configurado vía [`render.yaml`](../render.yaml)) o Vercel / Cloudflare Pages.
* **Comando de Build:** `pnpm install --frozen-lockfile && pnpm run build`
* **Directorio de publicación:** `frontend/dist`
* **Variable de entorno requerida (build-time):** `PUBLIC_API_URL=https://api.tu-dominio.com`
  - Sirve REST y el WebSocket de Voice (`wss://api.tu-dominio.com/api/voice/ws`).
  - Debe definirse **antes** de `pnpm run build`; si falta, el cliente cae a `http://127.0.0.1:8000`.

### Backend (FastAPI Python)
* **Dokploy (Nixpacks):** Recomendado si usas un VPS con Dokploy. Consulta la guía [`dokploy-nixpacks.md`](dokploy-nixpacks.md).
* **VPS Linux Tradicional (Caddy + Systemd):** Consulta [`Caddyfile.example`](Caddyfile.example) y [`vslingo-api.service.example`](vslingo-api.service.example).
