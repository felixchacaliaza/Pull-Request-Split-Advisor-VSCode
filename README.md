# PR Split Advisor

Analiza los cambios de tu **working tree** y sugiere cómo dividir tus cambios en Pull Requests más pequeños y fáciles de revisar.

## Requisitos

- VS Code 1.85 o superior
- Node.js y npm instalados
- Un repositorio git con cambios pendientes

> El CLI `pull-request-advisor` se instala automáticamente la primera vez que ejecutas el análisis.

---

## Cómo usar

### Opción 1 — Barra lateral

Haz clic en el ícono de PR Split Advisor en la **Activity Bar** (barra lateral izquierda de VS Code) y luego pulsa el botón **Analizar cambios**.

### Opción 2 — Panel de Source Control

En el panel de **Source Control** (`Ctrl+Shift+G`), pulsa el ícono de pull request que aparece en la barra de título del panel.

### Opción 3 — Paleta de comandos

Abre la paleta con `Ctrl+Shift+P` y busca:

```
PR Split Advisor: Analizar cambios del working tree
```

---

## Configuración

No se necesitan archivos de configuración en el proyecto. Todas las opciones se gestionan directamente desde VS Code.

Ve a **Archivo → Preferencias → Configuración** (`Ctrl+,`) y busca **"PR Split Advisor"**, o edita tu `settings.json` directamente:

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
  "prSplitAdvisor.targetScore": 4
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

---

## Archivos generados

Al ejecutar el análisis, el CLI genera los siguientes archivos en la raíz del proyecto. La extensión los añade automáticamente al `.gitignore` para que no se versionen:

| Archivo | Descripción |
|---|---|
| `pr-split-report.html` | Reporte visual que se abre en VS Code |
| `pr-split-plan.json` | Plan de división exportado en JSON |
| `.advisor-history.json` | Historial de análisis del CLI |
| `.pr-split-history.json` | Historial alternativo generado por el CLI |

---

## Resultado

Al ejecutar el análisis se abre un panel con el reporte en HTML que incluye:

- **Score** del working tree actual (1–5)
- **Sugerencias** de cómo dividir los cambios en PRs
- **Detalle** de archivos y commits analizados
- **Recomendaciones** según las métricas configuradas

---

## Marketplace

[PR Split Advisor en VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FelixChacaliaza.pr-split-advisor-vscode)
