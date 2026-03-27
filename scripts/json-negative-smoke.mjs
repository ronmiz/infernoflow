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

const root = mkdtempSync(join(tmpdir(), "infernoflow-json-neg-"));
try {
  mkdirSync(join(root, "inferno"), { recursive: true });
  writeFileSync(join(root, "inferno", "contract.json"), "{ invalid json");
  writeFileSync(join(root, "inferno", "CHANGELOG.md"), "## Unreleased\n");

  const check = run(["check", "--json"], root);
  if (check.status === 0) throw new Error("check --json should fail on invalid contract.json");

  const payload = JSON.parse(check.stdout);
  if (payload.ok !== false) throw new Error("check --json should return ok=false");
  if (!Array.isArray(payload.errors) || payload.errors.length === 0) {
    throw new Error("check --json should include errors[]");
  }

  console.log("json negative smoke checks passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
