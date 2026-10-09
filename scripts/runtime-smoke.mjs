#!/usr/bin/env node
/**
 * Runtime smoke test for the BUILT CLI (dist/), with no dev dependencies.
 * The test suite needs Node 22.12+ (vitest 5), but the CLI itself supports
 * Node 18+ — this script is how CI checks the older Node versions.
 *
 *   node scripts/runtime-smoke.mjs
 */
import { spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN  = path.join(ROOT, "dist", "bin", "infernoflow.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-rt-home-"));
const dir  = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-rt-"));
const env  = { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), XDG_CONFIG_HOME: path.join(home, ".config") };

let failed = 0;
function step(name, args, check, timeout = 60_000) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, env, encoding: "utf8", timeout });
  const out = (r.stdout || "") + (r.stderr || "");
  let ok = r.status === 0;
  try { if (ok && check) ok = check(out) !== false; } catch { ok = false; }
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) { failed++; console.log(out.split("\n").slice(-20).join("\n")); }
}

execFileSync("git", ["init", "-q"], { cwd: dir });
execFileSync("git", ["config", "user.name", "CI"], { cwd: dir });
execFileSync("git", ["config", "user.email", "ci@example.com"], { cwd: dir });
fs.writeFileSync(path.join(dir, "app.js"), "1\n");

step("--version", ["--version"], o => /\d+\.\d+\.\d+/.test(o));
step("init --yes", ["init", "--yes"], () => fs.existsSync(path.join(dir, ".ai-memory")));
step("log", ["log", "API returns 202, not 200", "--type", "gotcha", "--file", "app.js", "--quiet"]);
step("ask", ["ask", "API"], o => o.includes("202"));
step("resume", ["resume"], o => o.includes("store:"));
step("secret is redacted", ["log", "token ghp_" + "a".repeat(36), "--type", "note", "--quiet"], () =>
  !fs.readFileSync(path.join(dir, ".ai-memory", "sessions.jsonl"), "utf8").includes("ghp_" + "a".repeat(36)));
step("doctor runs", ["doctor"], () => true);
// 0.46.3: the whole chain in a sandbox — MCP server (every listed tool is
// called, memory and full mode), prompt/session hooks with sample input, git
// drift without git, and who each entry is attributed to.
step("doctor --e2e", ["doctor", "--e2e"], o => /all good|warnings/.test(o), 240_000);

for (const d of [dir, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
if (failed) { console.error(`\n${failed} runtime check(s) failed on Node ${process.version}`); process.exit(1); }
console.log(`\nruntime smoke passed on Node ${process.version}`);
