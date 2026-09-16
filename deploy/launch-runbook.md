# Runbook de lanzamiento y recuperación

Este runbook cubre la parte automatizable de F7. No autoriza compras, campañas ni
uso de credenciales live. La aprobación final exige la matriz física indicada al final.

## 1. Entornos y orden de promoción

1. Mantén bases, aplicaciones PayPal, webhooks y tokens Meta separados entre staging y producción.
2. Staging usa `AUTH_MODE=clerk`, `BILLING_MODE=paypal_sandbox` y `MARKETING_MODE=disabled` o `meta_test`.
3. Verifica un solo worker/réplica y el volumen persistente de `DATABASE_PATH`.
4. Crea backup consistente antes de migrar.
5. Publica backend; sus migraciones son monotónicas. Comprueba `/api/health` y ejecuta conciliación.
6. Publica el frontend construido con el dominio API coherente.
7. Ejecuta los recorridos controlados de sesión, práctica, Cuenta y retorno PayPal.
8. Sólo después promueve configuración live y realiza una compra mínima autorizada.

No hagas rollback a la API anónima histórica ni restaures una base anterior para
deshacer una migración: eso puede perder pagos recientes. El rollback normal cambia
el release de aplicación y conserva el ledger actual.

## 2. Backup consistente

No copies el `.db` directamente: puede haber un WAL activo. Usa la API de backup de
SQLite incluida, con un destino nuevo en almacenamiento protegido:

```bash
cd backend
uv run vslingo-db backup --output /backups/ingles-al-grano-AAAA-MM-DDTHHMM.db
```

El comando rehúsa sobrescribir, crea el archivo con permisos restrictivos y ejecuta
`integrity_check`, `foreign_key_check` y verificación de esquema. Cifra los backups
fuera del host con la herramienta aprobada por el operador y limita acceso al mínimo.
Política inicial propuesta: 7 diarios, 4 semanales y 6 mensuales; el fundador debe
aprobarla según obligaciones contables y de privacidad.

## 3. Restauración ensayada y aislada

Nunca pruebes una restauración encima de producción. Crea un archivo nuevo:

```bash
cd backend
uv run vslingo-db restore-verify \
  --backup /backups/ingles-al-grano-AAAA-MM-DDTHHMM.db \
  --target /restore-check/ingles-al-grano-restored.db
```

Arranca una instancia aislada con ese `DATABASE_PATH`, otro dominio, billing fake o
sandbox y `MARKETING_MODE=disabled`. Comprueba usuarios, historial, periodos, pagos,
devoluciones y ajustes agregados con `uv run vslingo-operator-report`. No despaches
el outbox restaurado. Antes de servir una restauración real, detén escrituras, toma un
backup nuevo del estado fallido, valida el archivo restaurado y concilia PayPal.

## 4. Operación recurrente

Ejecuta con exclusión mutua desde el scheduler del host:

```bash
uv run vslingo-billing-reconcile
uv run vslingo-marketing-dispatch
uv run vslingo-operator-report
```

Alerta por fallos repetidos, eventos `uncertain`, ajustes manuales y crecimiento de
coste. Los comandos no imprimen textos de estudio, audio, tokens ni identificadores de
cuenta. Conserva logs estructurados con rotación y acceso restringido.

## 5. PWA y actualización

`sw.js` sólo precachea manifest, icono y pantalla offline. No intercepta `/api/`,
audio, video ni métodos de escritura y no registra Background Sync: una práctica o
compra fallida nunca se reenvía ocultamente. La actualización del service worker no
usa `skipWaiting`, por lo que espera a que cierren las pestañas en vez de cortar una
grabación. Al reconectar, el usuario actualiza explícitamente para revalidar sesión y saldo.

## 6. Gates manuales antes de beta paga

| Gate | Evidencia requerida |
|---|---|
| Escritorio | Chrome y Edge: instalar/desinstalar PWA, login, los tres módulos, offline/reconexión y retorno PayPal |
| Android | Chrome navegador + PWA instalada: permiso/denegación de micrófono, auriculares, bloqueo, rotación y teclado |
| iPhone | Safari navegador + Añadir a inicio: micrófono, reproducción por gesto, llamada/bloqueo y vuelta a la app |
| Pagos | Compra Sandbox autorizada y conciliada; luego una compra Live mínima autorizada, cancelación y devolución |
| Identidad | Clerk real por correo y Google, retorno al destino, logout y segundo dispositivo |
| Recuperación | Backup cifrado recuperado en entorno aislado con ledger, cuota e historial consistentes |
| Comercial | Dominio, contacto de soporte, privacidad, términos, renovación/cancelación y copy final aprobados |

Una emulación o un fake no cierra estos gates. Sin la compra Live conciliada y la
matriz física aprobada, la app puede seguir en beta orgánica pero no se declara lista
para publicidad paga.
