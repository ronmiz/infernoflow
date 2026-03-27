import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = join(__dirname, "..", "bin", "infernoflow.mjs");

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd });
}

const root = mkdtempSync(join(tmpdir(), "infernoflow-adopt-"));

try {
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "server"), { recursive: true });
  writeFileSync(
    join(root, "src", "app.js"),
    `
      export async function searchTasks() {}
      export async function createTask() {}
      export async function clearCompleted() {}
    `
  );
  writeFileSync(
    join(root, "server", "api.mjs"),
    `
      app.get("/tasks", () => {});
      app.post("/tasks", () => {});
      app.put("/tasks/:id", () => {});
      app.delete("/tasks/:id", () => {});
    `
  );
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "adopt-smoke", version: "1.0.0" }, null, 2));

  const init = run(["init", "--adopt", "--yes"], root);
  if (init.status !== 0) throw new Error("init --adopt --yes should succeed");

  const infernoDir = join(root, "inferno");
  if (!existsSync(join(infernoDir, "contract.json"))) throw new Error("contract.json not generated");
  if (!existsSync(join(infernoDir, "capabilities.json"))) throw new Error("capabilities.json not generated");
  if (!existsSync(join(infernoDir, "scenarios", "adoption_baseline.json"))) throw new Error("adoption_baseline.json not generated");
  if (!existsSync(join(infernoDir, "CHANGELOG.md"))) throw new Error("CHANGELOG.md not generated");

  const check = run(["check", "--skip-doc-gate"], root);
  if (check.status !== 0) throw new Error("check should pass after adopt init");

  const jsonReport = run(["init", "--adopt", "--yes", "--force", "--report-json"], root);
  if (jsonReport.status !== 0) throw new Error("init --adopt --report-json should succeed");
  if (!jsonReport.stdout.includes("\"inferredCapabilities\"")) {
    throw new Error("adopt report json missing inferredCapabilities");
  }

  const jsonOnly = run(["init", "--adopt", "--yes", "--force", "--report-json-only"], root);
  if (jsonOnly.status !== 0) throw new Error("init --adopt --report-json-only should succeed");
  let parsed;
  try {
    parsed = JSON.parse(jsonOnly.stdout);
  } catch {
    throw new Error("report-json-only output is not valid JSON");
  }
  if (!parsed || !Array.isArray(parsed.inferredCapabilities)) {
    throw new Error("report-json-only missing inferredCapabilities array");
  }

  console.log("adopt smoke checks passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
