# VSLingo — Guías y Runbooks de Despliegue

Este directorio contiene las guías, plantillas y runbooks para el despliegue del frontend y backend de VSLingo en entornos de desarrollo, preview y producción.

---

## Archivos Disponibles

1. **[`dokploy-nixpacks.md`](dokploy-nixpacks.md):** Guía paso a paso para desplegar el backend FastAPI en un VPS con **Dokploy y Nixpacks** (PaaS self-hosted con SSL Traefik automático).
2. **[`Caddyfile.example`](Caddyfile.example):** Configuración de Caddy reverse proxy si prefieres desplegar directamente sobre Debian/Ubuntu en VPS sin Dokploy.
3. **[`vslingo-api.service.example`](vslingo-api.service.example):** Servicio `systemd` para ejecutar Uvicorn como demonio Linux en VPS tradicional.
4. **[`launch-runbook.md`](launch-runbook.md):** Promoción de entornos, backup/restauración consistente, operación recurrente y gates manuales de lanzamiento.

---

## Opciones de Despliegue

### Frontend (Landing estática + Workspace React)
* **PaaS Gratuita Recomendada:** Render Static Site (configurado vía [`render.yaml`](../render.yaml)) o Vercel / Cloudflare Pages.
* **Comando de Build:** `pnpm install --frozen-lockfile && pnpm run build`
* **Directorio de publicación:** `frontend/dist`
* **Variables requeridas en build:** `PUBLIC_API_URL=https://api.tu-dominio.com`,
  `PUBLIC_AUTH_MODE=clerk` y `PUBLIC_CLERK_PUBLISHABLE_KEY`.
  - Sirve REST y el WebSocket de Voice (`wss://api.tu-dominio.com/api/voice/ws`).
  - Debe definirse **antes** de `pnpm run build`; si falta, el cliente cae a `http://127.0.0.1:8000`.
  - La clave pública puede llegar al navegador; `CLERK_SECRET_KEY` y `CLERK_JWT_KEY` nunca.

### Backend (FastAPI Python)
* **Dokploy (Nixpacks):** Recomendado si usas un VPS con Dokploy. Consulta la guía [`dokploy-nixpacks.md`](dokploy-nixpacks.md).
* **VPS Linux Tradicional (Caddy + Systemd):** Consulta [`Caddyfile.example`](Caddyfile.example) y [`vslingo-api.service.example`](vslingo-api.service.example).
* Producción requiere `AUTH_MODE=clerk`, un solo worker y `DATABASE_PATH` dentro de
  un volumen persistente. La aplicación activa foreign keys, WAL y busy timeout.
* Antes de migrar o promover a producción, sigue el
  [`runbook de lanzamiento y recuperación`](launch-runbook.md); no copies el archivo
  SQLite directamente mientras WAL está activo.
