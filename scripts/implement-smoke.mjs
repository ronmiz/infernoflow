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

const noInferno = mkdtempSync(join(tmpdir(), "infernoflow-impl-noinferno-"));
const withInferno = mkdtempSync(join(tmpdir(), "infernoflow-impl-"));

try {
  const failNoInferno = run(["implement", "add search"], noInferno);
  if (failNoInferno.status === 0) throw new Error("implement should fail when inferno/ missing");
  if (!failNoInferno.stderr.includes("inferno/ not found")) throw new Error("implement missing inferno error");

  mkdirSync(join(withInferno, "inferno", "scenarios"), { recursive: true });
  writeFileSync(
    join(withInferno, "inferno", "contract.json"),
    JSON.stringify({ policyId: "impl-test", policyVersion: 1, capabilities: ["CreateTask"] }, null, 2) + "\n"
  );
  writeFileSync(
    join(withInferno, "inferno", "capabilities.json"),
    JSON.stringify({ schemaVersion: 1, capabilities: [{ id: "CreateTask", title: "Create Task", since: "0.1.0" }] }, null, 2) + "\n"
  );
  writeFileSync(
    join(withInferno, "inferno", "context-state.json"),
    JSON.stringify({ intent: "add search", working: "task list" }, null, 2) + "\n"
  );

  const both = run(["implement", "add task search", "--mode", "both"], withInferno);
  if (both.status !== 0) throw new Error("implement --mode both should succeed");
  if (!both.stdout.includes("Cursor Agent Prompt")) throw new Error("missing Cursor Agent Prompt section");
  if (!both.stdout.includes("Generic Agent Prompt")) throw new Error("missing Generic Agent Prompt section");
  if (!both.stdout.includes("Task: add task search")) throw new Error("task parsing is incorrect");
  if (both.stdout.includes("Task: add task search both")) throw new Error("mode value leaked into task");

  const generic = run(["implement", "add task search", "--mode", "generic"], withInferno);
  if (generic.status !== 0) throw new Error("implement --mode generic should succeed");
  if (generic.stdout.includes("Cursor Agent Prompt")) throw new Error("cursor section should not appear in generic mode");
  if (!generic.stdout.includes("Generic Agent Prompt")) throw new Error("missing generic section");

  const withCopy = run(["implement", "add task search", "--mode", "cursor", "--copy"], withInferno);
  if (withCopy.status !== 0) throw new Error("implement --copy should not fail");

  console.log("implement smoke checks passed");
} finally {
  rmSync(noInferno, { recursive: true, force: true });
  rmSync(withInferno, { recursive: true, force: true });
}
