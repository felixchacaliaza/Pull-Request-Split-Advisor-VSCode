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
  useAi: boolean;
  metrics?: Record<string, { weight: number; scoring: Record<string, number | boolean>[] }>;
};

export class SettingsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "prSplitAdvisorView";

  private _view?: vscode.WebviewView;
  private _selectedWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  private _suspendConfigRefresh = false;
  // B6 FIX: rastrear el listener de configuración para reemplazarlo en cada
  // llamada a resolveWebviewView y evitar la acumulación de listeners.
  private _configChangeDisposable?: vscode.Disposable;
  private _visibilityDisposable?: vscode.Disposable;
  private _onAnalyze: (config: AnalyzeConfig) => void;
  private _onOpenReport: () => void;
  private _onScoreReport: () => void;
  private _onApplyPlan: () => void;
  private _onSelectWorkspace: (workspace: string) => void;

  /** Se invoca cuando la vista queda lista para recibir mensajes. */
  public onReady?: () => void;

  constructor(
    onAnalyze: (config: AnalyzeConfig) => void,
    onOpenReport: () => void,
    onScoreReport: () => void,
    onApplyPlan: () => void,
    onSelectWorkspace: (workspace: string) => void
  ) {
    this._onAnalyze = onAnalyze;
    this._onOpenReport = onOpenReport;
    this._onScoreReport = onScoreReport;
    this._onApplyPlan = onApplyPlan;
    this._onSelectWorkspace = onSelectWorkspace;
  }

  // ── Actualizaciones dinámicas ──────────────────────────────────────────

  public updateBranch(branch: string): void {
    this._view?.webview.postMessage({ command: "updateBranch", branch });
  }

  public updateStatus(
    status: "idle" | "analyzing" | "done" | "error",
    message?: string
  ): void {
    this._view?.webview.postMessage({ command: "updateStatus", status, message });
  }

  public updateLastAnalysis(
    info: { score: number; date: string; branch: string } | null
  ): void {
    this._view?.webview.postMessage({ command: "updateLastAnalysis", info });
  }

  public notifyReportExists(exists: boolean): void {
    this._view?.webview.postMessage({ command: "updateReportExists", exists });
  }

  public notifyPlanExists(exists: boolean): void {
    this._view?.webview.postMessage({ command: "updatePlanExists", exists });
  }

  public updateWorkspaces(
    folders: Array<{ name: string; path: string }>,
    selected: string
  ): void {
    this._view?.webview.postMessage({ command: "updateWorkspaces", folders, selected });
  }

  public setBadge(count: number): void {
    if (this._view) {
      this._view.badge =
        count > 0
          ? {
              value: count,
              tooltip: `${count} archivo${count === 1 ? "" : "s"} con cambios git`,
            }
          : undefined;
    }
  }

  public setSelectedWorkspace(workspacePath: string): void {
    if (this._selectedWorkspacePath === workspacePath) {
      return;
    }

    this._selectedWorkspacePath = workspacePath;
    if (this._view) {
      this._view.webview.html = this._getHtml(this._view.webview);
      this.onReady?.();
    }
  }

  private _getConfigScopeUri(): vscode.Uri | undefined {
    return this._selectedWorkspacePath ? vscode.Uri.file(this._selectedWorkspacePath) : undefined;
  }

  private _getConfigTarget(): vscode.ConfigurationTarget {
    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : vscode.ConfigurationTarget.Workspace;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === "analyze") {
        const cfg = msg.config as AnalyzeConfig;
        const s = vscode.workspace.getConfiguration("prSplitAdvisor", this._getConfigScopeUri());
        const target = this._getConfigTarget();
        this._suspendConfigRefresh = true;
        try {
          const updates: Thenable<void>[] = [
            s.update("baseBranch",             cfg.baseBranch,             target),
            s.update("excludeLockfiles",       cfg.excludeLockfiles,       target),
            s.update("largeFileThreshold",     cfg.largeFileThreshold,     target),
            s.update("mediumFileThreshold",    cfg.mediumFileThreshold,    target),
            s.update("maxFilesPerCommit",      cfg.maxFilesPerCommit,      target),
            s.update("maxLinesPerCommitIdeal", cfg.maxLinesPerCommitIdeal, target),
            s.update("idealLinesPerPR",        cfg.idealLinesPerPR,        target),
            s.update("targetScore",            cfg.targetScore,            target),
            s.update("metricsOverride",        cfg.metrics ?? undefined,   target),
          ];
          await Promise.all(updates);
        } finally {
          this._suspendConfigRefresh = false;
        }

        if (this._view) {
          this._view.webview.html = this._getHtml(this._view.webview);
          this.onReady?.();
        }
        this._onAnalyze(cfg);
      } else if (msg.command === "openReport") {
        this._onOpenReport();
      } else if (msg.command === "scoreReport") {
        this._onScoreReport();
      } else if (msg.command === "applyPlan") {
        this._onApplyPlan();
      } else if (msg.command === "selectWorkspace") {
        const workspace = msg.workspace as string;
        this.setSelectedWorkspace(workspace);
        this._onSelectWorkspace(workspace);
      } else if (msg.command === "checkCopilot") {
        this._checkCopilot();
      }
    });

    // B6 FIX: descartar el listener anterior antes de crear uno nuevo.
    this._configChangeDisposable?.dispose();
    this._configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!this._suspendConfigRefresh && e.affectsConfiguration("prSplitAdvisor") && this._view) {
        this._view.webview.html = this._getHtml(this._view.webview);
        this.onReady?.();
      }
    });

    // Notificar al exterior para que empuje el estado inicial
    this.onReady?.();

    // Re-notificar cuando la vista vuelva a ser visible
    this._visibilityDisposable?.dispose();
    this._visibilityDisposable = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.onReady?.();
      }
    });
  }

  private async _checkCopilot(): Promise<void> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      const available = models.length > 0;
      this._view?.webview.postMessage({
        command: "copilotStatus",
        available,
        label: available ? models[0].name : "",
      });
    } catch {
      this._view?.webview.postMessage({ command: "copilotStatus", available: false, label: "" });
    }
  }

  private _getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  private _getHtml(_webview: vscode.Webview): string {
    // B10 FIX: escapar valores de cadena antes de interpolarlos en HTML para
    // prevenir XSS si un .vscode/settings.json malicioso define baseBranch
    // con caracteres especiales como ">< o comillas dobles.
    function escHtml(s: string): string {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    const cfg = vscode.workspace.getConfiguration("prSplitAdvisor", this._getConfigScopeUri());
    const baseBranch          = escHtml(cfg.get<string>("baseBranch", "master"));
    const excludeLockfiles    = cfg.get<boolean>("excludeLockfiles", true);
    const largeFileThreshold  = cfg.get<number>("largeFileThreshold", 400);
    const mediumFileThreshold = cfg.get<number>("mediumFileThreshold", 180);
    const maxFilesPerCommit   = cfg.get<number>("maxFilesPerCommit", 8);
    const maxLinesPerCommit   = cfg.get<number>("maxLinesPerCommitIdeal", 120);
    const idealLinesPerPR     = cfg.get<number>("idealLinesPerPR", 99);
    const targetScore         = cfg.get<number>("targetScore", 4);

    // Métricas: leer override guardado
    type ScoringRule = Record<string, number | boolean>;
    type MetricRaw   = { weight?: number; scoring?: ScoringRule[] };
    type MetricsMap  = Record<string, MetricRaw>;
    const mo = cfg.get<MetricsMap | null>("metricsOverride", null);

    function getMetric(id: string, defWeight: number, defThresholds: number[]) {
      const m = mo?.[id];
      const weight = typeof m?.weight === "number" ? m.weight : defWeight;
      const scoring = Array.isArray(m?.scoring) ? (m.scoring as ScoringRule[]) : null;
      const thresholds = defThresholds.map((def, i) => {
        const r = scoring?.[i];
        if (!r) { return def; }
        const v = r["lte"] ?? r["lt"] ?? r["eq"];
        return typeof v === "number" ? v : def;
      });
      return { weight, thresholds };
    }

    const m13 = getMetric("M1.3", 0.20, [2, 4, 5, 7]);
    const m14 = getMetric("M1.4", 0.25, [15, 20, 30, 40]);
    const m15 = getMetric("M1.5", 0.25, [100, 150, 250, 350]);
    const m32 = getMetric("M3.2", 0.30, [50, 300, 500, 1200]);
    const nonce = this._getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';">
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
  input[type="number"]:focus { border-color: var(--vscode-focusBorder); }
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

  /* ── Sección métricas ───────────────────────────── */
  .metrics-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 5px;
  }
  .metrics-title {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .metrics-btns { display: flex; gap: 4px; }
  .btn-sec {
    width: auto;
    margin-top: 0;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: normal;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    border-radius: 2px;
    cursor: pointer;
  }
  .btn-sec:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  .btn-ghost {
    width: auto;
    margin-top: 0;
    padding: 3px 7px;
    font-size: 11px;
    font-weight: normal;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-widget-border, #555);
    border-radius: 2px;
    cursor: pointer;
    display: none;
  }
  .btn-ghost:hover { background: var(--vscode-list-hoverBackground); }
  .metrics-desc {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.65;
    margin: 0 0 8px;
  }
  #metricsCards { transition: opacity 0.15s; }
  #metricsCards.locked {
    opacity: 0.42;
    pointer-events: none;
  }
  .mcard {
    border: 1px solid var(--vscode-widget-border, #333);
    border-radius: 3px;
    padding: 6px 8px;
    margin-bottom: 7px;
  }
  .mcard-top {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 5px;
  }
  .mid {
    font-size: 11px;
    font-weight: bold;
    color: var(--vscode-textLink-foreground);
    flex-shrink: 0;
  }
  .mname {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    flex: 1;
  }
  .mw-lbl {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    flex-shrink: 0;
  }
  .mw-inp {
    width: 46px !important;
    padding: 2px 4px !important;
    font-size: 10px !important;
  }
  .msrow {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 3px;
  }
  .mspts {
    font-size: 10px;
    font-weight: bold;
    color: var(--vscode-charts-yellow, #e5c07b);
    width: 20px;
    flex-shrink: 0;
  }
  .msop {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    width: 13px;
    text-align: center;
    flex-shrink: 0;
  }
  .ms-inp {
    width: 58px !important;
    padding: 2px 4px !important;
    font-size: 10px !important;
  }
  .msunit {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    flex: 1;
  }
  .weight-sum-row {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 6px;
    display: none;
  }
  .sum-ok  { color: var(--vscode-charts-green,  #89d185); }
  .sum-bad { color: var(--vscode-charts-red, #f14c4c); }

  /* ── Elementos dinámicos de estado ──────────────────── */
  .info-bar {
    background: var(--vscode-badge-background, #3a3d41);
    color: var(--vscode-badge-foreground, #fff);
    border-radius: 3px;
    padding: 4px 8px;
    margin-bottom: 8px;
    font-size: 11px;
  }
  .info-card {
    border: 1px solid var(--vscode-widget-border, #333);
    border-radius: 3px;
    padding: 6px 8px;
    margin-bottom: 8px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
  }
  .la-label {
    font-size: 10px;
    font-weight: bold;
    display: block;
    margin-bottom: 3px;
  }
  #laInfo strong { color: var(--vscode-charts-yellow, #e5c07b); }
  .status-bar {
    border-radius: 3px;
    padding: 5px 8px;
    font-size: 11px;
    margin-bottom: 8px;
  }
  .status-analyzing {
    background: var(--vscode-inputValidation-infoBackground, #063b49);
    color: var(--vscode-inputValidation-infoForeground, #ccc);
    border: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
  }
  .status-done {
    background: var(--vscode-inputValidation-infoBackground, #063b49);
    color: var(--vscode-charts-green, #89d185);
    border: 1px solid var(--vscode-charts-green, #89d185);
  }
  .status-error {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    color: var(--vscode-inputValidation-errorForeground, #ccc);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
  }
  .error-msg {
    color: var(--vscode-errorForeground, #f14c4c);
    font-size: 11px;
    padding: 4px 0;
  }
  select {
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
  select:focus { border-color: var(--vscode-focusBorder); }
  .btn-open-report {
    width: 100%;
    margin-top: 6px;
    padding: 5px 0;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    border-radius: 2px;
    font-size: var(--vscode-font-size);
    cursor: pointer;
  }
  .btn-open-report:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  .btn-apply-plan {
    width: 100%;
    margin-top: 6px;
    padding: 5px 0;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    border-radius: 2px;
    font-size: var(--vscode-font-size);
    font-weight: 600;
    cursor: pointer;
  }
  .btn-apply-plan:hover { background: var(--vscode-button-hoverBackground, #1177bb); }

  /* ── AI switch ─────────────────────────────────────── */
  .ai-section {
    margin: 10px 0 6px;
    padding: 8px 10px;
    background: var(--vscode-sideBar-background, #252526);
    border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 4px;
  }
  .ai-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ai-label {
    flex: 1;
    font-size: var(--vscode-font-size);
    font-weight: 600;
    color: var(--vscode-foreground);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* Toggle switch */
  .ai-toggle { position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0; }
  .ai-toggle input { opacity: 0; width: 0; height: 0; }
  .ai-slider {
    position: absolute; inset: 0;
    background: var(--vscode-input-border, #555);
    border-radius: 20px;
    cursor: pointer;
    transition: background .2s;
  }
  .ai-slider::before {
    content: '';
    position: absolute;
    height: 14px; width: 14px;
    left: 3px; top: 3px;
    background: #fff;
    border-radius: 50%;
    transition: transform .2s;
  }
  .ai-toggle input:checked + .ai-slider { background: var(--vscode-button-background, #0e639c); }
  .ai-toggle input:checked + .ai-slider::before { transform: translateX(16px); }
  /* Badge */
  .ai-badge {
    display: none;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 10px;
    font-weight: 600;
    white-space: nowrap;
  }
  .ai-badge.checking { display: flex; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #ddd); }
  .ai-badge.ok       { display: flex; background: #1e4620; color: #89d185; border: 1px solid #89d185; }
  .ai-badge.error    { display: flex; background: #5a1d1d; color: #f98181; border: 1px solid #f98181; }
  .ai-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; display: inline-block; }
</style>
</head>
<body>

<!-- ── Contexto: rama git y workspace ──────────────────── -->
<div class="info-bar">
  <span id="branchDisplay">🌿 …</span>
</div>

<div id="wsSelector" class="field" style="display:none">
  <div class="field-header"><label for="wsSelect">Workspace</label></div>
  <select id="wsSelect"></select>
</div>

<div id="lastAnalysisCard" class="info-card" style="display:none">
  <span class="la-label">📊 Último análisis</span>
  <div id="laInfo"></div>
</div>

<div id="statusBar" class="status-bar" style="display:none"></div>

<hr>

<!-- ── Campos generales ────────────────────────────── -->
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

<!-- ── Métricas avanzadas ─────────────────────────── -->
<div class="metrics-header">
  <span class="metrics-title">Métricas avanzadas</span>
  <div class="metrics-btns">
    <button id="btnResetMetrics" class="btn-ghost" title="Restaurar valores por defecto">⟳ Defaults</button>
    <button id="btnToggleMetrics" class="btn-sec">🔒 Editar</button>
  </div>
</div>
<p class="metrics-desc">Pesos y rangos de puntuación de cada métrica. Los pesos deben sumar 1.0.</p>

<div id="metricsCards" class="locked">

  <!-- M1.3 -->
  <div class="mcard">
    <div class="mcard-top">
      <span class="mid">M1.3</span>
      <span class="mname">Commits en el PR</span>
      <span class="mw-lbl">peso</span>
      <input class="mw-inp" id="m13-weight" type="number" min="0.01" max="1" step="0.01" value="${m13.weight}" disabled>
    </div>
    <div class="msrow"><span class="mspts">5★</span><span class="msop">≤</span><input class="ms-inp" id="m13-t5" type="number" min="1" value="${m13.thresholds[0]}" disabled><span class="msunit">commits</span></div>
    <div class="msrow"><span class="mspts">4★</span><span class="msop">≤</span><input class="ms-inp" id="m13-t4" type="number" min="1" value="${m13.thresholds[1]}" disabled></div>
    <div class="msrow"><span class="mspts">3★</span><span class="msop">=</span><input class="ms-inp" id="m13-t3" type="number" min="1" value="${m13.thresholds[2]}" disabled></div>
    <div class="msrow"><span class="mspts">2★</span><span class="msop">≤</span><input class="ms-inp" id="m13-t2" type="number" min="1" value="${m13.thresholds[3]}" disabled></div>
  </div>

  <!-- M1.4 -->
  <div class="mcard">
    <div class="mcard-top">
      <span class="mid">M1.4</span>
      <span class="mname">Archivos por commit</span>
      <span class="mw-lbl">peso</span>
      <input class="mw-inp" id="m14-weight" type="number" min="0.01" max="1" step="0.01" value="${m14.weight}" disabled>
    </div>
    <div class="msrow"><span class="mspts">5★</span><span class="msop">&lt;</span><input class="ms-inp" id="m14-t5" type="number" min="1" value="${m14.thresholds[0]}" disabled><span class="msunit">archivos</span></div>
    <div class="msrow"><span class="mspts">4★</span><span class="msop">&lt;</span><input class="ms-inp" id="m14-t4" type="number" min="1" value="${m14.thresholds[1]}" disabled></div>
    <div class="msrow"><span class="mspts">3★</span><span class="msop">&lt;</span><input class="ms-inp" id="m14-t3" type="number" min="1" value="${m14.thresholds[2]}" disabled></div>
    <div class="msrow"><span class="mspts">2★</span><span class="msop">&lt;</span><input class="ms-inp" id="m14-t2" type="number" min="1" value="${m14.thresholds[3]}" disabled></div>
  </div>

  <!-- M1.5 -->
  <div class="mcard">
    <div class="mcard-top">
      <span class="mid">M1.5</span>
      <span class="mname">Líneas por commit</span>
      <span class="mw-lbl">peso</span>
      <input class="mw-inp" id="m15-weight" type="number" min="0.01" max="1" step="0.01" value="${m15.weight}" disabled>
    </div>
    <div class="msrow"><span class="mspts">5★</span><span class="msop">&lt;</span><input class="ms-inp" id="m15-t5" type="number" min="1" value="${m15.thresholds[0]}" disabled><span class="msunit">líneas</span></div>
    <div class="msrow"><span class="mspts">4★</span><span class="msop">&lt;</span><input class="ms-inp" id="m15-t4" type="number" min="1" value="${m15.thresholds[1]}" disabled></div>
    <div class="msrow"><span class="mspts">3★</span><span class="msop">&lt;</span><input class="ms-inp" id="m15-t3" type="number" min="1" value="${m15.thresholds[2]}" disabled></div>
    <div class="msrow"><span class="mspts">2★</span><span class="msop">&lt;</span><input class="ms-inp" id="m15-t2" type="number" min="1" value="${m15.thresholds[3]}" disabled></div>
  </div>

  <!-- M3.2 -->
  <div class="mcard">
    <div class="mcard-top">
      <span class="mid">M3.2</span>
      <span class="mname">Líneas totales en PR</span>
      <span class="mw-lbl">peso</span>
      <input class="mw-inp" id="m32-weight" type="number" min="0.01" max="1" step="0.01" value="${m32.weight}" disabled>
    </div>
    <div class="msrow"><span class="mspts">5★</span><span class="msop">≤</span><input class="ms-inp" id="m32-t5" type="number" min="1" value="${m32.thresholds[0]}" disabled><span class="msunit">líneas</span></div>
    <div class="msrow"><span class="mspts">4★</span><span class="msop">≤</span><input class="ms-inp" id="m32-t4" type="number" min="1" value="${m32.thresholds[1]}" disabled></div>
    <div class="msrow"><span class="mspts">3★</span><span class="msop">≤</span><input class="ms-inp" id="m32-t3" type="number" min="1" value="${m32.thresholds[2]}" disabled></div>
    <div class="msrow"><span class="mspts">2★</span><span class="msop">≤</span><input class="ms-inp" id="m32-t2" type="number" min="1" value="${m32.thresholds[3]}" disabled></div>
  </div>

</div><!-- #metricsCards -->

<div id="weightSumRow" class="weight-sum-row">
  Suma de pesos: <span id="weightSum">1.00</span>
</div>

<div id="validationError" class="error-msg" style="display:none"></div>

<!-- ── Copilot AI ─────────────────────────────────────── -->
<div class="ai-section">
  <div class="ai-row">
    <label class="ai-label">🤖 Usar Copilot IA</label>
    <label class="ai-toggle">
      <input type="checkbox" id="chkUseAi">
      <span class="ai-slider"></span>
    </label>
    <span id="aiBadge" class="ai-badge">
      <span class="ai-dot"></span>
      <span id="aiBadgeText">Verificando…</span>
    </span>
  </div>
</div>

<hr>
<button id="btnOpenReport" class="btn-open-report" style="display:none">📄 Abrir último reporte</button>
<button id="btnScore" class="btn-open-report">📊 Ver score actual</button>
<button id="btnApplyPlan" class="btn-apply-plan" style="display:none">⚡ Aplicar plan</button>
<button id="btnAnalyze">⟳ Analizar cambios</button>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let metricsUnlocked = false;

  const cards     = document.getElementById('metricsCards');
  const btnToggle = document.getElementById('btnToggleMetrics');
  const btnReset  = document.getElementById('btnResetMetrics');
  const sumRow    = document.getElementById('weightSumRow');
  const sumSpan   = document.getElementById('weightSum');

  const DEFAULTS = {
    'm13-weight': 0.20, 'm13-t5': 2,   'm13-t4': 4,   'm13-t3': 5,   'm13-t2': 7,
    'm14-weight': 0.25, 'm14-t5': 15,  'm14-t4': 20,  'm14-t3': 30,  'm14-t2': 40,
    'm15-weight': 0.25, 'm15-t5': 100, 'm15-t4': 150, 'm15-t3': 250, 'm15-t2': 350,
    'm32-weight': 0.30, 'm32-t5': 50,  'm32-t4': 300, 'm32-t3': 500, 'm32-t2': 1200,
  };

  function n(id, fb) { return parseFloat(document.getElementById(id)?.value) || fb; }

  function updateWeightSum() {
    const sum = n('m13-weight',0.20)+n('m14-weight',0.25)+n('m15-weight',0.25)+n('m32-weight',0.30);
    sumSpan.textContent = sum.toFixed(2);
    const ok = Math.abs(sum - 1.0) <= 0.01;
    sumSpan.className = ok ? 'sum-ok' : 'sum-bad';
  }

  function setMetricsState(unlocked) {
    metricsUnlocked = unlocked;
    cards.querySelectorAll('input').forEach(inp => inp.disabled = !unlocked);
    cards.classList.toggle('locked', !unlocked);
    btnToggle.textContent = unlocked ? '🔓 Bloquear' : '🔒 Editar';
    btnReset.style.display = unlocked ? 'inline-block' : 'none';
    sumRow.style.display   = unlocked ? 'block' : 'none';
    if (unlocked) { updateWeightSum(); }
  }

  btnToggle.addEventListener('click', () => setMetricsState(!metricsUnlocked));

  btnReset.addEventListener('click', () => {
    for (const [id, val] of Object.entries(DEFAULTS)) {
      const el = document.getElementById(id);
      if (el) { el.value = val; }
    }
    updateWeightSum();
  });

  ['m13-weight','m14-weight','m15-weight','m32-weight'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateWeightSum);
  });

  function buildMetrics() {
    if (!metricsUnlocked) { return undefined; }
    return {
      "M1.3": {
        weight: n('m13-weight', 0.20),
        scoring: [
          { lte: n('m13-t5',2),    points: 5 },
          { lte: n('m13-t4',4),    points: 4 },
          { eq:  n('m13-t3',5),    points: 3 },
          { lte: n('m13-t2',7),    points: 2 },
          { default: true,         points: 1 }
        ]
      },
      "M1.4": {
        weight: n('m14-weight', 0.25),
        scoring: [
          { lt: n('m14-t5',15),  points: 5 },
          { lt: n('m14-t4',20),  points: 4 },
          { lt: n('m14-t3',30),  points: 3 },
          { lt: n('m14-t2',40),  points: 2 },
          { default: true,       points: 1 }
        ]
      },
      "M1.5": {
        weight: n('m15-weight', 0.25),
        scoring: [
          { lt: n('m15-t5',100), points: 5 },
          { lt: n('m15-t4',150), points: 4 },
          { lt: n('m15-t3',250), points: 3 },
          { lt: n('m15-t2',350), points: 2 },
          { default: true,       points: 1 }
        ]
      },
      "M3.2": {
        weight: n('m32-weight', 0.30),
        scoring: [
          { lte: n('m32-t5',50),   points: 5 },
          { lte: n('m32-t4',300),  points: 4 },
          { lte: n('m32-t3',500),  points: 3 },
          { lte: n('m32-t2',1200), points: 2 },
          { default: true,         points: 1 }
        ]
      }
    };
  }

  // ── Mensajes recibidos desde la extensión ──────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.command) {

      case 'updateBranch': {
        document.getElementById('branchDisplay').textContent = '🌿 ' + msg.branch;
        break;
      }

      case 'updateStatus': {
        const bar  = document.getElementById('statusBar');
        const btnA = document.getElementById('btnAnalyze');
        const btnP = document.getElementById('btnApplyPlan');
        if (msg.status === 'idle') {
          bar.style.display = 'none';
          btnA.disabled = false;
          if (btnP) { btnP.disabled = false; }
        } else if (msg.status === 'analyzing') {
          bar.className = 'status-bar status-analyzing';
          bar.style.display = 'block';
          bar.textContent = '⏳ ' + (msg.message || 'Analizando cambios...');
          btnA.disabled = true;
          if (btnP) { btnP.disabled = true; }
        } else if (msg.status === 'done') {
          bar.className = 'status-bar status-done';
          bar.style.display = 'block';
          bar.textContent = '✅ ' + (msg.message || 'Análisis completado');
          btnA.disabled = false;
          if (btnP) { btnP.disabled = false; }
          setTimeout(() => { bar.style.display = 'none'; }, 4000);
        } else if (msg.status === 'error') {
          bar.className = 'status-bar status-error';
          bar.style.display = 'block';
          bar.textContent = '❌ ' + (msg.message || 'Error en el análisis');
          btnA.disabled = false;
          if (btnP) { btnP.disabled = false; }
        }
        break;
      }

      case 'updateLastAnalysis': {
        const card   = document.getElementById('lastAnalysisCard');
        const laInfo = document.getElementById('laInfo');
        laInfo.textContent = '';
        if (msg.info) {
          const { score, branch, date } = msg.info;
          const stars = Math.min(5, Math.round(score));
          const strong = document.createElement('strong');
          strong.textContent = score + '/5 ' + '★'.repeat(stars) + '☆'.repeat(5 - stars);
          laInfo.append(strong, ' · ');
          const em = document.createElement('em');
          em.textContent = branch;
          laInfo.append(em, ' · ' + date);
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
        break;
      }

      case 'updateReportExists': {
        document.getElementById('btnOpenReport').style.display = msg.exists ? 'block' : 'none';
        break;
      }

      case 'updatePlanExists': {
        document.getElementById('btnApplyPlan').style.display = msg.exists ? 'block' : 'none';
        break;
      }

      case 'updateWorkspaces': {
        const wsSel   = document.getElementById('wsSelector');
        const wsSelect = document.getElementById('wsSelect');
        wsSelect.innerHTML = '';
        (msg.folders || []).forEach(f => {
          const opt = document.createElement('option');
          opt.value = f.path;
          opt.textContent = f.name;
          if (f.path === msg.selected) { opt.selected = true; }
          wsSelect.appendChild(opt);
        });
        wsSel.style.display = (msg.folders && msg.folders.length > 1) ? 'block' : 'none';
        break;
      }
    }
  });

  // ── Selector de workspace ──────────────────────────────────────────────
  document.getElementById('wsSelect').addEventListener('change', function() {
    vscode.postMessage({ command: 'selectWorkspace', workspace: this.value });
  });

  // ── Abrir último reporte ───────────────────────────────────────────────
  document.getElementById('btnOpenReport').addEventListener('click', () => {
    vscode.postMessage({ command: 'openReport' });
  });

  document.getElementById('btnScore').addEventListener('click', () => {
    vscode.postMessage({ command: 'scoreReport' });
  });

  document.getElementById('btnApplyPlan').addEventListener('click', () => {
    vscode.postMessage({ command: 'applyPlan' });
  });

  // ── Analizar cambios (con validación) ─────────────────────────────────
  document.getElementById('btnAnalyze').addEventListener('click', () => {
    const errDiv = document.getElementById('validationError');
    errDiv.style.display = 'none';

    const baseBranch = document.getElementById('baseBranch').value.trim();
    const large  = parseInt(document.getElementById('largeFileThreshold').value)  || 400;
    const medium = parseInt(document.getElementById('mediumFileThreshold').value) || 180;
    const target = parseInt(document.getElementById('targetScore').value)         || 4;

    if (!baseBranch) {
      errDiv.textContent = 'La rama base no puede estar vacía.';
      errDiv.style.display = 'block';
      return;
    }
    if (medium >= large) {
      errDiv.textContent = 'El umbral mediano (' + medium + ') debe ser menor que el grande (' + large + ').';
      errDiv.style.display = 'block';
      return;
    }
    if (target < 1 || target > 5) {
      errDiv.textContent = 'El score objetivo debe estar entre 1 y 5.';
      errDiv.style.display = 'block';
      return;
    }
    if (metricsUnlocked) {
      const wSum = n('m13-weight',0.20)+n('m14-weight',0.25)+n('m15-weight',0.25)+n('m32-weight',0.30);
      if (Math.abs(wSum - 1.0) > 0.01) {
        errDiv.textContent = 'Los pesos deben sumar 1.00 (actualmente ' + wSum.toFixed(2) + ').';
        errDiv.style.display = 'block';
        return;
      }
    }

    vscode.postMessage({
      command: 'analyze',
      config: {
        baseBranch,
        excludeLockfiles:       document.getElementById('excludeLockfiles').checked,
        largeFileThreshold:     large,
        mediumFileThreshold:    medium,
        maxFilesPerCommit:      parseInt(document.getElementById('maxFilesPerCommit').value)      || 8,
        maxLinesPerCommitIdeal: parseInt(document.getElementById('maxLinesPerCommitIdeal').value) || 120,
        idealLinesPerPR:        parseInt(document.getElementById('idealLinesPerPR').value)        || 99,
        targetScore:            target,
        useAi:                  document.getElementById('chkUseAi').checked,
        metrics:                buildMetrics(),
      }
    });
  });

  // ── Copilot AI switch ────────────────────────────────
  (function () {
    const chk   = document.getElementById('chkUseAi');
    const badge = document.getElementById('aiBadge');
    const text  = document.getElementById('aiBadgeText');

    function setBadge(state, label) {
      badge.className = 'ai-badge ' + state;
      text.textContent = label;
    }

    chk.addEventListener('change', function () {
      if (!this.checked) {
        badge.className = 'ai-badge'; // hidden
        return;
      }
      setBadge('checking', 'Verificando…');
      vscode.postMessage({ command: 'checkCopilot' });
    });

    window.addEventListener('message', function (ev) {
      const msg = ev.data;
      if (msg.command !== 'copilotStatus') { return; }
      if (msg.available) {
        setBadge('ok', '● Conectado' + (msg.label ? ' · ' + msg.label : ''));
      } else {
        setBadge('error', '● No disponible');
        document.getElementById('chkUseAi').checked = false;
        badge.className = 'ai-badge';
      }
    });
  }());

  // Estado inicial: métricas bloqueadas
  setMetricsState(false);
</script>
</body>
</html>`;
  }
}
