# PR Split Advisor

Analiza los cambios de tu **working tree** y sugiere cómo dividir tus cambios en Pull Requests más pequeños y fáciles de revisar.

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

