import { execFile, spawn } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

async function isCLIInstalled(): Promise<boolean> {
  try {
    await execFileAsync("pr-split-advisor", ["--version"], { shell: true });
    return true;
  } catch {
    return false;
  }
}

export async function ensureCLIInstalled(): Promise<void> {
  if (await isCLIInstalled()) {
    return;
  }

  let installStderr = "";
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "npm",
      ["install", "-g", "pull-request-split-advisor"],
      { stdio: "pipe", shell: true, env: { ...process.env } }
    );
    proc.stderr?.on("data", (chunk) => { installStderr += chunk.toString(); });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const permissionIssue = installStderr.includes("EACCES") || installStderr.includes("permission");
        const hint = permissionIssue
          ? `Sin permisos para instalar globalmente. Ejecuta en tu terminal:\n  sudo npm install -g pull-request-split-advisor`
          : `Instálalo manualmente en tu terminal:\n  npm install -g pull-request-split-advisor`;
        reject(new Error(`La instalación automática falló (código ${code}).\n${hint}`));
      }
    });
    proc.on("error", (err) => {
      reject(new Error(`No se pudo ejecutar npm. Instálalo manualmente:\n  npm install -g pull-request-split-advisor\n(${err.message})`));
    });
  });

  if (!(await isCLIInstalled())) {
    throw new Error(
      "No se pudo encontrar pr-split-advisor tras la instalación. Instálalo manualmente:\n  npm install -g pull-request-split-advisor"
    );
  }
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

  try {
    let stderrOutput = "";
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("pr-split-advisor", cliArgs, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        env: { ...process.env, FORCE_COLOR: "0" },
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
