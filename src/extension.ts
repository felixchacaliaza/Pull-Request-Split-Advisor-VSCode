import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ensureCLIInstalled, runAnalysis } from "./runner";
import { ReportPanel } from "./panel";
import { SettingsViewProvider, AnalyzeConfig } from "./settingsView";

const GENERATED_FILES = [
  "pr-split-report.html",
  "pr-split-plan.json",
  ".advisor-history.json",
  ".pr-split-history.json",
];

function ensureGitignore(workspaceRoot: string): void {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  const current = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf-8")
    : "";

  const existingLines = current.split("\n").map((l) => l.trim());
  const toAdd = GENERATED_FILES.filter((f) => !existingLines.includes(f));

  if (toAdd.length === 0) {
    return;
  }

  const block =
    (current.length && !current.endsWith("\n") ? "\n" : "") +
    "\n# PR Split Advisor — archivos generados\n" +
    toAdd.join("\n") +
    "\n";

  fs.appendFileSync(gitignorePath, block, "utf-8");
}

async function runWithConfig(
  extensionUri: vscode.Uri,
  config: AnalyzeConfig
): Promise<void> {
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

        progress.report({ message: "Analizando cambios del working tree..." });
        ensureGitignore(workspaceRoot);
        const reportPath = await runAnalysis(workspaceRoot, config as unknown as Record<string, unknown>);

        ReportPanel.createOrShow(extensionUri, reportPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`PR Split Advisor: ${msg}`);
      }
    }
  );
}

export function activate(context: vscode.ExtensionContext) {
  // Registrar el WebviewView provider con el formulario de configuración
  const provider = new SettingsViewProvider((config) => {
    runWithConfig(context.extensionUri, config);
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, provider)
  );

  // Comando de paleta / SCM — usa las settings guardadas en VS Code
  const disposable = vscode.commands.registerCommand(
    "prSplitAdvisor.analyze",
    () => {
      const cfg = vscode.workspace.getConfiguration("prSplitAdvisor");
      runWithConfig(context.extensionUri, {
        baseBranch:             cfg.get<string>("baseBranch", "master"),
        excludeLockfiles:       cfg.get<boolean>("excludeLockfiles", true),
        largeFileThreshold:     cfg.get<number>("largeFileThreshold", 400),
        mediumFileThreshold:    cfg.get<number>("mediumFileThreshold", 180),
        maxFilesPerCommit:      cfg.get<number>("maxFilesPerCommit", 8),
        maxLinesPerCommitIdeal: cfg.get<number>("maxLinesPerCommitIdeal", 120),
        idealLinesPerPR:        cfg.get<number>("idealLinesPerPR", 99),
        targetScore:            cfg.get<number>("targetScore", 4),
      });
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
