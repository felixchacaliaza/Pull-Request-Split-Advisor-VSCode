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

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "npm",
      ["install", "-g", "pull-request-split-advisor"],
      { stdio: "pipe", shell: true }
    );
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `npm install falló con código ${code}. Instálalo manualmente: npm install -g pull-request-split-advisor`
          )
        );
      }
    });
    proc.on("error", reject);
  });

  if (!(await isCLIInstalled())) {
    throw new Error(
      "No se pudo encontrar pr-split-advisor tras la instalación. Instálalo manualmente: npm install -g pull-request-split-advisor"
    );
  }
}

export async function runAnalysis(cwd: string): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("pr-split-advisor", [], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    // Responder "n" automáticamente a la pregunta de apply
    proc.stdin?.write("n\n");
    proc.stdin?.end();

    proc.on("close", (code) => {
      // 0 = ok, 1 = análisis con alertas — ambos generan el reporte
      if (code !== null && code <= 1) {
        resolve();
      } else {
        reject(
          new Error(
            `pr-split-advisor terminó con código ${code}. Verifica que el directorio sea un repositorio git con cambios.`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`No se pudo ejecutar pr-split-advisor: ${err.message}`));
    });
  });

  const reportPath = path.join(cwd, "pr-split-report.html");
  if (!fs.existsSync(reportPath)) {
    throw new Error(
      "No se generó pr-split-report.html. Verifica que el directorio tenga cambios git pendientes."
    );
  }

  return reportPath;
}
