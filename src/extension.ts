import * as vscode from "vscode";
import { ensureCLIInstalled, runAnalysis } from "./runner";
import { ReportPanel } from "./panel";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "prSplitAdvisor.analyze",
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
          "PR Split Advisor: Abre un workspace con un repositorio git primero."
        );
        return;
      }

      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "PR Split Advisor",
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: "Verificando instalación del CLI..." });
            await ensureCLIInstalled();

            progress.report({
              message: "Analizando cambios del working tree...",
            });
            const reportPath = await runAnalysis(workspaceRoot);

            ReportPanel.createOrShow(context.extensionUri, reportPath);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`PR Split Advisor: ${msg}`);
          }
        }
      );
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
