import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = join(__dirname, "..", "bin", "infernoflow.mjs");

function run(args, opts = {}) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", input: opts.input ?? "", ...opts });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── 1. --help shows the 5 core commands ──────────────────────────────────
const help = run(["--help"]);
assert(help.status === 0, "help command failed");
for (const cmd of ["log", "ask", "switch", "recap", "status"]) {
  assert(help.stdout.includes(cmd), `core command "${cmd}" missing from --help`);
}
assert(help.stdout.includes("infernoflow commands"), "--help should point at `infernoflow commands` for full list");

// ── 2. `commands` lists the broader command set ──────────────────────────
const commands = run(["commands"]);
assert(commands.status === 0, "`commands` failed");
for (const cmd of ["suggest", "implement", "pr-impact", "sync", "run", "scan", "freeze", "thaw"]) {
  assert(commands.stdout.includes(cmd), `command "${cmd}" missing from \`commands\` listing`);
}

// ── 3. --version ──────────────────────────────────────────────────────────
const version = run(["--version"]);
assert(version.status === 0, "--version failed");
assert(/^[0-9]+\.[0-9]+/.test(version.stdout.trim()), "--version did not return semver-ish");

// ── 4. unknown command exits non-zero with helpful message ───────────────
const unknown = run(["definitely-not-a-real-command"]);
assert(unknown.status !== 0, "unknown command must fail");
assert(unknown.stderr.includes("Unknown command"), "unknown command message missing");

// ── 5. End-to-end: init → log → ask → switch in a temp project ───────────
const tmp = mkdtempSync(join(tmpdir(), "infernoflow-smoke-"));
try {
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "smoke-test", version: "1.0.0" }));

  const init = run(["init"], { cwd: tmp, input: "\n" });
  assert(init.status === 0, "init failed: " + (init.stderr || init.stdout));
  assert(existsSync(join(tmp, "inferno", "config.json")), "init did not create inferno/config.json");

  const log = run(["log", "API returns 202 not 200", "--type", "gotcha"], { cwd: tmp });
  assert(log.status === 0, "log failed: " + (log.stderr || log.stdout));
  assert(log.stdout.includes("API returns 202"), "log echo missing the message — args[0] handling regression?");
  assert(!/Logged.*: log /.test(log.stdout), "log should not include the command name in the echo");

  const ask = run(["ask", "API"], { cwd: tmp });
  assert(ask.status === 0, "ask failed: " + (ask.stderr || ask.stdout));
  assert(ask.stdout.includes("API returns 202"), "ask did not surface logged gotcha");

  const sw = run(["switch"], { cwd: tmp });
  assert(sw.status === 0, "switch failed: " + (sw.stderr || sw.stdout));
  const handoffPath = join(tmp, "inferno", "HANDOFF.md");
  assert(existsSync(handoffPath), "switch did not write inferno/HANDOFF.md");
  const handoff = readFileSync(handoffPath, "utf8");
  assert(handoff.includes("Gotchas"), "HANDOFF.md missing Gotchas section");
  assert(handoff.includes("API returns 202"), "HANDOFF.md missing the logged gotcha");

  const recap = run(["recap"], { cwd: tmp });
  assert(recap.status === 0, "recap failed: " + (recap.stderr || recap.stdout));
  assert(/\d+\/100/.test(recap.stdout), "recap should show a /100 health score");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("smoke checks passed");
