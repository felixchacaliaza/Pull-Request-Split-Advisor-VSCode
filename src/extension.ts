import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  ensureCLIInstalled,
  runAnalysis,
  runApplyPlan,
  patchPlanJson,
  runScoreReport,
  updateCLIInBackground,
  getGitBranch,
  getChangedFilesCount,
  getLastAnalysisInfo,
  getPlanSummary,
} from "./runner";
import { ReportPanel } from "./panel";
import { ApplyPanel } from "./applyPanel";
import { SettingsViewProvider, AnalyzeConfig } from "./settingsView";

const GENERATED_FILES = [
  ".pr-split-advisor/pr-split-report.html",
  ".pr-split-advisor/pr-split-score.html",
  ".pr-split-advisor/pr-split-plan.json",
  ".pr-split-advisor/.pr-split-history.json",
  ".advisor-history.json",
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

  function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders ?? [];
  }

  function selectFallbackWorkspace(): string {
    return getWorkspaceFolders()[0]?.uri.fsPath ?? "";
  }

  function ensureSelectedWorkspaceStillExists(): void {
    const folders = getWorkspaceFolders();
    const exists = folders.some((folder) => path.normalize(folder.uri.fsPath) === path.normalize(selectedWorkspace));

    if (!exists) {
      selectedWorkspace = selectFallbackWorkspace();
      provider?.setSelectedWorkspace(selectedWorkspace);
    }
  }

  // Canal de salida para logs en tiempo real del CLI
  const outputChannel = vscode.window.createOutputChannel("PR Split Advisor");
  context.subscriptions.push(outputChannel);

  // Flag para suprimir el headWatcher mientras el apply está en ejecución.
  // El CLI hace git checkout por cada rama creada — sin este flag el watcher
  // dispararía múltiples veces y podría sobrescribir el reporte o el estado.
  let isApplying = false;

  // Clave de workspaceState para persistir el warning entre sesiones
  function cascadeWarningKey(): string {
    return `cascadeWarning:${selectedWorkspace}`;
  }
  function getCascadeWarning(): boolean {
    return context.workspaceState.get<boolean>(cascadeWarningKey(), false);
  }
  function setCascadeWarning(value: boolean): void {
    context.workspaceState.update(cascadeWarningKey(), value);
  }

  function getWorkspaceConfig(): vscode.WorkspaceConfiguration {
    const scopeUri = selectedWorkspace ? vscode.Uri.file(selectedWorkspace) : undefined;
    return vscode.workspace.getConfiguration("prSplitAdvisor", scopeUri);
  }

  // ── Helpers internos ────────────────────────────────────────────────────

  async function initProviderState(): Promise<void> {
    ensureSelectedWorkspaceStillExists();

    const folders = getWorkspaceFolders();
    if (folders.length > 1) {
      provider.updateWorkspaces(
        folders.map((f) => ({ name: path.basename(f.uri.fsPath), path: f.uri.fsPath })),
        selectedWorkspace
      );
    } else {
      provider.updateWorkspaces([], selectedWorkspace);
    }

    if (!selectedWorkspace) { return; }

    const branch = await getGitBranch(selectedWorkspace);
    provider.updateBranch(branch);

    const count = await getChangedFilesCount(selectedWorkspace);
    provider.setBadge(count);

    const lastAnalysis = getLastAnalysisInfo(selectedWorkspace);
    provider.updateLastAnalysis(lastAnalysis);

    const reportExists = fs.existsSync(
      path.join(selectedWorkspace, ".pr-split-advisor", "pr-split-report.html")
    );
    provider.notifyReportExists(reportExists);

    const planExists = fs.existsSync(
      path.join(selectedWorkspace, ".pr-split-advisor", "pr-split-plan.json")
    );
    // Mostrar el botón solo si hay plan Y el warning de cascada no está activo
    provider.notifyPlanExists(planExists && !getCascadeWarning());

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
          ensureGitignore(selectedWorkspace);
          const baseBranch = getWorkspaceConfig().get<string>("baseBranch", "master");
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
    const reportPath = path.join(selectedWorkspace, ".pr-split-advisor", "pr-split-report.html");
    if (!fs.existsSync(reportPath)) {
      vscode.window.showWarningMessage(
        "PR Split Advisor: No hay reporte disponible. Ejecuta el análisis primero."
      );
      return;
    }
    ReportPanel.createOrShow(context.extensionUri, reportPath);
  }

  async function runApplyFlow(): Promise<void> {
    if (!selectedWorkspace) {
      vscode.window.showErrorMessage(
        "PR Split Advisor: Abre un workspace con un repositorio git primero."
      );
      return;
    }

    if (isApplying) {
      vscode.window.showInformationMessage(
        "PR Split Advisor: Ya hay una aplicación del plan en curso. Espera a que finalice."
      );
      return;
    }

    const planPath = path.join(selectedWorkspace, ".pr-split-advisor", "pr-split-plan.json");
    if (!fs.existsSync(planPath)) {
      vscode.window.showWarningMessage(
        "PR Split Advisor: No hay plan generado. Ejecuta el análisis primero."
      );
      return;
    }

    const summary = getPlanSummary(selectedWorkspace);
    if (!summary) {
      vscode.window.showErrorMessage(
        "PR Split Advisor: No se pudo leer el plan. Ejecuta el análisis de nuevo."
      );
      return;
    }

    // Abrir el formulario webview — espera a que el usuario confirme o cancele
    const result = await ApplyPanel.show(
      summary,
      getCascadeWarning()
    );

    if (!result) { return; } // canceló

    // Ejecutar el CLI con los números de subtarea del formulario
    provider.updateStatus("analyzing", "Aplicando plan...");
    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine("▶ Iniciando aplicación del plan...");
    outputChannel.appendLine("");

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "PR Split Advisor — Aplicando plan",
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: "Verificando instalación del CLI..." });
          await ensureCLIInstalled();

          isApplying = true;
          progress.report({ message: "Creando ramas y commits..." });
          const baseBranch = getWorkspaceConfig().get<string>("baseBranch", "master");

          // Parchear el plan JSON con los nombres/mensajes editados por el usuario
          if (
            result.branchNames.length > 0 ||
            result.commitMessages.length > 0 ||
            result.subtaskNumbers.some((value) => value.trim().length > 0)
          ) {
            patchPlanJson(
              selectedWorkspace,
              result.branchNames,
              result.commitMessages,
              result.subtaskNumbers
            );
          }

          const newReportPath = await runApplyPlan(
            selectedWorkspace,
            baseBranch,
            (line) => {
              outputChannel.appendLine(line);
              const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
              if (clean) { progress.report({ message: clean.slice(0, 80) }); }
            },
            result.pushBranches
          );

          outputChannel.appendLine("");
          outputChannel.appendLine("✅ Plan aplicado correctamente.");

          // Si el usuario no marcó "publicar ramas", mostrar el comando para hacerlo manualmente
          if (!result.pushBranches) {
            const hasExistingBase = summary.branches.some(b => b.isExistingBaseBranch);
            const newBranchNames = result.branchNames.length > 0
              ? result.branchNames
              : summary.branches.filter(b => !b.isExistingBaseBranch).map(b => b.name);

            const allBranches = [
              ...(hasExistingBase ? [summary.currentBranch] : []),
              ...newBranchNames,
            ];

            outputChannel.appendLine("");
            outputChannel.appendLine("📋 Para publicar las ramas en remoto, copia y pega:");
            outputChannel.appendLine(`   git push origin ${allBranches.join(" ")}`);
          }

          // Eliminar el plan para evitar que se aplique dos veces
          const planPath = path.join(selectedWorkspace, ".pr-split-advisor", "pr-split-plan.json");
          if (fs.existsSync(planPath)) { fs.unlinkSync(planPath); }

          isApplying = false;
          ReportPanel.createOrShow(context.extensionUri, newReportPath);
          provider.updateStatus("done", "Plan aplicado");
          provider.notifyReportExists(true);
          provider.notifyPlanExists(false);
          setCascadeWarning(false);

          const lastAnalysis = getLastAnalysisInfo(selectedWorkspace);
          provider.updateLastAnalysis(lastAnalysis);

          const count = await getChangedFilesCount(selectedWorkspace);
          provider.setBadge(count);
        } catch (err: unknown) {
          isApplying = false;
          const msg = err instanceof Error ? err.message : String(err);
          outputChannel.appendLine("");
          outputChannel.appendLine(`❌ Error: ${msg}`);
          provider.updateStatus("error", msg.split("\n")[0]);

          const branch = await getGitBranch(selectedWorkspace);
          provider.updateBranch(branch);

          const reportExists = fs.existsSync(
            path.join(selectedWorkspace, ".pr-split-advisor", "pr-split-report.html")
          );
          provider.notifyReportExists(reportExists);

          const planExists = fs.existsSync(
            path.join(selectedWorkspace, ".pr-split-advisor", "pr-split-plan.json")
          );
          provider.notifyPlanExists(planExists && !getCascadeWarning());

          const lastAnalysis = getLastAnalysisInfo(selectedWorkspace);
          provider.updateLastAnalysis(lastAnalysis);

          const count = await getChangedFilesCount(selectedWorkspace);
          provider.setBadge(count);

          vscode.window.showErrorMessage(`PR Split Advisor: ${msg}`);
        }
      }
    );
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
          const { reportPath, hasCascadeWarning } = await runAnalysis(
            selectedWorkspace,
            config as unknown as Record<string, unknown>
          );

          ReportPanel.createOrShow(context.extensionUri, reportPath);

          provider.updateStatus("done", "Análisis completado");
          provider.notifyReportExists(true);

          // Si la cascada está comprometida el CLI bloquea --apply:
          // ocultamos el botón y guardamos el estado persistido.
          setCascadeWarning(hasCascadeWarning);
          const planExists = fs.existsSync(
            path.join(selectedWorkspace, ".pr-split-advisor", "pr-split-plan.json")
          );
          provider.notifyPlanExists(planExists && !hasCascadeWarning);
          if (hasCascadeWarning) {
            vscode.window.showWarningMessage(
              "PR Split Advisor: La integridad del plan en cascada está comprometida. " +
              "El plan es de solo lectura — aplica el análisis desde una rama limpia."
            );
          }

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
    () => runApplyFlow(),
    (ws) => {
      selectedWorkspace = ws;
      initProviderState();
    }
  );

  provider.onReady = () => { initProviderState(); };

  // Actualizar el binario global en segundo plano al activar la extensión
  updateCLIInBackground();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, provider)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      ensureSelectedWorkspaceStillExists();
      initProviderState();
    })
  );

  // ── Watcher de rama git (.git/HEAD) ──────────────────────────────────────

  const headWatcher = vscode.workspace.createFileSystemWatcher("**/.git/HEAD");
  context.subscriptions.push(headWatcher);

  headWatcher.onDidChange(async (uri) => {
    if (!selectedWorkspace) { return; }
    const changedWorkspace = path.dirname(path.dirname(uri.fsPath));
    if (path.normalize(changedWorkspace) !== path.normalize(selectedWorkspace)) {
      return;
    }

    // Ignorar cambios de HEAD mientras el apply está en ejecución:
    // el CLI hace git checkout por cada rama, lo que dispararía el watcher
    // múltiples veces y podría interferir con el reporte o el estado.
    if (isApplying) { return; }
    const branch = await getGitBranch(selectedWorkspace);
    provider.updateBranch(branch);

    // Al cambiar de rama el plan anterior ya no es válido — resetear warning
    setCascadeWarning(false);
    provider.notifyPlanExists(false);

    const count = await getChangedFilesCount(selectedWorkspace);
    provider.setBadge(count);

    const autoAnalyze = getWorkspaceConfig().get<boolean>("autoAnalyzeOnBranchChange", false);

    if (autoAnalyze) {
      const cfg = getWorkspaceConfig();
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
        useAi:                  false,
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
      const cfg = getWorkspaceConfig();
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
        useAi:                  false,
        ...(metricsOverride ? { metrics: metricsOverride } : {}),
      });
    })
  );
}

export function deactivate() {}
