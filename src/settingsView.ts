import * as vscode from "vscode";

export type AnalyzeConfig = {
  baseBranch: string;
  excludeLockfiles: boolean;
  largeFileThreshold: number;
  mediumFileThreshold: number;
  maxFilesPerCommit: number;
  maxLinesPerCommitIdeal: number;
  idealLinesPerPR: number;
  targetScore: number;
};

export class SettingsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "prSplitAdvisorView";

  private _view?: vscode.WebviewView;
  private _onAnalyze: (config: AnalyzeConfig) => void;

  constructor(onAnalyze: (config: AnalyzeConfig) => void) {
    this._onAnalyze = onAnalyze;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.command === "analyze") {
        const cfg = msg.config as AnalyzeConfig;
        // Persistir los valores en las settings de VS Code
        const s = vscode.workspace.getConfiguration("prSplitAdvisor");
        s.update("baseBranch",             cfg.baseBranch,             vscode.ConfigurationTarget.Global);
        s.update("excludeLockfiles",       cfg.excludeLockfiles,       vscode.ConfigurationTarget.Global);
        s.update("largeFileThreshold",     cfg.largeFileThreshold,     vscode.ConfigurationTarget.Global);
        s.update("mediumFileThreshold",    cfg.mediumFileThreshold,    vscode.ConfigurationTarget.Global);
        s.update("maxFilesPerCommit",      cfg.maxFilesPerCommit,      vscode.ConfigurationTarget.Global);
        s.update("maxLinesPerCommitIdeal", cfg.maxLinesPerCommitIdeal, vscode.ConfigurationTarget.Global);
        s.update("idealLinesPerPR",        cfg.idealLinesPerPR,        vscode.ConfigurationTarget.Global);
        s.update("targetScore",            cfg.targetScore,            vscode.ConfigurationTarget.Global);
        this._onAnalyze(cfg);
      }
    });

    // Actualizar el webview si cambian las settings externamente
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("prSplitAdvisor") && this._view) {
        this._view.webview.html = this._getHtml(this._view.webview);
      }
    });
  }

  private _getHtml(_webview: vscode.Webview): string {
    const cfg = vscode.workspace.getConfiguration("prSplitAdvisor");
    const baseBranch          = cfg.get<string>("baseBranch", "master");
    const excludeLockfiles    = cfg.get<boolean>("excludeLockfiles", true);
    const largeFileThreshold  = cfg.get<number>("largeFileThreshold", 400);
    const mediumFileThreshold = cfg.get<number>("mediumFileThreshold", 180);
    const maxFilesPerCommit   = cfg.get<number>("maxFilesPerCommit", 8);
    const maxLinesPerCommit   = cfg.get<number>("maxLinesPerCommitIdeal", 120);
    const idealLinesPerPR     = cfg.get<number>("idealLinesPerPR", 99);
    const targetScore         = cfg.get<number>("targetScore", 4);

    return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 12px 10px;
    margin: 0;
  }
  .field { margin-bottom: 12px; }
  .field-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 3px;
  }
  label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .default-hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
  }
  input[type="text"],
  input[type="number"] {
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 4px 6px;
    border-radius: 2px;
    font-size: var(--vscode-font-size);
    outline: none;
  }
  input[type="text"]:focus,
  input[type="number"]:focus {
    border-color: var(--vscode-focusBorder);
  }
  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .checkbox-row input { cursor: pointer; }
  .checkbox-row span {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  button {
    width: 100%;
    margin-top: 8px;
    padding: 7px 0;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 2px;
    font-size: var(--vscode-font-size);
    cursor: pointer;
    font-weight: 600;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  hr {
    border: none;
    border-top: 1px solid var(--vscode-widget-border, #333);
    margin: 14px 0;
  }
</style>
</head>
<body>
<div class="field">
  <div class="field-header">
    <label for="baseBranch">Rama base</label>
    <span class="default-hint">default: "master"</span>
  </div>
  <input id="baseBranch" type="text" value="${baseBranch}" placeholder="master">
</div>
<div class="field">
  <div class="field-header">
    <label for="largeFileThreshold">Umbral archivo grande (líneas)</label>
    <span class="default-hint">default: 400</span>
  </div>
  <input id="largeFileThreshold" type="number" min="1" value="${largeFileThreshold}">
</div>
<div class="field">
  <div class="field-header">
    <label for="mediumFileThreshold">Umbral archivo mediano (líneas)</label>
    <span class="default-hint">default: 180</span>
  </div>
  <input id="mediumFileThreshold" type="number" min="1" value="${mediumFileThreshold}">
</div>
<div class="field">
  <div class="field-header">
    <label for="maxFilesPerCommit">Máx. archivos por commit</label>
    <span class="default-hint">default: 8</span>
  </div>
  <input id="maxFilesPerCommit" type="number" min="1" value="${maxFilesPerCommit}">
</div>
<div class="field">
  <div class="field-header">
    <label for="maxLinesPerCommitIdeal">Máx. líneas por commit (ideal)</label>
    <span class="default-hint">default: 120</span>
  </div>
  <input id="maxLinesPerCommitIdeal" type="number" min="1" value="${maxLinesPerCommit}">
</div>
<div class="field">
  <div class="field-header">
    <label for="idealLinesPerPR">Líneas ideales por PR</label>
    <span class="default-hint">default: 99</span>
  </div>
  <input id="idealLinesPerPR" type="number" min="1" value="${idealLinesPerPR}">
</div>
<div class="field">
  <div class="field-header">
    <label for="targetScore">Score objetivo (1–5)</label>
    <span class="default-hint">default: 4</span>
  </div>
  <input id="targetScore" type="number" min="1" max="5" value="${targetScore}">
</div>
<div class="field">
  <label class="checkbox-row">
    <input id="excludeLockfiles" type="checkbox" ${excludeLockfiles ? "checked" : ""}>
    <span>Excluir archivos de lock (default: activado)</span>
  </label>
</div>
<hr>
<button id="btnAnalyze">⟳ Analizar cambios</button>
<script>
  const vscode = acquireVsCodeApi();
  document.getElementById('btnAnalyze').addEventListener('click', () => {
    vscode.postMessage({
      command: 'analyze',
      config: {
        baseBranch:             document.getElementById('baseBranch').value.trim() || 'master',
        excludeLockfiles:       document.getElementById('excludeLockfiles').checked,
        largeFileThreshold:     parseInt(document.getElementById('largeFileThreshold').value) || 400,
        mediumFileThreshold:    parseInt(document.getElementById('mediumFileThreshold').value) || 180,
        maxFilesPerCommit:      parseInt(document.getElementById('maxFilesPerCommit').value) || 8,
        maxLinesPerCommitIdeal: parseInt(document.getElementById('maxLinesPerCommitIdeal').value) || 120,
        idealLinesPerPR:        parseInt(document.getElementById('idealLinesPerPR').value) || 99,
        targetScore:            parseInt(document.getElementById('targetScore').value) || 4,
      }
    });
  });
</script>
</body>
</html>`;
  }
}
