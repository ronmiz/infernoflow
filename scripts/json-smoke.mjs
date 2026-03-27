import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = join(__dirname, "..", "bin", "infernoflow.mjs");

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd });
}

const root = mkdtempSync(join(tmpdir(), "infernoflow-json-"));
try {
  mkdirSync(join(root, "inferno", "scenarios"), { recursive: true });
  writeFileSync(
    join(root, "inferno", "contract.json"),
    JSON.stringify({ policyId: "json-test", policyVersion: 1, capabilities: ["CreateTask"] }, null, 2) + "\n"
  );
  writeFileSync(
    join(root, "inferno", "capabilities.json"),
    JSON.stringify({ schemaVersion: 1, capabilities: [{ id: "CreateTask", title: "Create Task", since: "0.1.0" }] }, null, 2) + "\n"
  );
  writeFileSync(
    join(root, "inferno", "scenarios", "happy_path.json"),
    JSON.stringify(
      {
        scenarioId: "happy_path",
        description: "basic flow",
        capabilitiesCovered: ["CreateTask"],
        steps: [{ action: "CreateTask", expect: "CreateTask works as expected" }],
      },
      null,
      2
    ) + "\n"
  );
  writeFileSync(join(root, "inferno", "CHANGELOG.md"), "## Unreleased\n\n- bootstrap\n");

  const status = run(["status", "--json"], root);
  if (status.status !== 0) throw new Error("status --json should exit 0");
  const statusJson = JSON.parse(status.stdout);
  if (typeof statusJson.ok !== "boolean") throw new Error("status --json missing ok");
  if (!Array.isArray(statusJson.driftReasons)) throw new Error("status --json missing driftReasons[]");
  if (!statusJson.project || typeof statusJson.project.policyId !== "string") throw new Error("status --json missing project data");

  const gate = run(["doc-gate", "--json"], root);
  if (gate.status !== 0) throw new Error("doc-gate --json should exit 0 when no git");
  const gateJson = JSON.parse(gate.stdout);
  if (typeof gateJson.ok !== "boolean") throw new Error("doc-gate --json missing ok");
  if (!("skipped" in gateJson) && !("changedFiles" in gateJson)) {
    throw new Error("doc-gate --json missing expected fields");
  }

  console.log("json smoke checks passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
