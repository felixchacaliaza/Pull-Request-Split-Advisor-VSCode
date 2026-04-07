import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export class ReportPanel {
  public static currentPanel: ReportPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];

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
      }
    );

    ReportPanel.currentPanel = new ReportPanel(panel, reportPath);
  }

  private constructor(panel: vscode.WebviewPanel, reportPath: string) {
    this._panel = panel;
    this._update(reportPath);

    this._panel.onDidDispose(
      () => this.dispose(),
      null,
      this._disposables
    );
  }

  private _update(reportPath: string): void {
    const html = fs.readFileSync(reportPath, "utf-8");
    this._panel.webview.html = html;
    this._panel.title = `PR Split Advisor — ${path.basename(
      path.dirname(reportPath)
    )}`;
  }

  public dispose(): void {
    ReportPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
