# `T08` — Sistema visual y landing

[Índice](README.md) · [Producto](../product-spec.md) · [Plan](../implementation-plan.md) · [Estado](../progress.md)

## 1. Objetivo y entrada

Aplicar la identidad aprobada a landing y workspace sin alterar los recorridos T02–T07. La interfaz debe sentirse como una herramienta profesional de comunicación técnica, no una copia de VS Code ni una plantilla SaaS genérica.

Comenzar sólo con Voice funcional (`T07` cerrado) y `progress.md` en `T08`. Antes de diseñar/codificar, releer las skills `frontend-design`, `tailwind-design-system` y `vercel-react-best-practices`.

## 2. Dirección cerrada

### Sujeto, audiencia y trabajo de cada página

- Sujeto: practicar cómo un desarrollador explica, escribe y comprende inglés profesional.
- Audiencia: desarrolladores hispanohablantes B1-B2.
- Landing: explicar valor y llevar a “Probar demo”.
- Workspace: permitir elegir módulo y practicar sin registro ni distracciones.

### Firma visual

Una única línea de audio se transforma en marcas de diff. En landing aparece en el hero como demostración estática/CSS; en Voice aparece en el panel inferior vinculada a señal y feedback real. Es la única licencia expresiva fuerte. No repartir glows, gradientes, blobs, grids decorativos o animaciones por toda la UI.

### Tokens obligatorios

Definirlos en Tailwind v4 con `@theme`/variables CSS semánticas, no en `tailwind.config.*`:

| Token semántico | Base |
| --- | --- |
| ink/background | `#090D12` |
| editor | `#111820` |
| panel | `#18212C` |
| primary/cyan | `#22D3EE` |
| secondary/violet | `#8B5CF6` |
| aws | `#FF9900` |
| diff-added | verde accesible, reservado a inserciones/éxito |
| diff-removed | rojo accesible, reservado a eliminaciones/error |

Derivar foreground, muted, border, focus y estados con contraste WCAG AA. Cyan no se usa como texto pequeño sobre blanco; verde/rojo nunca son decoración ni único indicador.

Radios contenidos (4–12 px), bordes de 1 px y sombras mínimas. Evitar el abuso actual de tarjetas redondeadas anidadas.

### Tipografía

- Sora Variable: `h1`/titulares de producto.
- IBM Plex Sans: body, controles y navegación.
- JetBrains Mono: transcript, diff, código, métricas, labels de archivo.

Servir fuentes localmente. Preferir paquetes Fontsource fijados a versión exacta o WOFF2 versionados con licencia; no hotlink a Google/CDN. `font-display: swap`, subsets necesarios y preload sólo de pesos críticos de landing.

## 3. Arquitectura de UI

Crear primitives pequeños sólo cuando haya dos usos reales: `Button`, `Panel`, `StatusBadge`, `Field`, `ErrorNotice`, `DiffText`; no construir una librería genérica ni añadir framework de componentes.

### Workspace desktop

```text
┌ activity bar 56 ┬ explorer/modules 224 ┬ editor/module flexible ┐
│ logo + 3 icons  │ módulo + descripción │ flujo activo           │
│ settings/status│ privacidad local      │                        │
├─────────────────┴──────────────────────┴────────────────────────┤
│ panel inferior: Voice señal/estado/métricas disponibles         │
└─────────────────────────────────────────────────────────────────┘
```

- Activity bar cambia entre Voice, Writing y Video; icono + label accesible/tooltip, `aria-current`.
- Explorer muestra contexto del módulo, no un árbol falso de archivos.
- Editor contiene la función existente sin esconder acciones primarias.
- Panel inferior es contextual; no inventa terminal ni controles falsos.

Tablet colapsa explorer; móvil (<768 px) usa navegación horizontal/menú accesible y flujo de una columna. Responsive no implica certificar micrófono móvil.

Mantener foco al cambiar módulo: moverlo al `h1` del módulo mediante patrón accesible, sin scroll inesperado. Soportar teclado completo, focus ring visible y targets >=44 px en controles primarios.

### Componentes existentes

Refactorizar estilos, no lógica. Writing conserva editor, resultado, diff, feedback, copiar/limpiar/TTS. Video conserva player/fixture, transcript, vistas, seek, biblioteca/notas. Voice conserva escenarios, VAD/PTT, respuesta, feedback, proveedor y cancelación. Ninguna acción debe desaparecer por estética.

Cargar Voice mediante `React.lazy(() => import(...))` o frontera dinámica equivalente sólo cuando se activa; no importar el módulo VAD desde el entry compartido. Mostrar fallback accesible estable. No introducir barrel imports que incorporen Voice al bundle inicial.

## 4. Landing estática

`index.astro` debe seguir sin island React ni script de aplicación. Orden y contenido:

1. **Header:** marca, enlace “Cómo funciona”, CTA “Probar demo”.
2. **Hero:** badge “Public Alpha”, título orientado al beneficio, explicación en español, CTA primario `/demo`, nota “Sin registro”, firma waveform→diff.
3. **Prueba del producto:** un diff realista de Daily Standup, no lorem ipsum ni métricas inventadas.
4. **Tres módulos:** Voice prioritario; Writing y Video descritos de forma concreta sin afirmar funciones fuera de Alpha.
5. **Pipeline:** navegador/VAD → STT → conversación+feedback → TTS; indicar proveedores terceros.
6. **AWS:** Polly Neural como integración oficial y selector Edge como alternativa; no llamar Azure a Edge.
7. **Privacidad:** procesamiento efímero, estado local, terceros, sin audio en disco; no prometer privacidad absoluta.
8. **CTA final** “Probar demo”.
9. **Footer:** estado Alpha y enlaces internos/documentales aplicables, sin pricing.

Copy en voz activa, español directo y sin claims no medidos (“fluido”, “instantáneo”, “seguro al 100%”). Conversaciones/ejemplos en inglés B1-B2.

## 5. SEO y documento

En landing:

- `<html lang="es">`, title único <=60 caracteres y description útil <=160;
- canonical construida desde `site` configurado para producción; si falta URL de producción, usar una variable obligatoria de build documentada, no inventar dominio;
- Open Graph: title, description, type `website`, canonical URL e imagen local 1200×630 con alt;
- Twitter card `summary_large_image`;
- favicon/manifest sólo si existen assets reales;
- JSON-LD `SoftwareApplication` con `name`, `applicationCategory: EducationalApplication`, `operatingSystem: Web`, `description`, `url`, `inLanguage: es`; no incluir rating, offers ni precio;
- un solo `h1`, landmarks y enlaces rastreables.

Demo debe usar `noindex` sólo si la decisión de despliegue lo requiere; no añadirlo por defecto. Ningún metadato afirma autenticación, sincronización o soporte móvil certificado.

## 6. Movimiento, accesibilidad y rendimiento

- Firma hero: una animación CSS coordinada máxima; no loop agresivo. Con reduced motion, mostrar estado final estático.
- Todas las transiciones bajo 250 ms y sólo opacity/transform cuando sea posible.
- Contraste AA, zoom 200%, viewport 320 px sin overflow horizontal, orden de tab lógico.
- Iconos decorativos `aria-hidden`; controles con nombre accesible. Errores con `role=alert`; estados no urgentes `aria-live=polite`.
- No autoplay de audio/vídeo; no movimiento que dependa del scroll para revelar contenido esencial.
- Landing mayormente HTML/CSS y sin código Voice. Optimizar fuentes/imágenes, reservar dimensiones y evitar CLS.

Objetivo Lighthouse obligatorio: >=90 en Performance, Accessibility y SEO sobre build de producción. Añadir `@lhci/cli` como dependencia de desarrollo fijada a versión exacta, un script no interactivo `audit:lighthouse` y configuración con assertions `minScore: 0.90` para esas tres categorías sobre la landing servida por `astro preview`. Si Chrome/Lighthouse no puede ejecutarse, `T08` queda pendiente/bloqueado; registrar la causa no equivale a satisfacer el criterio ni autoriza mover `progress.md` a `T09`.

## 7. Proceso obligatorio

Antes de código, añadir a la evidencia de trabajo (no necesariamente un archivo permanente) un plan breve:

- paleta/token roles;
- escala tipográfica;
- wireframe landing/workspace;
- firma waveform→diff;
- autocrítica contra defaults genéricos y ajuste realizado.

Después:

1. tests de semántica/navegación y tokens en rojo;
2. fuentes/tokens/base;
3. primitives mínimos;
4. shell workspace responsive sin cambiar lógica;
5. módulos uno a uno con tests verdes;
6. landing estática/SEO;
7. lazy Voice y análisis de build;
8. revisión visual en 320, 768, 1280 y 1440 px, dark scheme y reduced motion.

Usar screenshots sólo como evidencia visual; no sustituir assertions semánticos.

## 8. Archivos previstos

- `frontend/src/styles/global.css` y, si aporta claridad, hojas por tokens/componentes.
- fuentes/assets bajo `frontend/src/assets` o `public` con licencia.
- `frontend/src/components/ui/*`, sólo primitives usados.
- `frontend/src/components/landing/*` Astro.
- `frontend/src/components/DemoWorkspace.tsx` y componentes del shell.
- `frontend/src/pages/index.astro`, `demo.astro`, `astro.config.mjs`.
- tests existentes y nuevos de navegación/a11y/metadata.

No tocar backend, API, protocolo, dependencias Python ni lógica de proveedores. Las únicas dependencias nuevas admisibles son fuentes locales justificadas y `@lhci/cli` para la auditoría obligatoria; todas se instalan mediante pnpm con versión exacta y lockfile reproducible.

## 9. Línea roja y aceptación

Pruebas antes de implementar:

- navegación por módulo con roles/`aria-current`/foco;
- todos los recorridos previos conservan controles;
- reduced motion y fallback de lazy Voice;
- landing contiene secciones/CTA/copy requeridos y no monta islands;
- title/description/canonical/OG/JSON-LD válidos;
- build no incorpora VAD en chunk/JS inicial de landing;
- storage y lógica funcional no se regresan.

Cierre:

- [ ] Identidad usa tokens/tipografías aprobados y una sola firma visual.
- [ ] Landing estática contiene las nueve áreas y CTA funcional.
- [ ] Workspace es usable por teclado y responsive a 320 px.
- [ ] Voice se carga bajo demanda; landing no carga su JS.
- [ ] Writing, Video y Voice conservan pruebas y acciones.
- [ ] Reduced motion y errores/estados son accesibles.
- [ ] SEO/OG/JSON-LD describen sólo funciones reales.
- [ ] Lighthouse >=90 en Performance, Accessibility y SEO se ejecutó con `audit:lighthouse`; una ejecución omitida o fallida bloquea el cierre.

Ejecutar `pnpm install --frozen-lockfile`, `pnpm run quality`, `pnpm run audit:lighthouse`, revisión de chunks, `git diff --check` y revisión visual no interactiva/manual aplicable. No ejecutar backend si no cambió. Registrar evidencia y mover `progress.md` a `T09` sólo al cerrar.
