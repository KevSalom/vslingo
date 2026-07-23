# Especificaciones operativas por incremento

[Volver al README](../../README.md) · [Especificación de producto](../product-spec.md) · [Plan](../implementation-plan.md) · [Estado](../progress.md)

Este directorio convierte los incrementos pendientes del roadmap en instrucciones de ejecución verificables. Cada archivo describe **un solo incremento** y debe leerse únicamente cuando [`progress.md`](../progress.md) indique ese identificador como próximo trabajo, salvo que el usuario solicite expresamente un subconjunto documental.

## Autoridad y precedencia

Estas especificaciones son derivadas, no una nueva fuente de decisiones de producto. El orden de autoridad es:

1. [`product-spec.md`](../product-spec.md): producto, arquitectura, contratos aprobados y restricciones.
2. [`implementation-plan.md`](../implementation-plan.md): orden y frontera estable de `T01`–`T10`.
3. [`progress.md`](../progress.md): implementación real, próximo incremento, bloqueos y evidencia.
4. El archivo de este directorio correspondiente al incremento activo: receta operativa, decisiones cerradas y criterios verificables.
5. Código y pruebas existentes: baseline que debe inspeccionarse, no autoridad para cambiar el producto.

Si una spec contradice cualquiera de las tres primeras fuentes, el agente **no debe elegir una interpretación**: debe detenerse, citar ambos fragmentos y pedir una decisión. Si el árbol cambió desde la redacción, debe adaptar rutas y nombres conservando contratos y alcance; no debe recrear una estructura obsoleta sólo porque aparezca aquí.

## Uso obligatorio

1. Confirmar el próximo incremento en `progress.md`.
2. Leer las fuentes en el orden exigido por [`AGENTS.md`](../../AGENTS.md).
3. Abrir la spec exacta del incremento y sus dependencias ya completadas.
4. Inspeccionar los archivos y pruebas indicados antes de crear o renombrar nada.
5. Ejecutar la línea roja descrita y conservar evidencia real de su causa.
6. Implementar el mínimo recorrido completo; no adelantar trabajo de la spec siguiente.
7. Ejecutar las validaciones de cierre y actualizar `progress.md` sólo con resultados observados.

Las rutas de archivos marcadas como “previstas” expresan ubicación y responsabilidad, no autorizan a sobrescribir trabajo posterior ni a mantener archivos artificialmente si el árbol ya ofrece una ubicación equivalente.

## Índice

| Incremento | Especificación | Dependencia obligatoria | Resultado demostrable |
| --- | --- | --- | --- |
| `T04` | [`T04-tts-compartido.md`](T04-tts-compartido.md) | `T03` | Writing reproduce MP3 con Polly o Edge, sin fallback |
| `T05` | [`T05-protocolo-voice-ptt-stt.md`](T05-protocolo-voice-ptt-stt.md) | `T04` | PTT produce `transcript.final` por WebSocket |
| `T06` | [`T06-conversacion-feedback.md`](T06-conversacion-feedback.md) | `T05` | Conversación streaming y feedback independiente |
| `T07` | [`T07-vad-audio-interrupcion.md`](T07-vad-audio-interrupcion.md) | `T06` | VAD, audio ordenado y barge-in cancelable |
| `T08` | [`T08-sistema-visual-landing.md`](T08-sistema-visual-landing.md) | `T07` | Identidad completa, landing y workspace accesibles |
| `T09` | [`T09-seguridad-costes-observabilidad.md`](T09-seguridad-costes-observabilidad.md) | `T08` | Límites, telemetría y protección de presupuesto |
| `T10` | [`T10-integracion-despliegue.md`](T10-integracion-despliegue.md) | `T09` | E2E determinista y despliegue reproducible |

## Convenciones comunes

- **MUST / debe:** requisito de aceptación; omitirlo impide cerrar el incremento.
- **No alcance:** trabajo prohibido en ese incremento, aunque aparezca en una spec posterior.
- **Línea roja:** pruebas que deben fallar primero por ausencia del comportamiento, no por errores de instalación o sintaxis.
- **Pruebas live:** siempre opt-in, una integración por ejecución, con autorización, credenciales y coste conocido. Nunca sustituyen pruebas deterministas.
- **Handoff:** lista de cambios, evidencia ejecutada, omisiones, riesgos, bloqueos y siguiente incremento. No declarar resultados no ejecutados.
