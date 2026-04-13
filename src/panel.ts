import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export class ReportPanel {
  public static currentPanel: ReportPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _isDisposed = false;

  public static createOrShow(
    extensionUri: vscode.Uri,
    reportPath: string
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (ReportPanel.currentPanel) {
      ReportPanel.currentPanel._update(reportPath);
      ReportPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "prSplitAdvisorReport",
      "PR Split Advisor — Reporte",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableCommandUris: false,
        localResourceRoots: [],
      }
    );

    ReportPanel.currentPanel = new ReportPanel(panel, reportPath);
  }

  private constructor(panel: vscode.WebviewPanel, reportPath: string) {
    this._panel = panel;
    this._update(reportPath);

    this._panel.onDidDispose(
      () => {
        this._isDisposed = true;
        ReportPanel.currentPanel = undefined;
        this._disposeDisposables();
      },
      null,
      this._disposables
    );
  }

  private _disposeDisposables(): void {
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      disposable?.dispose();
    }
  }

  private _escapeSrcdoc(html: string): string {
    return html
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private _update(reportPath: string): void {
    const reportHtml = fs.readFileSync(reportPath, "utf-8");
    const escapedSrcdoc = this._escapeSrcdoc(reportHtml);

    this._panel.webview.html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';">
<style>
  html, body, iframe {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    background: var(--vscode-editor-background);
  }
  iframe {
    display: block;
    background: white;
  }
</style>
</head>
<body>
  <iframe sandbox="allow-same-origin allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapedSrcdoc}"></iframe>
</body>
</html>`;
    // B11 FIX: usar el nombre del archivo en lugar del directorio padre.
    // dirname devolvía ".pr-split-advisor" siempre; ahora muestra el tipo de reporte.
    const filename = path.basename(reportPath, ".html");
    const labelMap: Record<string, string> = {
      "pr-split-report": "Reporte",
      "pr-split-score":  "Score",
    };
    const label = labelMap[filename] ?? filename;
    this._panel.title = `PR Split Advisor — ${label}`;
  }

  public dispose(): void {
    if (this._isDisposed) {
      return;
    }

    this._isDisposed = true;
    ReportPanel.currentPanel = undefined;
    this._disposeDisposables();
    this._panel.dispose();
  }
}
