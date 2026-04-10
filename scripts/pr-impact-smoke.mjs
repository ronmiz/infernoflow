import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = join(__dirname, "..", "bin", "infernoflow.mjs");

function run(cwd, args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function sh(cwd, cmd, args) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${res.stderr}`);
}

const dir = mkdtempSync(join(tmpdir(), "inferno-pr-impact-"));
try {
  sh(dir, "git", ["init"]);
  sh(dir, "git", ["config", "user.email", "smoke@example.com"]);
  sh(dir, "git", ["config", "user.name", "Smoke Test"]);

  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "inferno", "scenarios"), { recursive: true });
  writeFileSync(join(dir, "src", "app.js"), "export const x = 1;\n", "utf8");
  writeFileSync(
    join(dir, "inferno", "contract.json"),
    JSON.stringify({ policyId: "x", policyVersion: 1, capabilities: ["CreateTask"] }, null, 2),
    "utf8"
  );
  writeFileSync(
    join(dir, "inferno", "capabilities.json"),
    JSON.stringify({ capabilities: [{ id: "CreateTask", title: "Create Task" }] }, null, 2),
    "utf8"
  );
  writeFileSync(join(dir, "inferno", "scenarios", "happy_path.json"), JSON.stringify({ capabilitiesCovered: ["CreateTask"] }, null, 2), "utf8");
  writeFileSync(join(dir, "inferno", "CHANGELOG.md"), "## Unreleased\n", "utf8");

  sh(dir, "git", ["add", "."]);
  sh(dir, "git", ["commit", "-m", "baseline"]);

  writeFileSync(join(dir, "src", "app.js"), "export const x = 2;\n", "utf8");

  const out = run(dir, ["pr-impact", "--json"]);
  if (out.status === 0) throw new Error("pr-impact should fail when code changed without inferno updates");
  const parsed = JSON.parse(out.stdout);
  if (parsed.ok !== false) throw new Error("expected ok=false");
  if (parsed.confidence !== "medium" && parsed.confidence !== "high") throw new Error("expected confidence in output");
  if (!Array.isArray(parsed.changedCodeFiles) || parsed.changedCodeFiles.length === 0) {
    throw new Error("expected changedCodeFiles in json output");
  }

  console.log("pr-impact smoke checks passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

