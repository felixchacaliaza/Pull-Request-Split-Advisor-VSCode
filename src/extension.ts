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

            const cfg = vscode.workspace.getConfiguration("prSplitAdvisor");
            const config: Record<string, unknown> = {
              baseBranch:              cfg.get<string>("baseBranch", "master"),
              excludeLockfiles:        cfg.get<boolean>("excludeLockfiles", true),
              largeFileThreshold:      cfg.get<number>("largeFileThreshold", 400),
              mediumFileThreshold:     cfg.get<number>("mediumFileThreshold", 180),
              maxFilesPerCommit:       cfg.get<number>("maxFilesPerCommit", 8),
              maxLinesPerCommitIdeal:  cfg.get<number>("maxLinesPerCommitIdeal", 120),
              idealLinesPerPR:         cfg.get<number>("idealLinesPerPR", 99),
              targetScore:             cfg.get<number>("targetScore", 4),
            };

            progress.report({
              message: "Analizando cambios del working tree...",
            });
            const reportPath = await runAnalysis(workspaceRoot, config);

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
