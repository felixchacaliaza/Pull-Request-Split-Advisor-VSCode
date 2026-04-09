import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  ensureCLIInstalled,
  runAnalysis,
  runScoreReport,
  getGitBranch,
  getChangedFilesCount,
  getLastAnalysisInfo,
} from "./runner";
import { ReportPanel } from "./panel";
import { SettingsViewProvider, AnalyzeConfig } from "./settingsView";

const GENERATED_FILES = [
  "pr-split-report.html",
  "pr-split-score.html",
  "pr-split-plan.json",
  ".advisor-history.json",
  ".pr-split-history.json",
  "pr-split-advisor.config.json",
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

export function activate(context: vscode.ExtensionContext) {
  type MetricsOverride = Record<string, { weight: number; scoring: Record<string, number | boolean>[] }>;

  let selectedWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  let provider!: SettingsViewProvider;

  // ── Helpers internos ────────────────────────────────────────────────────

  async function initProviderState(): Promise<void> {
    if (!selectedWorkspace) { return; }

    const branch = await getGitBranch(selectedWorkspace);
    provider.updateBranch(branch);

    const count = await getChangedFilesCount(selectedWorkspace);
    provider.setBadge(count);

    const lastAnalysis = getLastAnalysisInfo(selectedWorkspace);
    provider.updateLastAnalysis(lastAnalysis);

    const reportExists = fs.existsSync(
      path.join(selectedWorkspace, "pr-split-report.html")
    );
    provider.notifyReportExists(reportExists);

    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 1) {
      provider.updateWorkspaces(
        folders.map((f) => ({ name: path.basename(f.uri.fsPath), path: f.uri.fsPath })),
        selectedWorkspace
      );
    }
  }

  async function runScoreFlow(): Promise<void> {
    if (!selectedWorkspace) {
      vscode.window.showErrorMessage(
        "PR Split Advisor: Abre un workspace con un repositorio git primero."
      );
      return;
    }

    provider.updateStatus("analyzing", "Calculando score actual...");

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "PR Split Advisor — Score actual",
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: "Verificando instalación del CLI..." });
          await ensureCLIInstalled();

          progress.report({ message: "Calculando score de la rama actual..." });
          const baseBranch = vscode.workspace
            .getConfiguration("prSplitAdvisor")
            .get<string>("baseBranch", "master");
          const reportPath = await runScoreReport(selectedWorkspace, baseBranch);

          ReportPanel.createOrShow(context.extensionUri, reportPath);
          provider.updateStatus("done", "Score calculado");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          provider.updateStatus("error", msg.split("\n")[0]);
          vscode.window.showErrorMessage(`PR Split Advisor: ${msg}`);
        }
      }
    );
  }

  function openLastReport(): void {
    const reportPath = path.join(selectedWorkspace, "pr-split-report.html");
    if (!fs.existsSync(reportPath)) {
      vscode.window.showWarningMessage(
        "PR Split Advisor: No hay reporte disponible. Ejecuta el análisis primero."
      );
      return;
    }
    ReportPanel.createOrShow(context.extensionUri, reportPath);
  }

  async function runAnalysisFlow(config: AnalyzeConfig): Promise<void> {
    if (!selectedWorkspace) {
      vscode.window.showErrorMessage(
        "PR Split Advisor: Abre un workspace con un repositorio git primero."
      );
      return;
    }

    provider.updateStatus("analyzing", "Analizando cambios...");

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
          ensureGitignore(selectedWorkspace);
          const reportPath = await runAnalysis(
            selectedWorkspace,
            config as unknown as Record<string, unknown>
          );

          ReportPanel.createOrShow(context.extensionUri, reportPath);

          provider.updateStatus("done", "Análisis completado");
          provider.notifyReportExists(true);

          const lastAnalysis = getLastAnalysisInfo(selectedWorkspace);
          provider.updateLastAnalysis(lastAnalysis);

          const count = await getChangedFilesCount(selectedWorkspace);
          provider.setBadge(count);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          provider.updateStatus("error", msg.split("\n")[0]);
          vscode.window.showErrorMessage(`PR Split Advisor: ${msg}`);
        }
      }
    );
  }

  // ── Provider ─────────────────────────────────────────────────────────────

  provider = new SettingsViewProvider(
    (config) => runAnalysisFlow(config),
    () => openLastReport(),
    () => runScoreFlow(),
    (ws) => {
      selectedWorkspace = ws;
      initProviderState();
    }
  );

  provider.onReady = () => { initProviderState(); };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, provider)
  );

  // ── Watcher de rama git (.git/HEAD) ──────────────────────────────────────

  const headWatcher = vscode.workspace.createFileSystemWatcher("**/.git/HEAD");
  context.subscriptions.push(headWatcher);

  headWatcher.onDidChange(async () => {
    if (!selectedWorkspace) { return; }
    const branch = await getGitBranch(selectedWorkspace);
    provider.updateBranch(branch);

    const count = await getChangedFilesCount(selectedWorkspace);
    provider.setBadge(count);

    const autoAnalyze = vscode.workspace
      .getConfiguration("prSplitAdvisor")
      .get<boolean>("autoAnalyzeOnBranchChange", false);

    if (autoAnalyze) {
      const cfg = vscode.workspace.getConfiguration("prSplitAdvisor");
      const metricsOverride = cfg.get<MetricsOverride | null>("metricsOverride", null) ?? undefined;
      await runAnalysisFlow({
        baseBranch:             cfg.get<string>("baseBranch", "master"),
        excludeLockfiles:       cfg.get<boolean>("excludeLockfiles", true),
        largeFileThreshold:     cfg.get<number>("largeFileThreshold", 400),
        mediumFileThreshold:    cfg.get<number>("mediumFileThreshold", 180),
        maxFilesPerCommit:      cfg.get<number>("maxFilesPerCommit", 8),
        maxLinesPerCommitIdeal: cfg.get<number>("maxLinesPerCommitIdeal", 120),
        idealLinesPerPR:        cfg.get<number>("idealLinesPerPR", 99),
        targetScore:            cfg.get<number>("targetScore", 4),
        ...(metricsOverride ? { metrics: metricsOverride } : {}),
      });
    }
  });

  // ── Comandos de paleta / SCM ─────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("prSplitAdvisor.score", () => {
      runScoreFlow();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("prSplitAdvisor.analyze", () => {
      const cfg = vscode.workspace.getConfiguration("prSplitAdvisor");
      const metricsOverride = cfg.get<MetricsOverride | null>("metricsOverride", null) ?? undefined;
      runAnalysisFlow({
        baseBranch:             cfg.get<string>("baseBranch", "master"),
        excludeLockfiles:       cfg.get<boolean>("excludeLockfiles", true),
        largeFileThreshold:     cfg.get<number>("largeFileThreshold", 400),
        mediumFileThreshold:    cfg.get<number>("mediumFileThreshold", 180),
        maxFilesPerCommit:      cfg.get<number>("maxFilesPerCommit", 8),
        maxLinesPerCommitIdeal: cfg.get<number>("maxLinesPerCommitIdeal", 120),
        idealLinesPerPR:        cfg.get<number>("idealLinesPerPR", 99),
        targetScore:            cfg.get<number>("targetScore", 4),
        ...(metricsOverride ? { metrics: metricsOverride } : {}),
      });
    })
  );
}

export function deactivate() {}
