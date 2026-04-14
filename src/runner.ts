import { execFile, spawn } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

function resolveExecutable(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "npm" || command === "npx" || command === "pr-split-advisor") {
    return `${command}.cmd`;
  }

  return command;
}

/**
 * Construye un entorno con PATH aumentado que incluye los directorios
 * donde npm instala binarios globalmente. Necesario porque VS Code lanza
 * procesos con un PATH reducido que no siempre incluye el global npm bin.
 */
function buildEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const extraPaths: string[] = [];

  if (process.platform === "win32") {
    // Ruta estándar de binarios globales de npm en Windows
    const appData = process.env.APPDATA || "";
    if (appData) { extraPaths.push(path.join(appData, "npm")); }
    // Rutas de instalación típicas de Node.js en Windows
    extraPaths.push("C:\\Program Files\\nodejs");
    extraPaths.push("C:\\Program Files (x86)\\nodejs");
  } else {
    // macOS / Linux
    extraPaths.push("/usr/local/bin");
    extraPaths.push("/usr/bin");
    // npm global con --prefix personalizado
    const home = process.env.HOME || "";
    if (home) { extraPaths.push(path.join(home, ".npm-global", "bin")); }
  }

  const sep = process.platform === "win32" ? ";" : ":";
  const currentPath = process.env.PATH || "";
  const newPath = [...extraPaths, currentPath].filter(Boolean).join(sep);

  return { ...process.env, PATH: newPath, FORCE_COLOR: "0", ...extra };
}

/**
 * Determina el comando a usar para ejecutar el CLI.
 * Orden de intentos:
 * 1. Binario global `pr-split-advisor` (más rápido)
 * 2. `npx`  (no requiere instalación global)
 * 3. `npm exec` (integrado en npm, fallback universal cuando npx no está en PATH)
 */
async function resolveCLICommand(): Promise<{ cmd: string; args: string[] }> {
  const env = buildEnv();

  // 1. Binario global instalado
  try {
    const cmd = resolveExecutable("pr-split-advisor");
    await execFileAsync(cmd, ["--version"], { env });
    return { cmd, args: [] };
  } catch { /* continuar */ }

  // 2. npx — @latest garantiza siempre la versión más reciente
  try {
    const cmd = resolveExecutable("npx");
    await execFileAsync(cmd, ["--version"], { env });
    return { cmd, args: ["-y", "-p", "pull-request-split-advisor@latest", "pr-split-advisor"] };
  } catch { /* continuar */ }

  // 3. npm exec — @latest garantiza siempre la versión más reciente
  try {
    const cmd = resolveExecutable("npm");
    await execFileAsync(cmd, ["--version"], { env });
    return { cmd, args: ["exec", "--yes", "-p", "pull-request-split-advisor@latest", "--", "pr-split-advisor"] };
  } catch { /* continuar */ }

  throw new Error(
    "No se encontró Node.js/npm en el sistema.\n" +
    "Instala Node.js desde https://nodejs.org y luego ejecuta:\n" +
    "  npm install -g pull-request-split-advisor"
  );
}

export async function ensureCLIInstalled(): Promise<void> {
  // La detección y fallback se hacen en resolveCLICommand al momento de ejecutar.
  // Aquí solo lanzamos el error anticipado si Node.js no está disponible en absoluto.
  await resolveCLICommand();
}

/**
 * Actualiza el binario global en segundo plano (fire-and-forget).
 * Solo aplica si el usuario tiene el binario instalado globalmente.
 * Falla silenciosamente si no hay permisos o no está instalado globalmente.
 */
export function updateCLIInBackground(): void {
  const env = buildEnv();
  execFileAsync(resolveExecutable("npm"), ["update", "-g", "pull-request-split-advisor"], {
    env,
  }).catch(() => { /* ignorar errores — permisos, sin red, etc. */ });
}

const CONFIG_FILENAME = "pr-split-advisor.config.json";
const OUTPUT_DIR     = ".pr-split-advisor";
const LEGACY_PLAN_CONTRACT_VERSION = 1;
const SUPPORTED_PLAN_CONTRACT_VERSIONS = new Set([1, 2]);

type RawPlanFile = {
  contractVersion?: unknown;
  currentBranch?: string;
  baseBranch?: string;
  cascadeBlocked?: boolean;
  branches?: Array<{
    name?: string;
    commits?: number;
    lines?: number;
    files?: number;
    score?: number;
    commitPlan?: Array<{
      index?: number;
      suggestedMessage?: string;
      ticketCode?: string;
      totalLines?: number;
      files?: string[];
    }>;
    isExistingBaseBranch?: boolean;
  }>;
};

function parsePlanFile(planPath: string, rawContent: string): RawPlanFile {
  try {
    const parsed = JSON.parse(rawContent);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("El contenido no es un objeto JSON válido.");
    }
    return parsed as RawPlanFile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo leer ${path.basename(planPath)}: ${message}`);
  }
}

function resolvePlanContractVersion(planPath: string, rawPlan: RawPlanFile): number {
  if (rawPlan.contractVersion === undefined) {
    return LEGACY_PLAN_CONTRACT_VERSION;
  }

  if (!Number.isInteger(rawPlan.contractVersion) || Number(rawPlan.contractVersion) <= 0) {
    throw new Error(
      `${path.basename(planPath)} tiene un contractVersion inválido: ${JSON.stringify(rawPlan.contractVersion)}.`
    );
  }

  return Number(rawPlan.contractVersion);
}

function readCompatiblePlanFile(planPath: string): RawPlanFile {
  const rawPlan = parsePlanFile(planPath, fs.readFileSync(planPath, "utf-8"));
  const contractVersion = resolvePlanContractVersion(planPath, rawPlan);

  if (!SUPPORTED_PLAN_CONTRACT_VERSIONS.has(contractVersion)) {
    throw new Error(
      `La extensión no es compatible con contractVersion ${contractVersion} en ${path.basename(planPath)}. ` +
      "Actualiza la extensión o usa una versión compatible del CLI. Versiones soportadas: 1 y 2."
    );
  }

  return rawPlan;
}

function parseConfigFile(configPath: string, rawContent: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawContent);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("El contenido no es un objeto JSON válido.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo leer ${path.basename(configPath)}: ${message}`);
  }
}

function replaceTicketNumber(text: string, subtaskNumber: string): string {
  return text.replace(/\b([A-Za-z][A-Za-z0-9_]*-)\d+\b/g, `$1${subtaskNumber}`);
}

function normalizeSubtaskNumber(value?: string): string | undefined {
  const normalized = value?.trim().replace(/[^0-9]/g, "");
  return normalized ? normalized : undefined;
}

export async function runAnalysis(cwd: string, config?: Record<string, unknown>): Promise<{ reportPath: string; hasCascadeWarning: boolean }> {
  const configPath = path.join(cwd, CONFIG_FILENAME);
  const configPreExisted = fs.existsSync(configPath);
  const originalConfigContent = configPreExisted
    ? fs.readFileSync(configPath, "utf-8")
    : undefined;
  let wroteTempConfig = false;

  if (config) {
    const { useAi, ...panelOverrides } = config;
    const existingConfig = originalConfigContent
      ? parseConfigFile(configPath, originalConfigContent)
      : {};
    const existingAi = existingConfig.ai;
    const mergedConfig: Record<string, unknown> = {
      ...existingConfig,
      ...panelOverrides,
    };

    if (useAi) {
      mergedConfig.ai = {
        ...(existingAi && typeof existingAi === "object" && !Array.isArray(existingAi)
          ? existingAi as Record<string, unknown>
          : {}),
        enabled: true,
        provider: "copilot",
      };
    } else {
      mergedConfig.ai = {
        ...(existingAi && typeof existingAi === "object" && !Array.isArray(existingAi)
          ? existingAi as Record<string, unknown>
          : {}),
        enabled: false,
      };
    }

    fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2) + "\n", "utf-8");
    wroteTempConfig = true;
  }

  // Extraer baseBranch para pasarlo como flag al CLI
  const baseBranch = config?.baseBranch as string | undefined;
  const cliArgs: string[] = [];
  if (baseBranch) { cliArgs.push("--base", baseBranch); }

  // Borrar el reporte anterior para que no se muestre si el CLI falla
  const reportPath = path.join(cwd, OUTPUT_DIR, "pr-split-report.html");
  if (fs.existsSync(reportPath)) {
    fs.unlinkSync(reportPath);
  }

  const { cmd, args: baseArgs } = await resolveCLICommand();
  const fullArgs = [...baseArgs, ...cliArgs];

  try {
    let stderrOutput = "";
    let stdoutOutput = "";
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(cmd, fullArgs, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: buildEnv(),
      });

      proc.stdout?.on("data", (chunk: Buffer) => { stdoutOutput += chunk.toString(); });
      proc.stderr?.on("data", (chunk: Buffer) => { stderrOutput += chunk.toString(); });

      // B2 FIX: Responder "n" al prompt de apply para no aplicar desde el
      // flujo de análisis. La cascada no tiene prompt interactivo desde v3.2.23.
      proc.stdin?.write("n\n");
      proc.stdin?.end();

      proc.on("close", (code: number | null) => {
        const reportExists = fs.existsSync(reportPath);
        if (code !== null && code <= 1 && reportExists) {
          resolve();
        } else if (code !== null && code <= 1 && !reportExists) {
          const detail = stderrOutput.trim() || stdoutOutput.trim();
          reject(new Error(detail || "El CLI no generó el reporte. Verifica que la rama base exista en el remote."));
        } else {
          const detail = stderrOutput.trim() || stdoutOutput.trim();
          reject(new Error(detail || `pr-split-advisor terminó con código ${code}. Verifica que el directorio sea un repositorio git con cambios.`));
        }
      });

      proc.on("error", (err: Error) => {
        reject(new Error(`No se pudo ejecutar pr-split-advisor: ${err.message}`));
      });
    });

    if (!fs.existsSync(reportPath)) {
      throw new Error(
        "No se generó .pr-split-advisor/pr-split-report.html. Verifica que la rama base exista en el remote y haya cambios git pendientes."
      );
    }

    // Leer cascadeBlocked desde el JSON del plan (más fiable que parsear stdout)
    let hasCascadeWarning = false;
    const planPath = path.join(cwd, OUTPUT_DIR, "pr-split-plan.json");
    if (fs.existsSync(planPath)) {
      try {
        const plan = readCompatiblePlanFile(planPath);
        hasCascadeWarning = plan.cascadeBlocked === true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`El plan generado no es compatible con esta extensión: ${message}`);
      }
    }
    return { reportPath, hasCascadeWarning };
  } finally {
    if (wroteTempConfig) {
      if (originalConfigContent !== undefined) {
        fs.writeFileSync(configPath, originalConfigContent, "utf-8");
      } else if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }
  }
}

export type PlanCommit = {
  index: number;
  suggestedMessage: string;
  totalLines: number;
  files: string[];
};

export type PlanBranch = {
  name: string;
  commits: number;
  lines: number;
  files: number;
  score: number;
  commitPlan: PlanCommit[];
  isExistingBaseBranch?: boolean;
};

export type PlanSummary = {
  currentBranch: string;
  baseBranch: string;
  branches: PlanBranch[];
};

/** Lee pr-split-plan.json y devuelve un resumen estructurado de ramas y commits. */
export function getPlanSummary(cwd: string): PlanSummary | null {
  const planPath = path.join(cwd, OUTPUT_DIR, "pr-split-plan.json");
  if (!fs.existsSync(planPath)) { return null; }
  const raw = readCompatiblePlanFile(planPath);
  return {
    currentBranch: raw.currentBranch ?? "desconocida",
    baseBranch:    raw.baseBranch    ?? "main",
    branches: (raw.branches ?? []).map((b, i) => ({
      name:                 b.name                 ?? `PR-${i + 1}`,
      commits:              b.commits               ?? (b.commitPlan?.length ?? 0),
      lines:                b.lines                 ?? 0,
      files:                b.files                 ?? 0,
      score:                b.score                 ?? 0,
      isExistingBaseBranch: b.isExistingBaseBranch  ?? false,
      commitPlan: (b.commitPlan ?? []).map((c, ci) => ({
        index:            c.index            ?? ci + 1,
        suggestedMessage: c.suggestedMessage ?? `commit ${ci + 1}`,
        totalLines:       c.totalLines       ?? 0,
        files:            c.files            ?? [],
      })),
    })),
  };
}

/**
 * Ejecuta `pr-split-advisor --apply` para crear ramas y commits según el plan.
 * Devuelve la ruta del reporte HTML generado.
 * onLog: callback invocado por cada línea de output del CLI (progreso en tiempo real).
 * subtaskNumbers: números de subtarea en orden de aparición por commit.
 *   Cadena vacía o undefined → Enter (acepta el número por defecto del CLI).
 */
export async function runApplyPlan(
  cwd: string,
  baseBranch?: string,
  onLog?: (line: string) => void,
  pushBranches?: boolean
): Promise<string> {
  const { cmd, args: baseArgs } = await resolveCLICommand();
  const cliArgs: string[] = [];
  if (baseBranch) { cliArgs.push("--base", baseBranch); }
  cliArgs.push("--apply", "--yes");
  if (pushBranches) { cliArgs.push("--push"); }
  const fullArgs = [...baseArgs, ...cliArgs];
  const reportPath = path.join(cwd, OUTPUT_DIR, "pr-split-report.html");

  // Con --yes el CLI omite todos los prompts y usa los valores del plan.
  // No necesitamos construir stdin artificial.
  const stdinInput = "";

  let stderrOutput = "";
  let stdoutOutput = "";
  let buffer = "";
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, fullArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildEnv(),
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutOutput += text;
      // Emitir líneas completas al callback de progreso
      if (onLog) {
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(l => { if (l.trim()) { onLog(l); } });
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => { stderrOutput += chunk.toString(); });

    // Responder "y" para el posible prompt de cascada, luego Enter por
    // cada prompt de subtarea (acepta el número de ticket por defecto).
    proc.stdin?.write(stdinInput);
    proc.stdin?.end();

    proc.on("close", (code: number | null) => {
      // B14 FIX: vaciar el buffer restante cuando el proceso cierra para que
      // la última línea de output (sin \n final) llegue al output channel.
      if (onLog && buffer.trim()) { onLog(buffer); buffer = ""; }

      if (code !== null && code <= 1 && fs.existsSync(reportPath)) {
        resolve();
      } else if (code !== null && code <= 1) {
        reject(new Error(
          "pr-split-advisor --apply finalizó sin generar .pr-split-advisor/pr-split-report.html."
        ));
      } else {
        const detail = stderrOutput.trim() || stdoutOutput.trim();
        reject(new Error(detail || `pr-split-advisor --apply terminó con código ${code}.`));
      }
    });

    proc.on("error", (err: Error) => {
      reject(new Error(`No se pudo ejecutar pr-split-advisor --apply: ${err.message}`));
    });
  });

  return reportPath;
}

/**
 * Parchea `pr-split-plan.json` con los nombres de rama y mensajes de commit
 * editados por el usuario en el formulario, antes de ejecutar `--apply`.
 *
 * branchNames: uno por rama nueva (excluye isExistingBaseBranch), en orden.
 * commitMessages: plano, en orden rama0-commit0, rama0-commit1, rama1-commit0...
 * subtaskNumbers: plano, en el mismo orden que commitMessages.
 * Si el array está vacío o un valor es cadena vacía, se deja el valor original.
 */
export function patchPlanJson(
  cwd: string,
  branchNames: string[],
  commitMessages: string[],
  subtaskNumbers: string[]
): void {
  const planPath = path.join(cwd, OUTPUT_DIR, "pr-split-plan.json");
  if (!fs.existsSync(planPath)) { return; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = readCompatiblePlanFile(planPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newBranches: any[] = (raw.branches ?? []).filter((b: any) => !b.isExistingBaseBranch);

  let msgCursor = 0;
  newBranches.forEach((branch, bi) => {
    const editedName = branchNames[bi]?.trim();
    if (editedName) { branch.name = editedName; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (branch.commitPlan ?? []).forEach((commit: any) => {
      const editedMsg = commitMessages[msgCursor]?.trim();
      if (editedMsg) { commit.suggestedMessage = editedMsg; }

      const subtaskNumber = normalizeSubtaskNumber(subtaskNumbers[msgCursor]);
      if (subtaskNumber) {
        if (typeof commit.suggestedMessage === "string") {
          commit.suggestedMessage = replaceTicketNumber(commit.suggestedMessage, subtaskNumber);
        }
        if (typeof commit.ticketCode === "string") {
          commit.ticketCode = replaceTicketNumber(commit.ticketCode, subtaskNumber);
        }
      }
      msgCursor++;
    });
  });

  fs.writeFileSync(planPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
}

/** Ejecuta `pr-split-advisor score` y devuelve la ruta del reporte HTML generado. */
export async function runScoreReport(cwd: string, baseBranch?: string): Promise<string> {
  const { cmd, args: baseArgs } = await resolveCLICommand();
  const cliArgs = baseBranch ? ["score", "--base", baseBranch] : ["score"];
  const fullArgs = [...baseArgs, ...cliArgs];
  const scoreReportPath = path.join(cwd, OUTPUT_DIR, "pr-split-score.html");

  // Borrar reporte anterior
  if (fs.existsSync(scoreReportPath)) {
    fs.unlinkSync(scoreReportPath);
  }

  let stderrOutput = "";
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, fullArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildEnv(),
    });

    // B9 FIX: el subcomando 'score' no tiene prompts interactivos desde v3.2;
    // no es necesario escribir nada por stdin.
    proc.stdin?.end();
    proc.stderr?.on("data", (chunk: Buffer) => { stderrOutput += chunk.toString(); });

    proc.on("close", (code: number | null) => {
      if (fs.existsSync(scoreReportPath)) {
        resolve();
      } else {
        reject(new Error(
          stderrOutput.trim() ||
          `pr-split-advisor score terminó con código ${code}. Verifica que la rama base exista y haya cambios git.`
        ));
      }
    });

    proc.on("error", (err: Error) => {
      reject(new Error(`No se pudo ejecutar pr-split-advisor score: ${err.message}`));
    });
  });

  return scoreReportPath;
}

/** Obtiene la rama git actual del workspace. */
export async function getGitBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(resolveExecutable("git"), ["branch", "--show-current"], {
      cwd,
      env: buildEnv(),
    });
    return stdout.trim() || "desconocida";
  } catch {
    return "desconocida";
  }
}

/** Cuenta archivos con cambios git (staged + unstaged). */
export async function getChangedFilesCount(cwd: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(resolveExecutable("git"), ["status", "--porcelain"], {
      cwd,
      env: buildEnv(),
    });
    return stdout.trim().split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/** Lee el score del último análisis desde pr-split-plan.json. */
export function getLastAnalysisInfo(
  cwd: string
): { score: number; date: string; branch: string } | null {
  const planPath = path.join(cwd, OUTPUT_DIR, "pr-split-plan.json");
  if (!fs.existsSync(planPath)) {
    return null;
  }
  try {
    const plan = readCompatiblePlanFile(planPath);
    const branches = plan.branches ?? [];
    if (branches.length === 0) {
      return null;
    }
    const score = parseFloat(
      (branches.reduce((s, b) => s + (b.score ?? 0), 0) / branches.length).toFixed(2)
    );
    const stat = fs.statSync(planPath);
    return {
      score,
      date:   stat.mtime.toLocaleString("es-PE"),
      branch: plan.currentBranch || "desconocida",
    };
  } catch {
    return null;
  }
}

export const __test__ = {
  normalizeSubtaskNumber,
  replaceTicketNumber,
  resolveExecutable,
  resolvePlanContractVersion,
};
