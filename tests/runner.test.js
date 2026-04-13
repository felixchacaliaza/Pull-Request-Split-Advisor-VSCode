const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchPlanJson, __test__ } = require("../out/runner.js");

test("normalizeSubtaskNumber elimina caracteres no numéricos", () => {
  assert.equal(__test__.normalizeSubtaskNumber(" ABC-0012 "), "0012");
  assert.equal(__test__.normalizeSubtaskNumber("---"), undefined);
});

test("replaceTicketNumber reemplaza el número conservando el prefijo", () => {
  assert.equal(
    __test__.replaceTicketNumber("feat(api): ajustar flujo FASTY-0007", "0042"),
    "feat(api): ajustar flujo FASTY-0042"
  );
});

test("resolveExecutable conserva el binario en plataformas no Windows", () => {
  assert.equal(__test__.resolveExecutable("npm"), "npm");
  assert.equal(__test__.resolveExecutable("pr-split-advisor"), "pr-split-advisor");
});

test("patchPlanJson actualiza nombres, mensajes y subtareas sin tocar la rama base existente", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prsa-vscode-"));
  const outputDir = path.join(tempDir, ".pr-split-advisor");
  fs.mkdirSync(outputDir, { recursive: true });

  const planPath = path.join(outputDir, "pr-split-plan.json");
  fs.writeFileSync(
    planPath,
    JSON.stringify({
      currentBranch: "feature/current",
      baseBranch: "master",
      branches: [
        {
          name: "feature/current",
          isExistingBaseBranch: true,
          commitPlan: [
            {
              index: 1,
              suggestedMessage: "feat(core): base FASTY-0001",
              ticketCode: "FASTY-0001",
              totalLines: 10,
              files: ["src/base.ts"],
            },
          ],
        },
        {
          name: "feature/sugerida",
          commitPlan: [
            {
              index: 1,
              suggestedMessage: "feat(api): cambio FASTY-0007",
              ticketCode: "FASTY-0007",
              totalLines: 20,
              files: ["src/api.ts"],
            },
          ],
        },
      ],
    }, null, 2),
    "utf-8"
  );

  patchPlanJson(tempDir, ["feature/final"], ["fix(api): mensaje editado FASTY-0007"], ["0042"]);

  const result = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  assert.equal(result.branches[0].name, "feature/current");
  assert.equal(result.branches[0].commitPlan[0].ticketCode, "FASTY-0001");
  assert.equal(result.branches[1].name, "feature/final");
  assert.equal(result.branches[1].commitPlan[0].suggestedMessage, "fix(api): mensaje editado FASTY-0042");
  assert.equal(result.branches[1].commitPlan[0].ticketCode, "FASTY-0042");
});

test("patchPlanJson conserva valores originales cuando los campos editados llegan vacíos", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prsa-vscode-"));
  const outputDir = path.join(tempDir, ".pr-split-advisor");
  fs.mkdirSync(outputDir, { recursive: true });

  const planPath = path.join(outputDir, "pr-split-plan.json");
  fs.writeFileSync(
    planPath,
    JSON.stringify({
      currentBranch: "feature/current",
      baseBranch: "master",
      branches: [
        {
          name: "feature/original",
          commitPlan: [
            {
              index: 1,
              suggestedMessage: "feat(api): cambio FASTY-0007",
              ticketCode: "FASTY-0007",
              totalLines: 20,
              files: ["src/api.ts"],
            },
          ],
        },
      ],
    }, null, 2),
    "utf-8"
  );

  patchPlanJson(tempDir, ["   "], ["   "], ["   "]);

  const result = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  assert.equal(result.branches[0].name, "feature/original");
  assert.equal(result.branches[0].commitPlan[0].suggestedMessage, "feat(api): cambio FASTY-0007");
  assert.equal(result.branches[0].commitPlan[0].ticketCode, "FASTY-0007");
});
