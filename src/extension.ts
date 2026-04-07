import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ensureCLIInstalled, runAnalysis, createDefaultConfig, CONFIG_FILENAME } from "./runner";
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

            const configPath = path.join(workspaceRoot, CONFIG_FILENAME);
            if (!fs.existsSync(configPath)) {
              const choice = await vscode.window.showWarningMessage(
                `PR Split Advisor: No se encontró el archivo de configuración "${CONFIG_FILENAME}".`,
                "Recrear config",
                "Cancelar"
              );
              if (choice !== "Recrear config") {
                return;
              }
              progress.report({ message: "Recreando archivo de configuración..." });
              await createDefaultConfig(workspaceRoot);
              vscode.window.showInformationMessage(
                `PR Split Advisor: Archivo "${CONFIG_FILENAME}" recreado correctamente.`
              );
            }

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
