# Changelog

## 0.4.3

- Corrige restauración de configuración temporal del CLI sin destruir configuración del usuario.
- Corrige ejecución del runner sin `shell: true` y mejora resolución de ejecutables en Windows.
- Endurece los webviews de settings, apply y report con CSP y restricciones explícitas.
- Corrige el panel de reportes para mantener la interactividad del HTML dentro del iframe aislado.
- Corrige sincronización de workspace en escenarios multi-root y cambios de carpetas abiertas.
- Corrige listeners redundantes en el panel lateral.
- Corrige el patch del plan para editar subtareas, ramas y mensajes sin perder valores originales.
- Añade tests nativos con `node:test` para el runner.

## 0.4.2

- Añade detección de cascada comprometida vía JSON del CLI.
- Mueve artefactos generados al directorio `.pr-split-advisor`.

## 0.4.1

- Corrige rutas de artefactos y apertura de reportes.

## 0.4.0

- Añade integración opcional con Copilot desde el panel lateral.