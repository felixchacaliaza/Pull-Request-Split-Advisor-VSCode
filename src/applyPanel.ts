import * as vscode from "vscode";
import type { PlanSummary } from "./runner";

export type ApplyFormResult = {
  /** Números de subtarea en orden de aparición por commit (uno por commit) */
  subtaskNumbers: string[];
};

/**
 * Panel webview que muestra el resumen del plan con un formulario editable
 * para revisar ramas, commits y números de subtarea antes de aplicar.
 *
 * Resuelve la promesa con ApplyFormResult al confirmar, o con null al cancelar.
 */
export class ApplyPanel {
  public static currentPanel: ApplyPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _resolve!: (result: ApplyFormResult | null) => void;

  public static show(
    extensionUri: vscode.Uri,
    summary: PlanSummary,
    cascadeWarning: boolean
  ): Promise<ApplyFormResult | null> {
    return new Promise((resolve) => {
      const column = vscode.window.activeTextEditor
        ? vscode.ViewColumn.Beside
        : vscode.ViewColumn.One;

      if (ApplyPanel.currentPanel) {
        ApplyPanel.currentPanel._resolve(null);
        ApplyPanel.currentPanel._panel.dispose();
      }

      const panel = vscode.window.createWebviewPanel(
        "prSplitAdvisorApply",
        "PR Split Advisor — Aplicar plan",
        column,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      ApplyPanel.currentPanel = new ApplyPanel(panel, summary, cascadeWarning, resolve);
    });
  }

  private constructor(
    panel: vscode.WebviewPanel,
    summary: PlanSummary,
    cascadeWarning: boolean,
    resolve: (result: ApplyFormResult | null) => void
  ) {
    this._panel = panel;
    this._resolve = resolve;
    this._panel.webview.html = this._getHtml(summary, cascadeWarning);

    this._panel.webview.onDidReceiveMessage(
      (msg: { command: string; subtaskNumbers?: string[] }) => {
        if (msg.command === "apply") {
          this._resolve({ subtaskNumbers: msg.subtaskNumbers ?? [] });
          this._panel.dispose();
        } else if (msg.command === "cancel") {
          this._resolve(null);
          this._panel.dispose();
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(
      () => {
        this._resolve(null);
        ApplyPanel.currentPanel = undefined;
        this._disposables.forEach(d => d.dispose());
      },
      null,
      this._disposables
    );
  }

  private _getHtml(summary: PlanSummary, cascadeWarning: boolean): string {
    const newBranches = summary.branches.filter(b => !b.isExistingBaseBranch);

    // Construir filas de commits para cada rama
    const branchesHtml = newBranches.map((branch, bi) => {
      const commitsHtml = branch.commitPlan.map((commit, ci) => {
        // Extraer el número por defecto del mensaje (ej. FASTY-0001 → 0001)
        const matchNum = commit.suggestedMessage.match(/-(\d{4})\s/);
        const defaultNum = matchNum ? matchNum[1] : "";
        const filesStr = commit.files.join(", ");
        return /* html */`
        <tr class="commit-row">
          <td class="commit-idx">${commit.index}</td>
          <td class="commit-msg" title="${esc(commit.suggestedMessage)}">${esc(commit.suggestedMessage)}</td>
          <td class="commit-files" title="${esc(filesStr)}">${esc(filesStr)}</td>
          <td class="commit-lines">${commit.totalLines}</td>
          <td class="commit-subtask">
            <input
              class="subtask-input"
              type="text"
              data-branch="${bi}"
              data-commit="${ci}"
              value="${esc(defaultNum)}"
              placeholder="default"
              maxlength="20"
            />
          </td>
        </tr>`;
      }).join("");

      return /* html */`
      <div class="branch-card">
        <div class="branch-header">
          <span class="branch-icon">🌿</span>
          <span class="branch-name">${esc(branch.name)}</span>
          <span class="branch-meta">${branch.commits} commit${branch.commits !== 1 ? "s" : ""} · ${branch.lines} líneas · ⭐ ${branch.score}/5</span>
        </div>
        <table class="commit-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Mensaje sugerido</th>
              <th>Archivos</th>
              <th>Líneas</th>
              <th>Nro. subtarea</th>
            </tr>
          </thead>
          <tbody>
            ${commitsHtml}
          </tbody>
        </table>
      </div>`;
    }).join("");

    const warningHtml = cascadeWarning ? /* html */`
    <div class="cascade-warning">
      ⚠️ <strong>Integridad del plan en cascada comprometida.</strong>
      Este plan es de solo lectura. Crea la rama desde la base y vuelve a analizar antes de aplicar.
    </div>` : "";

    const applyBtn = cascadeWarning
      ? `<button id="btnApply" disabled class="btn-apply" title="No se puede aplicar con cascada comprometida">⚡ Aplicar plan</button>`
      : `<button id="btnApply" class="btn-apply">⚡ Aplicar plan</button>`;

    return /* html */`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Aplicar plan</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 20px;
    margin: 0;
  }
  h1 { font-size: 1.1em; margin: 0 0 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 16px; font-size: 0.9em; }
  .meta-row { display: flex; gap: 24px; margin-bottom: 16px; font-size: 0.9em; }
  .meta-row span { color: var(--vscode-descriptionForeground); }
  .meta-row strong { color: var(--vscode-foreground); }

  .cascade-warning {
    background: var(--vscode-inputValidation-warningBackground, #4d3a00);
    border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
    color: var(--vscode-inputValidation-warningForeground, #ffcc00);
    padding: 10px 14px;
    border-radius: 4px;
    margin-bottom: 16px;
    line-height: 1.5;
  }

  .branch-card {
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 4px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .branch-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    border-bottom: 1px solid var(--vscode-panel-border, #444);
  }
  .branch-name { font-weight: 600; font-family: monospace; }
  .branch-meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: auto; }

  .commit-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88em;
  }
  .commit-table th {
    text-align: left;
    padding: 6px 10px;
    background: var(--vscode-editor-background);
    color: var(--vscode-descriptionForeground);
    font-weight: 500;
    border-bottom: 1px solid var(--vscode-panel-border, #444);
    white-space: nowrap;
  }
  .commit-row td { padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border, #333); vertical-align: middle; }
  .commit-row:last-child td { border-bottom: none; }
  .commit-idx { width: 30px; color: var(--vscode-descriptionForeground); text-align: center; }
  .commit-msg { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 0.9em; }
  .commit-files { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-family: monospace; font-size: 0.85em; }
  .commit-lines { width: 60px; text-align: right; color: var(--vscode-descriptionForeground); }
  .commit-subtask { width: 110px; }

  .subtask-input {
    width: 96px;
    padding: 3px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 2px;
    font-size: 0.9em;
    font-family: monospace;
  }
  .subtask-input:focus { outline: 1px solid var(--vscode-focusBorder); }

  .actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--vscode-panel-border, #444);
  }
  .btn-apply {
    padding: 7px 20px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    border-radius: 2px;
    font-size: var(--vscode-font-size);
    font-weight: 600;
    cursor: pointer;
  }
  .btn-apply:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, #1177bb); }
  .btn-apply:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-cancel {
    padding: 7px 16px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    border-radius: 2px;
    font-size: var(--vscode-font-size);
    cursor: pointer;
  }
  .btn-cancel:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  .hint { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-left: auto; align-self: center; }
</style>
</head>
<body>
<h1>⚡ Aplicar plan de PRs</h1>
<p class="subtitle">Revisa las ramas y commits. Puedes ajustar el número de subtarea de cada commit antes de aplicar.</p>

<div class="meta-row">
  <div><span>Rama actual: </span><strong>${esc(summary.currentBranch)}</strong></div>
  <div><span>Rama base: </span><strong>${esc(summary.baseBranch)}</strong></div>
  <div><span>PRs a crear: </span><strong>${newBranches.length}</strong></div>
</div>

${warningHtml}
${branchesHtml}

<div class="actions">
  ${applyBtn}
  <button id="btnCancel" class="btn-cancel">Cancelar</button>
  <span class="hint">El campo vacío usará el número de ticket por defecto.</span>
</div>

<script>
  const vscode = acquireVsCodeApi();

  document.getElementById('btnCancel').addEventListener('click', () => {
    vscode.postMessage({ command: 'cancel' });
  });

  const applyBtn = document.getElementById('btnApply');
  if (applyBtn && !applyBtn.disabled) {
    applyBtn.addEventListener('click', () => {
      const inputs = Array.from(document.querySelectorAll('.subtask-input'));
      const subtaskNumbers = inputs.map(inp => inp.value.trim());
      vscode.postMessage({ command: 'apply', subtaskNumbers });
    });
  }
</script>
</body>
</html>`;
  }
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
