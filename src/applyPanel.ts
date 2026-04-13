import * as vscode from "vscode";
import type { PlanSummary } from "./runner";

export type ApplyFormResult = {
  /** Números de subtarea en orden de aparición por commit (uno por commit) */
  subtaskNumbers: string[];
  /** Nombres de rama editados (uno por rama nueva, en orden) */
  branchNames: string[];
  /** Mensajes de commit editados (aplanados en orden: rama0-commit0, rama0-commit1, rama1-commit0 ...) */
  commitMessages: string[];
  /** Si true, publicar las ramas en el remoto tras aplicar */
  pushBranches: boolean;
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

  // B12 FIX: eliminado parámetro `extensionUri` que nunca se usaba.
  public static show(
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
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          enableCommandUris: false,
          localResourceRoots: [],
        }
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
      (msg: { command: string; subtaskNumbers?: string[]; branchNames?: string[]; commitMessages?: string[]; pushBranches?: boolean }) => {
        if (msg.command === "apply") {
          // B13 FIX: anular _resolve tras el primer uso para que onDidDispose
          // (que siempre se dispara después del dispose()) no llame al resolver
          // por segunda vez con null.
          const resolveOnce = this._resolve;
          this._resolve = () => { /* no-op */ };
          resolveOnce({
            subtaskNumbers:  msg.subtaskNumbers  ?? [],
            branchNames:     msg.branchNames     ?? [],
            commitMessages:  msg.commitMessages  ?? [],
            pushBranches:    msg.pushBranches    ?? false,
          });
          this._panel.dispose();
        } else if (msg.command === "cancel") {
          const resolveOnce = this._resolve;
          this._resolve = () => { /* no-op */ };
          resolveOnce(null);
          this._panel.dispose();
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(
      () => {
        // Llamar _resolve(null) solo si no fue invocado ya desde el handler de mensaje.
        // Si el usuario hizo click en Aplicar/Cancelar, _resolve ya es no-op aquí.
        this._resolve(null);
        ApplyPanel.currentPanel = undefined;
        this._disposables.forEach(d => d.dispose());
      },
      null,
      this._disposables
    );
  }

  private _getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  private _getHtml(summary: PlanSummary, cascadeWarning: boolean): string {
    const newBranches = summary.branches.filter(b => !b.isExistingBaseBranch);
    const nonce = this._getNonce();

    // Construir filas de commits para cada rama
    const branchesHtml = newBranches.map((branch, bi) => {
      const commitsHtml = branch.commitPlan.map((commit, ci) => {
        // B7 FIX: usar \b (word boundary) en lugar de \s para que el match
        // funcione también cuando el número de ticket está al final del mensaje.
        // Antes: /-(\d{4})\s/ fallaba con "feat(x): subject TEAM-0001" (sin espacio al final).
        const matchNum = commit.suggestedMessage.match(/-(\d{4})\b/);
        const defaultNum = matchNum ? matchNum[1] : "";
        const filesStr = commit.files.join(", ");
        return /* html */`
        <tr class="commit-row">
          <td class="commit-idx">${commit.index}</td>
          <td class="commit-msg-cell">
            <input
              class="commit-msg-input"
              type="text"
              data-branch="${bi}"
              data-commit="${ci}"
              data-field="msg"
              value="${esc(commit.suggestedMessage)}"
              title="${esc(commit.suggestedMessage)}"
            />
          </td>
          <td class="commit-files" title="${esc(filesStr)}">${esc(filesStr)}</td>
          <td class="commit-lines">${commit.totalLines}</td>
          <td class="commit-subtask">
            <input
              class="subtask-input"
              type="text"
              data-branch="${bi}"
              data-commit="${ci}"
              data-field="subtask"
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
          <input
            class="branch-name-input"
            type="text"
            data-branch="${bi}"
            value="${esc(branch.name)}"
            title="${esc(branch.name)}"
          />
          <span class="branch-meta">${branch.commits} commit${branch.commits !== 1 ? "s" : ""} · ${branch.lines} líneas · ⭐ ${branch.score}/5</span>
        </div>
        <table class="commit-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Mensaje de commit</th>
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';">
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
  .branch-name-input {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
    color: var(--vscode-foreground);
    font-weight: 600;
    font-family: monospace;
    font-size: inherit;
    padding: 1px 4px;
    min-width: 0;
  }
  .branch-name-input:focus {
    border-bottom-color: var(--vscode-focusBorder);
    outline: none;
    background: var(--vscode-input-background);
  }
  .branch-meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: auto; white-space: nowrap; }

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
  .commit-msg-cell { max-width: 320px; padding: 4px 10px; }
  .commit-msg-input {
    width: 100%;
    box-sizing: border-box;
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
    color: var(--vscode-foreground);
    font-family: monospace;
    font-size: 0.9em;
    padding: 1px 4px;
  }
  .commit-msg-input:focus {
    border-bottom-color: var(--vscode-focusBorder);
    outline: none;
    background: var(--vscode-input-background);
  }
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
  .push-option {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    padding: 8px 12px;
    background: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e);
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 3px;
    font-size: 0.9em;
    cursor: pointer;
    user-select: none;
  }
  .push-option input[type=checkbox] { cursor: pointer; width: 14px; height: 14px; }
  .push-option label { cursor: pointer; }
  .push-option .push-hint { color: var(--vscode-descriptionForeground); font-size: 0.82em; margin-left: 4px; }
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

${cascadeWarning ? "" : `
<div class="push-option">
  <input type="checkbox" id="chkPush" />
  <label for="chkPush">Publicar ramas en remoto tras aplicar</label>
  <span class="push-hint">(git push para cada rama creada)</span>
</div>`}

<div class="actions">
  ${applyBtn}
  <button id="btnCancel" class="btn-cancel">Cancelar</button>
  <span class="hint">El campo vacío usará el número de ticket por defecto.</span>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  document.getElementById('btnCancel').addEventListener('click', () => {
    vscode.postMessage({ command: 'cancel' });
  });

  const applyBtn = document.getElementById('btnApply');
  if (applyBtn && !applyBtn.disabled) {
    applyBtn.addEventListener('click', () => {
      // subtaskNumbers — plano, en orden de aparición
      const subtaskNumbers = Array.from(document.querySelectorAll('.subtask-input'))
        .map(inp => inp.value.trim());

      // branchNames — uno por rama nueva, en orden
      const branchNames = Array.from(document.querySelectorAll('.branch-name-input'))
        .map(inp => inp.value.trim());

      // commitMessages — plano, en orden rama0-commit0, rama0-commit1, rama1-commit0...
      const commitMessages = Array.from(document.querySelectorAll('.commit-msg-input'))
        .map(inp => inp.value.trim());

      const pushBranches = !!(document.getElementById('chkPush'))?.checked;

      vscode.postMessage({ command: 'apply', subtaskNumbers, branchNames, commitMessages, pushBranches });
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
