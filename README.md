# PR Split Advisor for VS Code

PR Split Advisor analiza tu working tree y propone cómo dividir tus cambios en Pull Requests pequeños, revisables y aplicables sin salir de VS Code.

## Características

- Panel lateral dedicado en la Activity Bar.
- Score actual de la rama y score del último análisis.
- Reporte HTML interactivo para score y plan completo.
- Apply guiado con edición de ramas, commits y subtareas antes de ejecutar.
- Soporte multi-root con selección de workspace.
- Protección para cascadas de ramas comprometidas.
- Métricas avanzadas configurables desde el panel.
- Integración opcional con Copilot desde VS Code.

## Requisitos

- VS Code 1.85 o superior.
- Node.js 18 o superior.
- npm disponible en PATH.
- Repositorio git válido con acceso a la rama base.

La extensión resuelve el CLI automáticamente en este orden:

1. `pr-split-advisor`
2. `npx`
3. `npm exec`

## Uso

### Panel lateral

Abre PR Split Advisor desde la Activity Bar. Desde el panel puedes:

- Ver la rama actual.
- Ver el score del último análisis.
- Configurar umbrales y rama base.
- Ejecutar score o análisis.
- Abrir el último reporte.
- Aplicar un plan existente.

### Botones principales

| Botón | Acción |
| --- | --- |
| Ver score actual | Genera `.pr-split-advisor/pr-split-score.html`. |
| Analizar cambios | Genera el plan completo y abre el reporte. |
| Abrir último reporte | Reabre el último reporte generado sin recalcular. |
| Aplicar plan | Abre el formulario de confirmación y edición antes del apply. |

### Apply del plan

Cuando existe un plan válido, el formulario de apply permite:

- Editar nombres de rama.
- Editar mensajes de commit.
- Ajustar números de subtarea.
- Publicar ramas automáticamente al remoto.

Si la extensión detecta una cascada comprometida, el plan queda en modo informativo y la aplicación se bloquea.

## Configuración

Todas las opciones usan el prefijo `prSplitAdvisor`.

| Clave | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `prSplitAdvisor.baseBranch` | string | `master` | Rama base contra la que se comparan los cambios. |
| `prSplitAdvisor.excludeLockfiles` | boolean | `true` | Excluye lockfiles del análisis. |
| `prSplitAdvisor.largeFileThreshold` | number | `400` | Umbral para considerar un archivo grande. |
| `prSplitAdvisor.mediumFileThreshold` | number | `180` | Umbral para considerar un archivo mediano. |
| `prSplitAdvisor.maxFilesPerCommit` | number | `8` | Máximo recomendado de archivos por commit. |
| `prSplitAdvisor.maxLinesPerCommitIdeal` | number | `120` | Máximo ideal de líneas por commit. |
| `prSplitAdvisor.idealLinesPerPR` | number | `99` | Tamaño ideal del PR en líneas. |
| `prSplitAdvisor.targetScore` | number | `4` | Score objetivo de revisabilidad. |
| `prSplitAdvisor.metricsOverride` | object \| null | `null` | Override de pesos y thresholds de métricas. |
| `prSplitAdvisor.autoAnalyzeOnBranchChange` | boolean | `false` | Ejecuta análisis automático al hacer checkout. |

### Ejemplo

```json
{
  "prSplitAdvisor.baseBranch": "main",
  "prSplitAdvisor.excludeLockfiles": true,
  "prSplitAdvisor.largeFileThreshold": 400,
  "prSplitAdvisor.mediumFileThreshold": 180,
  "prSplitAdvisor.maxFilesPerCommit": 8,
  "prSplitAdvisor.maxLinesPerCommitIdeal": 120,
  "prSplitAdvisor.idealLinesPerPR": 99,
  "prSplitAdvisor.targetScore": 4,
  "prSplitAdvisor.autoAnalyzeOnBranchChange": false
}
```

## Métricas avanzadas

El panel permite personalizar pesos y thresholds para:

- M1.3: commits por PR.
- M1.4: archivos por commit.
- M1.5: líneas por commit.
- M3.2: líneas totales por PR.

La suma de pesos debe ser `1.00`.

## Copilot IA

La opción `Usar Copilot IA`:

- Verifica si hay modelos de Copilot disponibles dentro de VS Code.
- Muestra el estado en el panel.
- Inyecta la configuración AI del CLI durante el análisis.

Si Copilot no está disponible, la opción se desactiva automáticamente.

## Archivos generados

La extensión usa y añade al `.gitignore` estas rutas cuando faltan:

- `.pr-split-advisor/pr-split-report.html`
- `.pr-split-advisor/pr-split-score.html`
- `.pr-split-advisor/pr-split-plan.json`
- `.pr-split-advisor/.pr-split-history.json`
- `.advisor-history.json`
- `pr-split-advisor.config.json`

## Compatibilidad con el CLI

La extensión trata `.pr-split-advisor/pr-split-plan.json` como contrato de integración estable.

- Soporta el contrato legacy sin `contractVersion` y el contrato explícito `contractVersion: 2`.
- Si detecta una versión de contrato más nueva, bloquea Apply y muestra un error claro para evitar operar sobre un esquema no soportado.
- Para aprovechar la explicación estructurada por rama y el catálogo de métricas, usa CLI `pull-request-split-advisor` 3.2.34 o superior.

## Calidad y seguridad

- Webviews con CSP y restricciones explícitas.
- Reporte HTML aislado en webview.
- Configuración por workspace cuando corresponde.
- Watcher de `.git/HEAD` filtrado por workspace.
- Protección contra applies concurrentes.
- Tests nativos con `node:test` para el runner.

## Desarrollo

### Compilar

```bash
npm run compile
```

### Tests

```bash
npm test
```

### Empaquetar la extensión

```bash
npm run package
```

## Marketplace

https://marketplace.visualstudio.com/items?itemName=FelixChacaliaza.pr-split-advisor-vscode

## Licencia

Consulta LICENSE.