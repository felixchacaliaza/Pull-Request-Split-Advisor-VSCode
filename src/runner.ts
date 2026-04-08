import { execFile, spawn } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

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
    await execFileAsync("pr-split-advisor", ["--version"], { shell: true, env });
    return { cmd: "pr-split-advisor", args: [] };
  } catch { /* continuar */ }

  // 2. npx
  try {
    await execFileAsync("npx", ["--version"], { shell: true, env });
    return { cmd: "npx", args: ["-y", "-p", "pull-request-split-advisor", "pr-split-advisor"] };
  } catch { /* continuar */ }

  // 3. npm exec (viene integrado en npm 7+, no requiere binario npx separado)
  try {
    await execFileAsync("npm", ["--version"], { shell: true, env });
    return { cmd: "npm", args: ["exec", "--yes", "-p", "pull-request-split-advisor", "--", "pr-split-advisor"] };
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

const CONFIG_FILENAME = "pr-split-advisor.config.json";

export async function runAnalysis(cwd: string, config?: Record<string, unknown>): Promise<string> {
  const configPath = path.join(cwd, CONFIG_FILENAME);
  const configWritten = !!config;
  if (config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }

  // Extraer baseBranch para pasarlo como --base (prioridad sobre config file)
  const baseBranch = config?.baseBranch as string | undefined;
  const cliArgs = baseBranch ? ["--base", baseBranch] : [];

  // Borrar el reporte anterior para que no se muestre si el CLI falla
  const reportPath = path.join(cwd, "pr-split-report.html");
  if (fs.existsSync(reportPath)) {
    fs.unlinkSync(reportPath);
  }

  const { cmd, args: baseArgs } = await resolveCLICommand();
  const fullArgs = [...baseArgs, ...cliArgs];

  try {
    let stderrOutput = "";
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(cmd, fullArgs, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        env: buildEnv(),
      });

      proc.stderr?.on("data", (chunk) => { stderrOutput += chunk.toString(); });

      // Responder "n" automáticamente a la pregunta de apply
      proc.stdin?.write("n\n");
      proc.stdin?.end();

      proc.on("close", (code) => {
        // 0 = ok, 1 = análisis con alertas — ambos generan el reporte
        // Pero si el reporte no existe tras la ejecución, es un error real
        const reportExists = fs.existsSync(reportPath);
        if (code !== null && code <= 1 && reportExists) {
          resolve();
        } else if (code !== null && code <= 1 && !reportExists) {
          reject(new Error(stderrOutput.trim() || "El CLI no generó el reporte. Verifica que la rama base exista en el remote."));
        } else {
          reject(
            new Error(stderrOutput.trim() || `pr-split-advisor terminó con código ${code}. Verifica que el directorio sea un repositorio git con cambios.`)
          );
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`No se pudo ejecutar pr-split-advisor: ${err.message}`));
      });
    });

    if (!fs.existsSync(reportPath)) {
      throw new Error(
        "No se generó pr-split-report.html. Verifica que la rama base exista en el remote y haya cambios git pendientes."
      );
    }

    return reportPath;
  } finally {
    if (configWritten && fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  }
}
