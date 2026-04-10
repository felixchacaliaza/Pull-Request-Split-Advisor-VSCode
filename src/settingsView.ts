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
  apply?: boolean;
  metrics?: Record<string, { weight: number; scoring: Record<string, number | boolean>[] }>;
};

export class SettingsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "prSplitAdvisorView";

  private _view?: vscode.WebviewView;
  private _onAnalyze: (config: AnalyzeConfig) => void;
  private _onOpenReport: () => void;
  private _onScoreReport: () => void;
  private _onSelectWorkspace: (workspace: string) => void;

  /** Se invoca cuando la vista queda lista para recibir mensajes. */
  public onReady?: () => void;

  constructor(
    onAnalyze: (config: AnalyzeConfig) => void,
    onOpenReport: () => void,
    onScoreReport: () => void,
    onSelectWorkspace: (workspace: string) => void
  ) {
    this._onAnalyze = onAnalyze;
    this._onOpenReport = onOpenReport;
    this._onScoreReport = onScoreReport;
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

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.command === "analyze") {
        const cfg = msg.config as AnalyzeConfig;
        const s = vscode.workspace.getConfiguration("prSplitAdvisor");
        s.update("baseBranch",             cfg.baseBranch,             vscode.ConfigurationTarget.Global);
        s.update("excludeLockfiles",       cfg.excludeLockfiles,       vscode.ConfigurationTarget.Global);
        s.update("largeFileThreshold",     cfg.largeFileThreshold,     vscode.ConfigurationTarget.Global);
        s.update("mediumFileThreshold",    cfg.mediumFileThreshold,    vscode.ConfigurationTarget.Global);
        s.update("maxFilesPerCommit",      cfg.maxFilesPerCommit,      vscode.ConfigurationTarget.Global);
        s.update("maxLinesPerCommitIdeal", cfg.maxLinesPerCommitIdeal, vscode.ConfigurationTarget.Global);
        s.update("idealLinesPerPR",        cfg.idealLinesPerPR,        vscode.ConfigurationTarget.Global);
        s.update("targetScore",            cfg.targetScore,            vscode.ConfigurationTarget.Global);
        if (cfg.metrics) {
          s.update("metricsOverride", cfg.metrics, vscode.ConfigurationTarget.Global);
        } else {
          s.update("metricsOverride", undefined, vscode.ConfigurationTarget.Global);
        }
        this._onAnalyze(cfg);
      } else if (msg.command === "openReport") {
        this._onOpenReport();
      } else if (msg.command === "scoreReport") {
        this._onScoreReport();
      } else if (msg.command === "selectWorkspace") {
        this._onSelectWorkspace(msg.workspace as string);
      }
    });

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("prSplitAdvisor") && this._view) {
        this._view.webview.html = this._getHtml(this._view.webview);
        this.onReady?.();
      }
    });

    // Notificar al exterior para que empuje el estado inicial
    this.onReady?.();

    // Re-notificar cuando la vista vuelva a ser visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.onReady?.();
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
  .apply-label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    font-size: var(--vscode-font-size);
    color: var(--vscode-descriptionForeground, #aaa);
    cursor: pointer;
    user-select: none;
  }
  .apply-label input[type="checkbox"] { cursor: pointer; }
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
<hr>
<button id="btnOpenReport" class="btn-open-report" style="display:none">📄 Abrir último reporte</button>
<button id="btnScore" class="btn-open-report">📊 Ver score actual</button>
<label class="apply-label" title="Crea ramas y commits automáticamente según el plan generado">
  <input type="checkbox" id="applyPlan"> Aplicar plan (crea ramas y commits)
</label>
<button id="btnAnalyze">⟳ Analizar cambios</button>

<script>
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
        if (msg.status === 'idle') {
          bar.style.display = 'none';
          btnA.disabled = false;
        } else if (msg.status === 'analyzing') {
          bar.className = 'status-bar status-analyzing';
          bar.style.display = 'block';
          bar.textContent = '⏳ ' + (msg.message || 'Analizando cambios...');
          btnA.disabled = true;
        } else if (msg.status === 'done') {
          bar.className = 'status-bar status-done';
          bar.style.display = 'block';
          bar.textContent = '✅ ' + (msg.message || 'Análisis completado');
          btnA.disabled = false;
          setTimeout(() => { bar.style.display = 'none'; }, 4000);
        } else if (msg.status === 'error') {
          bar.className = 'status-bar status-error';
          bar.style.display = 'block';
          bar.textContent = '❌ ' + (msg.message || 'Error en el análisis');
          btnA.disabled = false;
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
        apply:                  document.getElementById('applyPlan').checked,
        metrics:                buildMetrics(),
      }
    });
  });

  // Estado inicial: métricas bloqueadas
  setMetricsState(false);
</script>
</body>
</html>`;
  }
}
