# PR Split Advisor — VS Code Extension

<p align="center">
  <strong>Divide tus Pull Requests en piezas pequeñas, revisables y con score óptimo, sin salir de VS Code.</strong>
</p>

<p align="center">
  <img alt="VS Code Marketplace" src="https://img.shields.io/visual-studio-marketplace/v/FelixChacaliaza.pr-split-advisor-vscode?label=marketplace" />
  <img alt="Installs" src="https://img.shields.io/visual-studio-marketplace/i/FelixChacaliaza.pr-split-advisor-vscode" />
  <img alt="VS Code ≥ 1.85" src="https://img.shields.io/badge/vscode-%E2%89%A51.85-blue" />
  <img alt="Node.js ≥ 18" src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen" />
  <img alt="License" src="https://img.shields.io/badge/license-Freeware-blue" />
</p>

---

## ¿Qué hace esta extensión?

PR Split Advisor analiza el **working tree** de tu repositorio git y genera un **plan de división en Pull Requests** optimizado para facilitar la revisión de código. Todo desde el panel lateral de VS Code, sin necesidad de abrir una terminal.

El plan se genera con el CLI [`pull-request-split-advisor`](https://www.npmjs.com/package/pull-request-split-advisor) que se detecta y ejecuta automáticamente — no necesitas instalarlo manualmente.

---

## Características

### Panel lateral

- **Rama git actual** visible en tiempo real (se actualiza al hacer `checkout`)
- **Score del último análisis** con estrellas directamente en el panel
- **Badge numérico** en el ícono de la Activity Bar con la cantidad de archivos modificados
- **Selector de workspace** automático en proyectos multi-raíz
- **Auto-análisis** al cambiar de rama (configurable, desactivado por defecto)

### Análisis y plan

- **Formulario de configuración** completo: rama base, umbrales, límites de commits y archivos
- **Validación en tiempo real** del formulario antes de ejecutar (umbrales, suma de pesos, etc.)
- **Reporte HTML interactivo** abierto directamente en VS Code con plan de ramas, commits, scores y comandos git listos para copiar
- **Botón "Abrir último reporte"** para revisar un análisis anterior sin re-ejecutar
- **Score actual sin dividir** con el botón `📊 Ver score actual`
- **Métricas avanzadas** configurables: pesos de M1.3, M1.4, M1.5 y M3.2 desde el panel

### Aplicar el plan

- **Formulario de aplicación** con nombres de rama y mensajes de commit editables antes de confirmar
- **Opción de publicar ramas** en el remoto automáticamente tras aplicar (`--push`)
- **Logs en tiempo real** en el Output Channel `PR Split Advisor`
- **Comando de push agrupado** mostrado en el Output Channel si la publicación no fue automática
- **Protección de cascada**: si la rama ya tiene commits adelantados respecto a la base, el botón de aplicar se oculta automáticamente y la advertencia aparece en el reporte HTML

### Copilot IA

- **Switch "Usar Copilot IA"** en el panel de ajustes
- **Badge de estado** en verde (`● Conectado · <modelo>`) si Copilot está disponible, o en rojo (`● No disponible`) si no lo está
- Cuando está activo, inyecta `ai.provider = "copilot"` en la configuración del CLI para enriquecer mensajes de commit y nombres de rama

---

## Requisitos

| Requisito | Detalle |
|---|---|
| VS Code | ≥ 1.85 |
| Node.js | ≥ 18 con `npm` disponible en `PATH` |
| Git | Cualquier versión moderna |
| Repositorio | Con rama base accesible en el remoto |

> El CLI `pull-request-split-advisor` se detecta automáticamente vía binario global, `npx` o `npm exec`. No es necesario instalarlo manualmente.

---

## Cómo usar

### 1. Panel lateral (recomendado)

Haz clic en el ícono **PR Split Advisor** en la Activity Bar. El panel muestra:

1. La rama git actual
2. El score del último análisis
3. El formulario de configuración
4. Los botones de acción

| Botón | Acción |
|---|---|
| `📊 Ver score actual` | Score de la rama sin dividir — abre `pr-split-score.html` |
| `📄 Abrir último reporte` | Abre el último reporte HTML generado |
| `⟳ Analizar cambios` | Ejecuta el análisis completo y abre el plan |
| `⚡ Aplicar plan` | Abre el formulario de aplicación (disponible si hay plan y la cascada es válida) |

### 2. Paleta de comandos

`Ctrl+Shift+P` / `Cmd+Shift+P` y busca:

```
PR Split Advisor: Analizar cambios del working tree
PR Split Advisor: Ver score actual de la rama
```

### 3. Source Control

Los comandos también aparecen en los íconos de la barra de título del panel **Source Control** (`Ctrl+Shift+G`).

---

## Configuración

Editable desde el panel lateral o desde **Archivo → Preferencias → Configuración** buscando `PR Split Advisor`:

```jsonc
{
  // Rama base contra la que se comparan los cambios
  "prSplitAdvisor.baseBranch": "main",

  // Excluir archivos de lock del análisis
  "prSplitAdvisor.excludeLockfiles": true,

  // Líneas a partir de las que un archivo se considera grande
  "prSplitAdvisor.largeFileThreshold": 400,

  // Líneas a partir de las que un archivo se considera mediano
  "prSplitAdvisor.mediumFileThreshold": 180,

  // Máximo de archivos recomendados por commit
  "prSplitAdvisor.maxFilesPerCommit": 8,

  // Máximo ideal de líneas modificadas por commit
  "prSplitAdvisor.maxLinesPerCommitIdeal": 120,

  // Número ideal de líneas modificadas por PR
  "prSplitAdvisor.idealLinesPerPR": 99,

  // Score mínimo objetivo 1–5 para considerar el PR revisable
  "prSplitAdvisor.targetScore": 4,

  // Analizar automáticamente al detectar cambio de rama
  "prSplitAdvisor.autoAnalyzeOnBranchChange": false
}
```

### Referencia completa de opciones

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `baseBranch` | string | `"master"` | Rama base para la comparación |
| `excludeLockfiles` | boolean | `true` | Excluye `package-lock.json`, `yarn.lock`, etc. |
| `largeFileThreshold` | number | `400` | Líneas para considerar un archivo grande |
| `mediumFileThreshold` | number | `180` | Líneas para considerar un archivo mediano |
| `maxFilesPerCommit` | number | `8` | Máximo de archivos por commit |
| `maxLinesPerCommitIdeal` | number | `120` | Máximo ideal de líneas por commit |
| `idealLinesPerPR` | number | `99` | Líneas ideales por Pull Request |
| `targetScore` | number | `4` | Score mínimo objetivo (1–5) |
| `autoAnalyzeOnBranchChange` | boolean | `false` | Analizar automáticamente al cambiar de rama |
| `metricsOverride` | object | `null` | Pesos y umbrales de métricas personalizados (configurado desde el panel) |

---

## Métricas avanzadas

En el panel lateral, la sección **Métricas avanzadas** permite personalizar los pesos y umbrales de puntuación. Pulsa `🔒 Editar` para desbloquear.

| Código | Métrica | Peso default |
|---|---|---|
| M1.3 | Número de commits en el PR | 20% |
| M1.4 | Promedio de archivos por commit | 25% |
| M1.5 | Promedio de líneas por commit | 25% |
| M3.2 | Total de líneas modificadas en el PR | 30% |

> Los pesos deben sumar exactamente 1.00. El panel lo indica en tiempo real.

---

## Copilot IA

Activa el switch **🤖 Usar Copilot IA** en el panel de ajustes. La extensión verifica si GitHub Copilot está disponible en tu entorno VS Code y muestra el resultado con un badge de color:

| Estado | Badge |
|---|---|
| Copilot disponible | `● Conectado · <nombre del modelo>` (verde) |
| Copilot no disponible | `● No disponible` (rojo — el switch se desactiva automáticamente) |

Cuando está activo, se inyecta `"ai": { "enabled": true, "provider": "copilot" }` en la configuración del CLI. El CLI usa las credenciales de VS Code — no se necesita ningún token adicional.

> El proveedor `copilot` solo funciona **dentro de VS Code**. Para análisis en terminal independiente o CI/CD, usa el proveedor `groq`.

---

## Advertencia de cascada

Si la rama actual ya tiene commits adelantados respecto a la rama base (caso típico en *stacked branches*), PR Split Advisor:

1. **Genera el reporte HTML** normalmente con el plan informativo y la sección de advertencia de cascada visible
2. **Oculta el botón de aplicar** en el panel — el plan es de solo lectura
3. El reporte HTML incluye el estado completo de la cascada con las ramas hermanas numeradas y sus commits

Para volver a poder aplicar, crea una nueva rama desde el punto correcto de la cascada siguiendo la recomendación del reporte.

---

## Archivos generados

La extensión añade automáticamente al `.gitignore` los archivos generados:

| Archivo | Descripción |
|---|---|
| `.pr-split-advisor/pr-split-report.html` | Reporte del plan de división |
| `.pr-split-advisor/pr-split-score.html` | Reporte de score actual sin dividir |
| `.pr-split-advisor/pr-split-plan.json` | Plan exportado en JSON |
| `.pr-split-advisor/.pr-split-history.json` | Historial de análisis |
| `pr-split-advisor.config.json` | Configuración del CLI |

---

## Historial de versiones

| Versión | Cambios principales |
|---|---|
| **0.4.2** | Detección de cascada via JSON (`cascadeBlocked`), rutas `.pr-split-advisor/` corregidas |
| **0.4.1** | Rutas de artefactos corregidas a subdirectorio `.pr-split-advisor/` |
| **0.4.0** | Switch Copilot IA con badge de estado verde/rojo |
| **0.3.9** | Flag `isApplying` para suprimir headWatcher durante apply |
| **0.3.8** | Comando push agrupado en Output Channel, eliminación del plan tras apply |
| **0.3.7** | Eliminación automática de `pr-split-plan.json` tras apply exitoso |
| **0.3.6** | Checkbox "Publicar ramas" (`--push`), flag `autoPush` |
| **0.3.5** | Flag `--yes` para modo no interactivo en apply |
| **0.3.4** | Corrección de stdin para ramas base existentes |
| **0.3.3** | Nombres de rama y mensajes de commit editables, `patchPlanJson()` |

---

## Marketplace

[PR Split Advisor en VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FelixChacaliaza.pr-split-advisor-vscode)

---

## Licencia

© 2026 Felix Junior Chacaliaza Gutierrez — Distribuido bajo licencia freeware. Consulta [LICENSE](LICENSE) para los términos completos.


## Características

- **Panel lateral** con formulario completo de configuración
- **Rama git actual** visible en tiempo real en el panel
- **Score del último análisis** en el panel (sin abrir el reporte)
- **Score actual de la rama** sin dividir en PRs — botón dedicado `📊 Ver score actual`
- **Validación del formulario** antes de analizar (umbrales, pesos de métricas, etc.)
- **Estado de análisis** visible dentro del panel (analizando / completado / error)
- **Botón "Abrir último reporte"** para revisar un análisis anterior sin re-ejecutar
- **Badge numérico** en el ícono de la barra lateral con la cantidad de archivos cambiados
- **Selector de workspace** automático al abrir un proyecto multi-raíz
- **Auto-análisis** al cambiar de rama (configurable, desactivado por defecto)
- **Métricas avanzadas** configurables directamente desde el panel (pesos M1.3, M1.4, M1.5, M3.2)

## Requisitos

- VS Code 1.85 o superior
- Node.js 18+ y npm
- Un repositorio git con cambios pendientes respecto a la rama base

> El CLI `pull-request-split-advisor` se detecta automáticamente vía binario global, `npx` o `npm exec`.

---

## Cómo usar

### Panel lateral (recomendado)

Haz clic en el ícono de PR Split Advisor en la **Activity Bar**. El panel muestra:

1. La rama git actual (se actualiza automáticamente al hacer checkout)
2. El score del último análisis con estrellas
3. El formulario de configuración
4. Los botones de acción

Botones disponibles:

| Botón | Acción |
|---|---|
| `📊 Ver score actual` | Ejecuta `pr-split-advisor score` y abre `pr-split-score.html` |
| `📄 Abrir último reporte` | Abre el último `pr-split-report.html` generado sin re-analizar |
| `⟳ Analizar cambios` | Ejecuta el análisis completo y abre el reporte del plan |

### Paleta de comandos

`Ctrl+Shift+P` y busca:

```
PR Split Advisor: Analizar cambios del working tree
PR Split Advisor: Ver score actual de la rama
```

### Panel de Source Control

En **Source Control** (`Ctrl+Shift+G`), los comandos aparecen en los íconos de la barra de título del panel.

---

## Configuración

Edita desde el panel lateral o desde **Archivo → Preferencias → Configuración** buscando `PR Split Advisor`:

```jsonc
{
  // Rama base contra la que se comparan los cambios (default: "master")
  "prSplitAdvisor.baseBranch": "main",

  // Excluir archivos de lock del análisis (default: true)
  "prSplitAdvisor.excludeLockfiles": true,

  // Líneas a partir de las que un archivo se considera grande (default: 400)
  "prSplitAdvisor.largeFileThreshold": 400,

  // Líneas a partir de las que un archivo se considera mediano (default: 180)
  "prSplitAdvisor.mediumFileThreshold": 180,

  // Máximo de archivos recomendados por commit (default: 8)
  "prSplitAdvisor.maxFilesPerCommit": 8,

  // Máximo ideal de líneas modificadas por commit (default: 120)
  "prSplitAdvisor.maxLinesPerCommitIdeal": 120,

  // Número ideal de líneas modificadas por PR (default: 99)
  "prSplitAdvisor.idealLinesPerPR": 99,

  // Score mínimo objetivo 1–5 para considerar el PR revisable (default: 4)
  "prSplitAdvisor.targetScore": 4,

  // Auto-analizar al detectar cambio de rama git (default: false)
  "prSplitAdvisor.autoAnalyzeOnBranchChange": false
}
```

### Referencia de opciones

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `baseBranch` | string | `"master"` | Rama base para la comparación |
| `excludeLockfiles` | boolean | `true` | Excluye `package-lock.json`, `yarn.lock`, etc. |
| `largeFileThreshold` | number | `400` | Líneas para considerar un archivo grande |
| `mediumFileThreshold` | number | `180` | Líneas para considerar un archivo mediano |
| `maxFilesPerCommit` | number | `8` | Máximo de archivos por commit |
| `maxLinesPerCommitIdeal` | number | `120` | Máximo ideal de líneas por commit |
| `idealLinesPerPR` | number | `99` | Líneas ideales por Pull Request |
| `targetScore` | number | `4` | Score mínimo objetivo (1–5) |
| `autoAnalyzeOnBranchChange` | boolean | `false` | Analizar automáticamente al cambiar de rama |
| `metricsOverride` | object | `null` | Pesos y rangos de métricas personalizados (configurado desde el panel) |

---

## Métricas avanzadas

En el panel lateral, la sección **Métricas avanzadas** permite personalizar los pesos y umbrales de puntuación de cada métrica. Pulsa `🔒 Editar` para desbloquear.

| Métrica | Descripción | Peso default |
|---|---|---|
| M1.3 | Número de commits en el PR | 0.20 |
| M1.4 | Archivos por commit | 0.25 |
| M1.5 | Líneas por commit | 0.25 |
| M3.2 | Líneas totales en el PR | 0.30 |

Los pesos deben sumar 1.0. El panel lo indica en tiempo real.

---

## Archivos generados

La extensión añade automáticamente al `.gitignore` los archivos generados por el CLI:

| Archivo | Descripción |
|---|---|
| `pr-split-report.html` | Reporte del plan de división (abre en VS Code) |
| `pr-split-score.html` | Reporte del score actual sin dividir (v3.2.0+) |
| `pr-split-plan.json` | Plan exportado en JSON |
| `.advisor-history.json` | Historial de análisis |
| `.pr-split-history.json` | Historial alternativo del CLI |

---

## Marketplace

[PR Split Advisor en VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FelixChacaliaza.pr-split-advisor-vscode)

