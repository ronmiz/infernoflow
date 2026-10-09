/**
 * End-to-end self-test (0.46.3) — `infernoflow doctor --e2e`, and the CI
 * runtime smoke (scripts/runtime-smoke.mjs).
 *
 * Everything runs in a throw-away sandbox: a temp project, a temp HOME (so
 * nothing touches the user's ~/.claude.json, Cursor or VS Code settings) and a
 * temp launcher folder that points the hooks at THIS package. The user's
 * project and memory are never read or written.
 *
 * It exercises what unit tests can't see together: the CLI, the MCP server
 * over stdio (every listed tool is called), the prompt and session hooks with
 * sample input, git drift without git, and who each entry is attributed to.
 */
import { spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Arguments that make each MCP tool do real work without side effects outside the sandbox. */
const TOOL_ARGS = {
  amp_write:    { type: "note", msg: "e2e probe: MCP write" },
  amp_bookmark: { label: "e2e probe bookmark", note: "resume point" },
  amp_search:   { query: "probe" },
  amp_read:     { limit: 5 },
  amp_resume:   {},
  amp_health:   {},
  amp_handoff:  {},
  infernoflow_status:    {},
  infernoflow_git_drift: { sinceCommits: 3 },
  infernoflow_check:     {},
  infernoflow_context:   {},
};
const CLIENT = "infernoflow-doctor";

const ok   = (message) => ({ status: "pass", message });
const warn = (message) => ({ status: "warn", message });
const bad  = (message) => ({ status: "fail", message });

/**
 * Run the probe. Returns [{ label, status: "pass"|"warn"|"fail", message }].
 * @param {{ cliBin?: string, keep?: boolean }} [opts]
 *   cliBin — the CLI entry to test (default: this package's bin/infernoflow.mjs)
 */
export function runE2E(opts = {}) {
  const cliBin = opts.cliBin || path.join(PKG_ROOT, "bin", "infernoflow.mjs");
  const pkgRoot = path.resolve(path.dirname(cliBin), path.basename(path.dirname(path.dirname(cliBin))) === "dist" ? "../.." : "..");
  const server = path.join(path.dirname(cliBin), "..", "templates", "cursor", "inferno-mcp-server.mjs");

  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-e2e-")));
  const proj = path.join(base, "project"), home = path.join(base, "home"), bin = path.join(base, "bin"), nogit = path.join(base, "nogit");
  for (const d of [proj, home, bin, nogit]) fs.mkdirSync(d, { recursive: true });

  // git sees only the sandbox: no inherited GIT_DIR / GIT_WORK_TREE (set inside
  // git hooks and `rebase -x`), no system or user git config (hooksPath,
  // signing, templates) — just a sandbox config with an identity.
  const gitconfig = path.join(base, "gitconfig");
  fs.writeFileSync(gitconfig, "[user]\n\tname = infernoflow e2e\n\temail = e2e@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n");
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/i.test(k)) delete env[k];
  Object.assign(env, { NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), XDG_CONFIG_HOME: path.join(home, ".config"),
    GIT_CEILING_DIRECTORIES: base, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig });
  // The probe must not inherit the AI tool / project it is run from.
  for (const k of ["INFERNOFLOW_AGENT", "CLAUDECODE", "CLAUDE_CODE_SESSION", "CURSOR_TRACE_ID", "CURSOR_SESSION", "COPILOT_SESSION", "WINDSURF_SESSION",
                   "CLAUDE_PROJECT_DIR", "INFERNOFLOW_PROJECT_DIR", "WORKSPACE_FOLDER_PATHS"]) delete env[k];

  const results = [];
  const step = (label, fn) => {
    try { results.push({ label, ...fn() }); }
    catch (err) { results.push({ label, ...bad(String(err && err.message || err).split("\n")[0].slice(0, 200)) }); }
  };
  const cli = (args, cwd = proj, extraEnv = {}) => spawnSync(process.execPath, [cliBin, ...args], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 60_000, windowsHide: true });
  const git = (...a) => execFileSync("git", a, { cwd: proj, env, stdio: "ignore", windowsHide: true, timeout: 30_000 });
  const entries = () => {
    const f = path.join(proj, ".ai-memory", "sessions.jsonl");
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  };
  const mcp = (cwd, calls) => {
    const msgs = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: CLIENT, version: "1" } } }, ...calls];
    const r = spawnSync(process.execPath, [server], { cwd, env, input: msgs.map(m => JSON.stringify(m)).join("\n") + "\n", encoding: "utf8", timeout: 120_000, windowsHide: true });
    const out = new Map();
    for (const line of (r.stdout || "").split("\n")) { try { const j = JSON.parse(line); if (j.id !== undefined) out.set(j.id, j); } catch {} }
    return out;
  };
  const callAll = (cwd) => {
    const list = mcp(cwd, [{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }]).get(2);
    if (!list || !list.result) throw new Error("the MCP server did not answer tools/list");
    const names = list.result.tools.map(t => t.name);
    const calls = names.map((name, i) => ({ jsonrpc: "2.0", id: 10 + i, method: "tools/call", params: { name, arguments: TOOL_ARGS[name] || {} } }));
    const res = mcp(cwd, calls);
    const failed = [];
    names.forEach((name, i) => {
      const r = res.get(10 + i);
      if (!r) failed.push(`${name} (no answer)`);
      else if (r.error) failed.push(`${name} (${String(r.error.message).split("\n")[0].slice(0, 80)})`);
      else if (r.result && r.result.isError) failed.push(`${name} (isError)`);
    });
    return { names, failed };
  };

  try {
    // ── 1. Sandbox project (memory mode) ──────────────────────────────────
    let ready = false;
    let hasGit = false;
    try { execFileSync("git", ["--version"], { env, stdio: "ignore", windowsHide: true, timeout: 30_000 }); hasGit = true; } catch { /* not installed */ }
    if (!hasGit) {
      results.push({ label: "Sandbox project", ...warn("skipped — git is not installed (infernoflow's memory is shared through git; install git to run this test)") });
      return results;
    }
    step("Sandbox project", () => {
      git("init", "-q");
      fs.writeFileSync(path.join(proj, "app.js"), "module.exports = 1;\n");
      git("add", "app.js"); git("commit", "-q", "--no-verify", "-m", "init");
      const r = cli(["init", "--yes"]);
      if (r.status !== 0 || !fs.existsSync(path.join(proj, ".ai-memory"))) return bad("infernoflow init failed in a fresh project");
      ready = true;
      return ok("fresh git project, infernoflow init (memory mode)");
    });
    if (!ready) return results;

    // ── 2. CLI memory round trip ──────────────────────────────────────────
    step("Memory round trip", () => {
      if (cli(["log", "e2e probe: API returns 202 not 200", "--type", "gotcha", "--file", "app.js", "--quiet"]).status !== 0) return bad("log failed");
      const e = entries().find(x => /API returns 202/.test(x.msg || ""));
      if (!e) return bad("the logged entry is not in memory");
      if (!(cli(["ask", "202"]).stdout || "").includes("202")) return bad("ask does not find the entry");
      if (cli(["forget", e.id]).status !== 0) return bad("forget failed");
      if ((cli(["ask", "202"]).stdout || "").includes("returns 202")) return bad("forget left the entry searchable");
      return ok("log → ask → forget");
    });

    // ── 3. Attribution of CLI writes ──────────────────────────────────────
    step("CLI attribution", () => {
      cli(["log", "e2e probe: keeper", "--type", "note", "--source", "memory-keeper", "--quiet"], proj, { CLAUDECODE: "1" });
      cli(["log", "e2e probe: claude", "--type", "note", "--quiet"], proj, { CLAUDECODE: "1" });
      const who = (m) => { const e = entries().find(x => x.msg === m); return e && (e.tool || (e.meta && e.meta.agent)); };
      const k = who("e2e probe: keeper"), c = who("e2e probe: claude");
      if (k !== "memory-keeper" || c !== "claude") return bad(`expected memory-keeper / claude, got ${k} / ${c}`);
      return ok("memory-keeper and Claude Code writes are named");
    });

    // ── 4. MCP server, memory mode: every listed tool answers ─────────────
    step("MCP tools (memory mode)", () => {
      const { names, failed } = callAll(proj);
      if (names.includes("infernoflow_check") || names.includes("infernoflow_context")) return bad("contract tools are listed in memory mode");
      if (failed.length) return bad("failed: " + failed.join(", "));
      return ok(`${names.length} tools listed, all answered`);
    });

    step("MCP attribution", () => {
      const e = entries().find(x => x.msg === "e2e probe: MCP write");
      if (!e) return bad("amp_write left no entry");
      const who = e.tool || (e.meta && e.meta.agent);
      return who === CLIENT ? ok("amp_write is stamped with the calling client") : bad(`amp_write stamped "${who}", expected "${CLIENT}"`);
    });

    // ── 5. Git drift without git ──────────────────────────────────────────
    step("Git drift without git", () => {
      fs.mkdirSync(path.join(nogit, ".ai-memory"), { recursive: true });
      const r = mcp(nogit, [{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "infernoflow_git_drift", arguments: {} } }]).get(2);
      const text = r && r.result && r.result.content && r.result.content[0].text || "";
      return /not a git repository/.test(text) ? ok("reports that git is unavailable") : bad("did not report the missing repository: " + text.slice(0, 80));
    });

    // ── 6. Hooks with sample input ────────────────────────────────────────
    // A launcher folder laid out like a global npm install, pointing at this package.
    let launcher = null;
    try {
      if (process.platform === "win32") {
        fs.writeFileSync(path.join(bin, "infernoflow.cmd"), "@echo off\r\n");
        fs.mkdirSync(path.join(bin, "node_modules"), { recursive: true });
        fs.symlinkSync(pkgRoot, path.join(bin, "node_modules", "infernoflow"), "junction");
        launcher = bin;
      } else {
        fs.mkdirSync(path.join(bin, "bin")); fs.mkdirSync(path.join(bin, "lib", "node_modules"), { recursive: true });
        fs.writeFileSync(path.join(bin, "bin", "infernoflow"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
        fs.symlinkSync(pkgRoot, path.join(bin, "lib", "node_modules", "infernoflow"));
        launcher = path.join(bin, "bin");
      }
    } catch { launcher = null; }
    const hookEnv = launcher ? { ...env, CLAUDE_PROJECT_DIR: proj, PATH: launcher + path.delimiter + (env.PATH || env.Path || "") } : null;
    const runHook = (file, input, args = []) => spawnSync(process.execPath, [file, ...args], { cwd: proj, env: hookEnv, input, encoding: "utf8", timeout: 30_000, windowsHide: true });

    step("Prompt hook", () => {
      if (!hookEnv) return warn("skipped — could not create a test launcher (symlinks not allowed here)");
      const hook = path.join(proj, ".claude", "hooks", "log-frustration.mjs");
      if (!fs.existsSync(hook)) return bad("init did not install .claude/hooks/log-frustration.mjs");
      const before = entries().filter(e => /^User frustration/.test(e.msg || "")).length;
      runHook(hook, JSON.stringify({ prompt: '<agent-message from="x">[Subagent hand-back] still not working</agent-message>' }));
      runHook(hook, JSON.stringify({ prompt: "No changed files detected since last commit." }));
      if (entries().filter(e => /^User frustration/.test(e.msg || "")).length !== before) return bad("logged machine text as user frustration");
      const r = runHook(hook, JSON.stringify({ prompt: "it's still not working, same error" }));
      const got = entries().filter(e => /^User frustration/.test(e.msg || ""));
      if (r.status !== 0 || got.length !== before + 1) return bad("a real frustrated prompt was not logged");
      const who = got[got.length - 1].tool || (got[got.length - 1].meta && got[got.length - 1].meta.agent);
      if (who !== "hook") return bad(`hook entry stamped "${who}", expected "hook"`);
      return ok("ignores agent/tool text, logs a real prompt (as hook)");
    });

    step("Session hook", () => {
      if (!hookEnv) return warn("skipped — could not create a test launcher (symlinks not allowed here)");
      const hook = path.join(proj, ".claude", "hooks", "infernoflow-session.mjs");
      if (!fs.existsSync(hook)) return bad("init did not install .claude/hooks/infernoflow-session.mjs");
      const r = runHook(hook, JSON.stringify({ session_id: "e2e", source: "startup" }), ["start"]);
      if (r.status !== 0) return bad(`session start exited ${r.status}`);
      return (r.stdout || "").trim() ? ok("session start returns memory for the AI") : warn("session start ran but returned no context");
    });

    // ── 7. Full mode: contract tools appear and answer ───────────────────
    step("MCP tools (full mode)", () => {
      const r = cli(["init", "--mode", "full", "--adopt", "--yes"]);
      if (r.status !== 0 || !fs.existsSync(path.join(proj, "inferno", "contract.json"))) return warn("could not switch the sandbox to full mode — skipped");
      const { names, failed } = callAll(proj);
      if (!names.includes("infernoflow_check") || !names.includes("infernoflow_context")) return bad("contract tools are missing in full mode");
      if (failed.length) return bad("failed: " + failed.join(", "));
      return ok(`${names.length} tools listed, all answered`);
    });
  } finally {
    if (!opts.keep) { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* temp dir */ } }
  }
  return results;
}
