// infernoflow-server-version: 1  (bump when this file changes; copies are only replaced by a newer version)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * Find the root of the infernoflow package, regardless of how this file was
 * launched. Tried in order:
 *   1. Walk UP from this file's own location looking for a package.json with
 *      name=infernoflow. This works whether the template is run from inside
 *      infernoflow-pkg/, from a project's .cursor/ copy (via require.resolve),
 *      or from a test temp dir.
 *   2. require.resolve("infernoflow/package.json") — works if infernoflow is
 *      in node_modules of the CWD or one of its parents.
 * Returns null if neither finds infernoflow.
 */
function walkUpForInfernoflow(startFile) {
  let dir;
  try { dir = path.dirname(fs.realpathSync(startFile)); }
  catch { dir = path.dirname(startFile); }
  while (true) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const meta = JSON.parse(fs.readFileSync(pj, "utf8"));
        if (meta && meta.name === "infernoflow") return dir;
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Locate the global `infernoflow` launcher(s) on PATH WITHOUT a shell.
 * `where` (Windows) / `which` (POSIX) are real executables, so execFileSync
 * with an argument array is enough. Returns [] when nothing is found.
 */
function lookupOnPath(name) {
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(finder, [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, shell: false });
    // `where` (Windows) searches the current folder first. Never accept a
    // launcher inside the project / workspace — a cloned repo could plant one.
    const roots = [process.cwd(), process.env.INFERNOFLOW_PROJECT_DIR, ...(process.env.WORKSPACE_FOLDER_PATHS || "").split(path.delimiter)]
      .filter(Boolean).map(r => path.resolve(r).toLowerCase());
    const inside = (p) => { const r = path.resolve(p).toLowerCase(); return roots.some(w => r === w || r.startsWith(w + path.sep)); };
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(c => !inside(c));
  } catch { return []; }
}

function findInfernoflowRoot() {
  // 1. Walk up from this template's own location.
  //    Works when the template runs from inside infernoflow-pkg/ or from a
  //    project's .cursor/ copy that has node_modules/infernoflow/ in scope.
  const fromHere = walkUpForInfernoflow(fileURLToPath(import.meta.url));
  if (fromHere) return fromHere;

  // 2. require.resolve — works when infernoflow is in CWD's node_modules.
  try {
    return path.dirname(require.resolve("infernoflow/package.json"));
  } catch {}

  // 3. Resolve via the global install on PATH.
  //    When the user runs `npm install -g infernoflow` and `init` copies this
  //    template into their .cursor/, neither (1) nor (2) can find the package
  //    — there's no parent package.json above .cursor/ with name=infernoflow,
  //    and the user's project doesn't depend on infernoflow locally. Without
  //    this branch the MCP server boots with v0.0.0-unknown.
  try {
    for (const candidate of lookupOnPath("infernoflow")) {
      if (!fs.existsSync(candidate)) continue;
      const binDir = path.dirname(candidate);
      // Windows layout: <npm-prefix>/infernoflow.cmd  +  <npm-prefix>/node_modules/infernoflow/
      // Unix layout:    <npm-prefix>/bin/infernoflow  +  <npm-prefix>/lib/node_modules/infernoflow/
      for (const layout of [
        path.join(binDir, "node_modules", "infernoflow"),
        path.join(binDir, "..", "lib", "node_modules", "infernoflow"),
      ]) {
        if (fs.existsSync(path.join(layout, "package.json"))) {
          try { return fs.realpathSync(layout); } catch { return layout; }
        }
      }
    }
  } catch {}

  return null;
}

const INFERNOFLOW_ROOT = findInfernoflowRoot();

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function sendResult(id, result) { send({ jsonrpc: "2.0", id, result }); }
function sendError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

// ── Infernoflow resolution ─────────────────────────────────────────────────
// Avoid `npx infernoflow`. npx may resolve to a different (registry-fetched)
// version than what the user installed, which silently breaks subcommands.
// Resolve a deterministic location once at startup, in priority order:
//   1. infernoflow installed in the project's node_modules (npm i / npm link)
//   2. `where`/`which` the global binary
// Returns null if nothing is found; runCli surfaces a clear error in that case.
// SECURITY: this must always resolve to the CLI's JavaScript entry point
// (infernoflow.mjs), which we run as `node <file> ...args` with NO shell.
// We never execute the npm `.cmd` / shell-script wrapper: running those needs
// a shell, and a shell turns tool arguments into commands.
function resolveInfernoflowBin() {
  // Prefer the CLI that ships next to THIS server file: dist/templates → dist/bin
  // (installed package), templates → bin (running from a source checkout).
  const here = fileURLToPath(import.meta.url).split(path.sep).join("/");
  const fromDist = /\/dist\/templates\//.test(here);
  const fromRoot = (root) => {
    const order = fromDist
      ? [path.join(root, "dist", "bin", "infernoflow.mjs"), path.join(root, "bin", "infernoflow.mjs")]
      : [path.join(root, "bin", "infernoflow.mjs"), path.join(root, "dist", "bin", "infernoflow.mjs")];
    for (const c of order) if (fs.existsSync(c)) return c;
    return null;
  };
  if (INFERNOFLOW_ROOT) {
    const hit = fromRoot(INFERNOFLOW_ROOT);
    if (hit) return hit;
  }
  for (const candidate of lookupOnPath("infernoflow")) {
    if (!fs.existsSync(candidate)) continue;
    // POSIX: the bin entry is usually a symlink straight to infernoflow.mjs.
    try {
      const real = fs.realpathSync(candidate);
      if (/\.m?js$/i.test(real)) return real;
    } catch {}
    // Windows / wrapper layouts: find the package next to the wrapper.
    const binDir = path.dirname(candidate);
    for (const layout of [
      path.join(binDir, "node_modules", "infernoflow"),
      path.join(binDir, "..", "lib", "node_modules", "infernoflow"),
    ]) {
      const hit = fromRoot(layout);
      if (hit) return hit;
    }
  }
  return null;
}

const INFERNOFLOW_BIN = resolveInfernoflowBin();

// In-process AMP I/O loader. When available, amp_write / amp_read bypass the
// CLI entirely — no subprocess, no version skew, no flag-mapping field loss.
// Falls back to the CLI via runCli() if the AMP layer can't be loaded.
let ampIo = null;
// Entry types come from the package's single schema (lib/schema.mjs); this
// fallback only applies when the package can't be loaded.
let AGENT_TYPES = ["gotcha","decision","attempt","note","detection","pattern","preference"];
let refreshRuleFiles = null;
let harvestSnapshot = null;
let findProjectRoot = null;
if (INFERNOFLOW_ROOT) {
  try {
    for (const c of [
      path.join(INFERNOFLOW_ROOT, "lib",  "amp", "io.mjs"),
      path.join(INFERNOFLOW_ROOT, "dist", "lib", "amp", "io.mjs"),
    ]) {
      if (fs.existsSync(c)) { ampIo = await import(pathToFileURL(c).href); break; }
    }
    for (const c of [
      path.join(INFERNOFLOW_ROOT, "lib",  "schema.mjs"),
      path.join(INFERNOFLOW_ROOT, "dist", "lib", "schema.mjs"),
    ]) {
      if (fs.existsSync(c)) { const m = await import(pathToFileURL(c).href); if (Array.isArray(m.AGENT_TYPES)) AGENT_TYPES = m.AGENT_TYPES; break; }
    }
    for (const c of [
      path.join(INFERNOFLOW_ROOT, "lib",  "ruleFiles.mjs"),
      path.join(INFERNOFLOW_ROOT, "dist", "lib", "ruleFiles.mjs"),
    ]) {
      if (fs.existsSync(c)) { refreshRuleFiles = (await import(pathToFileURL(c).href)).refreshRuleFilesFromMemory; break; }
    }
    for (const c of [
      path.join(INFERNOFLOW_ROOT, "lib",  "transcript.mjs"),
      path.join(INFERNOFLOW_ROOT, "dist", "lib", "transcript.mjs"),
    ]) {
      if (fs.existsSync(c)) { harvestSnapshot = (await import(pathToFileURL(c).href)).harvestSnapshot; break; }
    }
    for (const c of [
      path.join(INFERNOFLOW_ROOT, "lib",  "projectRoot.mjs"),
      path.join(INFERNOFLOW_ROOT, "dist", "lib", "projectRoot.mjs"),
    ]) {
      if (fs.existsSync(c)) { findProjectRoot = (await import(pathToFileURL(c).href)).findProjectRoot; break; }
    }
  } catch { /* swallow — fallback path handles it */ }
}

// ── Project directory resolution ───────────────────────────────────────────
// NEVER trust process.cwd() to locate .ai-memory. IDEs and the desktop bridge
// routinely launch this server from the wrong place — a monorepo parent, or
// C:\WINDOWS\system32 on Windows — so every amp_* tool looked for .ai-memory
// relative to that wrong cwd and failed with "not initialized". Resolve the
// real project root once, in priority order:
//   1. INFERNOFLOW_PROJECT_DIR   — explicit override (init can bake this into the MCP config)
//   2. WORKSPACE_FOLDER_PATHS[0] — the folder the IDE actually opened (Cursor / VS Code set this)
//   3. findProjectRoot(cwd)      — walk up to .ai-memory / .git / a manifest (subfolder case)
//   4. process.cwd()             — last resort
function resolveProjectDir() {
  const hint = process.env.INFERNOFLOW_PROJECT_DIR
            || (process.env.WORKSPACE_FOLDER_PATHS || "").split(path.delimiter).filter(Boolean)[0];
  const start = (hint && fs.existsSync(hint)) ? hint : process.cwd();
  if (typeof findProjectRoot === "function") {
    try { return findProjectRoot(start); } catch { /* fall through to start */ }
  }
  return start;
}
const PROJECT_DIR = resolveProjectDir();
process.stderr.write(`[infernoflow MCP] project dir: ${PROJECT_DIR}\n`);

// ── Clean-tree policy: regenerate rule files ONCE at boot ──────────────────
// Historically, every amp_write rewrote CLAUDE.md / .cursorrules. That
// dirtied tracked files dozens of times per session and blocked git
// checkout. Now we regenerate exactly once when the MCP server starts —
// enough for the next AI session to boot warm — and never again during
// the session. amp_read serves runtime queries; rule-file content is
// for cold-start injection only.
if (refreshRuleFiles) {
  try { refreshRuleFiles(PROJECT_DIR); } catch { /* non-fatal */ }
}

// ── Boot stamp: record which MCP version is running ──────────────────────
// IDE-loaded MCP servers stay in memory until session restart. After
// `npm install -g infernoflow@<new>` the on-disk wrapper updates but the
// running process is still the old code — silent version skew that
// shipped 0.43→0.44 bugs (file→source field misroute, etc.). We write a
// boot stamp every time the server starts so `infernoflow setup` and
// `infernoflow doctor` can compare against the installed CLI version and
// tell the user when to restart their AI tool.
try {
  const root = (() => { try { return findInfernoflowRoot(); } catch { return null; } })();
  let runtimeVersion = "0.0.0-unknown";
  if (root) {
    try { runtimeVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || runtimeVersion; }
    catch {}
  }
  const memDir = path.join(PROJECT_DIR, ".ai-memory");
  if (fs.existsSync(memDir)) {
    fs.writeFileSync(path.join(memDir, ".mcp-runtime.json"), JSON.stringify({
      version:  runtimeVersion,
      pid:      process.pid,
      bootedAt: new Date().toISOString(),
      source:   "inferno-mcp-server.mjs",
    }, null, 2) + "\n", "utf8");
  }
  // Also surface the version on stderr so users can see it in their IDE's
  // MCP-server log panel — that's the easiest way to verify "the new code
  // is running" without running another command.
  process.stderr.write(`[infernoflow MCP] active — v${runtimeVersion}, pid ${process.pid}\n`);
} catch { /* boot stamp is best-effort; never block the server */ }

/**
 * Run the infernoflow CLI. Returns either the stdout string OR a structured
 * error object so call sites can decide whether to surface it via JSON-RPC
 * sendError() instead of returning gibberish text to the agent.
 *
 * SECURITY: `args` is an ARRAY of separate arguments, passed straight to
 * `node infernoflow.mjs` with execFileSync and no shell. Tool input must never
 * be concatenated into a command string — that allowed command injection
 * through tool arguments (fixed in 0.44.20).
 */
function runCli(args, env = {}) {
  if (!Array.isArray(args) || !args.every(a => typeof a === "string")) {
    return { __error: true, message: "internal: runCli expects an array of strings", stderr: "", stdout: "", status: 1 };
  }
  if (!INFERNOFLOW_BIN) {
    return {
      __error: true,
      message: "infernoflow not installed — install it locally (`npm i infernoflow`) or globally (`npm i -g infernoflow`)",
      stderr: "",
      stdout: "",
      status: 127,
    };
  }
  try {
    return execFileSync(process.execPath, [INFERNOFLOW_BIN, ...args], {
      encoding: "utf8",
      cwd: PROJECT_DIR,
      timeout: 30000,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: false,
    });
  } catch (err) {
    return {
      __error: true,
      message: err.message || "command failed",
      stderr: err.stderr || "",
      stdout: err.stdout || "",
      status: err.status ?? 1,
    };
  }
}

/** True if a runCli() result is actually a structured error. */
function isCmdError(result) {
  return typeof result === "object" && result !== null && result.__error === true;
}

// ── MCP tool surface after Phase 4 truth audit ────────────────────────────
// Mission: session memory. The off-mission contract-iteration tools
// (infernoflow_run / _apply / _implement / _review / _scan_ui) were cut —
// they duplicated CLI commands that are themselves gone, and the fragile
// env-var subprocess handoff for _apply was a recurring bug source.
// What remains is everything an AI agent needs to capture, query, and
// hand off memory between sessions, plus the two read-only contract
// helpers that pair cleanly with the kept CLI surface.
const TOOLS = [
  // ── AMP-spec memory tools (the product) ──────────────────────────────────
  { name: "amp_read",    description: "AMP: read session memory entries with optional filters.", inputSchema: { type: "object", properties: { file: { type: "string", maxLength: 1000 }, type: { type: "string", enum: AGENT_TYPES }, query: { type: "string", maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 200 } } } },
  { name: "amp_write",   description: "AMP: log a new entry. Required: type + msg (one sentence). Optional: file, line, tags, detail. Use 'detail' for a rich multi-paragraph body (repro steps, code, full reasoning, or a session snapshot) — it's stored in a sidecar and loaded on demand, so it never bloats the always-on memory index.", inputSchema: { type: "object", properties: { type: { type: "string", enum: AGENT_TYPES }, msg: { type: "string", maxLength: 2000 }, file: { type: "string", maxLength: 1000 }, line: { type: "integer", minimum: 1, maximum: 10000000 }, tags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 100 } }, detail: { type: "string", maxLength: 200000, description: "Optional rich body (Tier-2). Stored in the consolidated details store; NOT injected into rule files. Put the long-form context here; keep 'msg' to one summary sentence." } }, required: ["type","msg"] } },
  { name: "amp_search",  description: "AMP: search entries by keyword. Optional type filter.", inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 500 }, type: { type: "string", enum: AGENT_TYPES } }, required: ["query"] } },
  { name: "amp_bookmark", description: "AMP: drop a named session bookmark — a resume point. Required: label (short name). Optional: note. If note is OMITTED, the current session transcript is auto-captured as the bookmark's context (the 'save everything here' resume point). Use when the user says 'bookmark this' / 'mark this point', or before a risky change / when the context window is filling up, so the exact state can be recalled later and appears in the next session's handoff. Bookmarks are never auto-pruned.", inputSchema: { type: "object", properties: { label: { type: "string", maxLength: 200 }, note: { type: "string", maxLength: 200000, description: "Optional explicit context. Omit to auto-capture the session transcript instead. Stored in a sidecar; not injected into rule files." } }, required: ["label"] } },
  { name: "amp_resume",  description: "AMP: 'where were we?' in one call — the latest resume point with its note, open dead ends (don't repeat them), recent decisions/notes, uncommitted changes, and which memory store this is. Call it at the start of work in a session. Optional: file (rank entries about that file first).", inputSchema: { type: "object", properties: { file: { type: "string", maxLength: 1000 } } } },
  { name: "amp_handoff", description: "AMP: generate the handoff document for the next AI session. format=markdown|json (default: markdown).", inputSchema: { type: "object", properties: { format: { type: "string", enum: ["markdown","json"] } } } },
  { name: "amp_health",  description: "AMP: get the session health score (0-100, A-F grade).", inputSchema: { type: "object", properties: {} } },

  // ── Read-only contract helpers ───────────────────────────────────────────
  { name: "infernoflow_status",    description: "Show project memory + contract health at a glance.", inputSchema: { type: "object", properties: {} } },
  { name: "infernoflow_check",     description: "Validate the capability contract (read-only).", inputSchema: { type: "object", properties: {} } },
  { name: "infernoflow_context",   description: "Generate AI-ready context for a task.", inputSchema: { type: "object", properties: { intent: { type: "string", maxLength: 1000 }, working: { type: "string", maxLength: 1000 } } } },
  { name: "infernoflow_git_drift", description: "Detect which capabilities may be affected by recent code changes — useful when memory needs branch-aware revalidation.", inputSchema: { type: "object", properties: { sinceCommits: { type: "integer", minimum: 1, maximum: 100, description: "How many commits back to check (default: 1, max: 100)" } } } },
];

// ── Contract tools only where a contract exists (0.46.3) ────────────────────
// Memory mode (the default) has no capability contract, so `check` / `context`
// can only fail there. They're listed only when inferno/contract.json exists
// (an `inferno/` folder alone can be a pre-0.44 memory store), and a call made
// from a cached tool list gets a normal answer instead of an error.
// ── Who is writing (0.46.3) ────────────────────────────────────────────────
// Entries used to be stamped "claude" whatever the client was (Copilot and
// Cursor writes looked like Claude's). The MCP client names itself in
// `initialize` (clientInfo.name) — that is the reliable signal.
let CLIENT_NAME = "";
function agentFromClient(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return "";
  if (n.includes("claude")) return "claude";            // claude-code, claude-ai (Desktop)
  if (n.includes("cursor")) return "cursor";
  if (n.includes("windsurf") || n.includes("codeium")) return "windsurf";
  if (n.includes("copilot") || n.includes("visual studio code") || n.includes("vscode")) return "copilot";
  return n.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "other";
}
function agentName() {
  const forced = String(process.env.INFERNOFLOW_AGENT || "").trim();
  if (forced) return forced.slice(0, 32);
  const fromClient = agentFromClient(CLIENT_NAME);
  if (fromClient) return fromClient;
  if (process.env.CLAUDECODE === "1" || process.env.CLAUDE_CODE_SESSION) return "claude";
  if (process.env.CURSOR_SESSION) return "cursor";
  if (process.env.COPILOT_SESSION) return "copilot";
  return "other";
}

const CONTRACT_TOOLS = new Set(["infernoflow_check", "infernoflow_context"]);
function hasContract() {
  try { return fs.existsSync(path.join(PROJECT_DIR, "inferno", "contract.json")); } catch { return false; }
}
function listedTools() {
  return hasContract() ? TOOLS : TOOLS.filter(t => !CONTRACT_TOOLS.has(t.name));
}
const NO_CONTRACT_TEXT =
  "This project uses memory mode — no capability contract is set up, so there is nothing to check or build context from. " +
  "For project memory use amp_resume (where were we?), amp_search or amp_read. " +
  "To enable capability contracts: infernoflow init --mode full --adopt";

// ── Input validation ─────────────────────────────────────────────────────────
// SECURITY: tool arguments come from the model, and the model can be steered by
// anything it reads (a README, an issue, a memory entry pulled from git). The
// inputSchema above is advisory to the client only — nothing enforces it — so
// we enforce it here, before any argument reaches the CLI, git or the disk.
// Unknown properties are dropped (not rejected) so a chatty client still works.
const TOOL_SCHEMAS = new Map(TOOLS.map(t => [t.name, t.inputSchema]));

function checkValue(key, v, spec) {
  const t = spec.type;
  if (t === "string") {
    if (typeof v !== "string") return `'${key}' must be a string`;
    if (spec.maxLength && v.length > spec.maxLength) return `'${key}' is too long (max ${spec.maxLength} characters)`;
    if (v.includes("\u0000")) return `'${key}' must not contain NUL characters`;
  } else if (t === "integer" || t === "number") {
    if (typeof v !== "number" || !Number.isFinite(v)) return `'${key}' must be a number`;
    if (t === "integer" && !Number.isInteger(v)) return `'${key}' must be a whole number`;
    if (spec.minimum !== undefined && v < spec.minimum) return `'${key}' must be >= ${spec.minimum}`;
    if (spec.maximum !== undefined && v > spec.maximum) return `'${key}' must be <= ${spec.maximum}`;
  } else if (t === "array") {
    if (!Array.isArray(v)) return `'${key}' must be an array`;
    if (spec.maxItems && v.length > spec.maxItems) return `'${key}' has too many items (max ${spec.maxItems})`;
    for (const item of v) { const e = checkValue(`${key}[]`, item, spec.items || {}); if (e) return e; }
  }
  if (spec.enum && !spec.enum.includes(v)) return `'${key}' must be one of: ${spec.enum.join(", ")}`;
  return null;
}

/** Returns { ok: true, value } with only known, valid properties, or { ok: false, error }. */
function validateToolInput(name, input) {
  const schema = TOOL_SCHEMAS.get(name);
  if (!schema) return { ok: false, error: `Unknown tool: ${name}` };
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "arguments must be an object" };
  const props = schema.properties || {};
  const value = {};
  for (const [key, spec] of Object.entries(props)) {
    const v = input[key];
    if (v === undefined || v === null) continue;
    const err = checkValue(key, v, spec);
    if (err) return { ok: false, error: `Invalid arguments for ${name}: ${err}` };
    value[key] = v;
  }
  for (const req of schema.required || []) {
    if (value[req] === undefined || value[req] === "") return { ok: false, error: `Invalid arguments for ${name}: '${req}' is required` };
  }
  return { ok: true, value };
}

/**
 * Free text that is handed to the CLI as an argument. The CLI's own parser
 * treats any argument equal to a flag name (e.g. "--watch", "--auto-push") as
 * that flag, even when it arrives as a separate argv entry. Strip leading
 * dashes so tool text can never be read as a CLI option.
 */
function asCliText(v) {
  return String(v ?? "").replace(/^[\s-]+/, "");
}

// ── git drift detection (inline — no external imports in this template file) ─
function detectGitDrift(sinceCommits) {
  const cwd = PROJECT_DIR;
  const infernoDir = path.join(cwd, "inferno");

  // SECURITY: git is run with an argument array and no shell.
  // Returns the output, or null when git fails — a failure must never look
  // like "nothing changed" (0.46.3: it used to report "No changed files" in a
  // folder that is not a repository, or that has no commits yet).
  const runGit = (args, input) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000, input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"], windowsHide: true, shell: false });
    } catch { return null; }
  };
  const n = Number.isInteger(sinceCommits) && sinceCommits >= 1 && sinceCommits <= 100 ? sinceCommits : 1;

  if ((runGit(["rev-parse", "--is-inside-work-tree"]) || "").trim() !== "true") {
    return "Git drift is unavailable: this project folder is not a git repository (or git is not installed), so changes can't be detected. Nothing was checked.";
  }

  const changedSet = new Set();
  const addLines = (out) => (out || "").split("\n").map(l => l.trim()).filter(Boolean).forEach(f => changedSet.add(f));
  let note = "";

  const hasHead = runGit(["rev-parse", "--verify", "-q", "HEAD"]) !== null;
  if (!hasHead) {
    // No commits yet: everything in the index plus untracked files is new.
    note = "This repository has no commits yet — every file counts as changed.";
    addLines(runGit(["ls-files"]));
  } else {
    let base = `HEAD~${n}`;
    if (runGit(["rev-parse", "--verify", "-q", `HEAD~${n}^{commit}`]) === null) {
      if ((runGit(["rev-parse", "--is-shallow-repository"]) || "").trim() === "true") {
        // A shallow clone (CI, cloud agents): older history isn't here. Compare
        // with the oldest commit we have — not with an empty tree, which would
        // list every file in the project as changed.
        base = ((runGit(["rev-list", "--max-parents=0", "HEAD"]) || "").trim().split("\n")[0] || "").trim();
        note = "Shallow clone — only part of the history was fetched, so changes are compared with the oldest fetched commit (changes made in that commit itself can't be seen).";
      } else {
        // Fewer commits than asked for: compare with the start of history.
        base = (runGit(["hash-object", "-t", "tree", "--stdin"], "") || "").trim();
        const count = parseInt((runGit(["rev-list", "--count", "HEAD"]) || "").trim(), 10);
        note = Number.isInteger(count) && count > 0
          ? `Only ${count} commit${count === 1 ? "" : "s"} in this repository — compared against the start of history.`
          : `Fewer than ${n} commits in this repository — compared against the start of history.`;
      }
    }
    const committed = base ? runGit(["diff", "--name-only", base, "HEAD"]) : null;
    if (committed === null) return "Git drift failed: git could not compare the last " + n + " commit(s). Nothing was checked.";
    addLines(runGit(["diff", "--name-only", "HEAD"]));
    addLines(committed);
  }
  addLines(runGit(["ls-files", "--others", "--exclude-standard"]));

  const changedFiles = Array.from(changedSet).sort();
  if (!changedFiles.length) return (note ? note + "\n" : "") + `No changed files in the last ${n} commit${n === 1 ? "" : "s"} or the working tree.`;

  // Memory mode: there are no capabilities to map files to — just list them.
  if (!hasContract()) {
    const out = [`## infernoflow git drift report`, ...(note ? [note] : []), `Changed files (last ${n} commit${n === 1 ? "" : "s"} + working tree): ${changedFiles.length}`, ""];
    for (const f of changedFiles.slice(0, 30)) out.push(`  - ${f}`);
    if (changedFiles.length > 30) out.push(`  ... +${changedFiles.length - 30} more`);
    out.push("", "Before relying on memory about these files, check it with amp_search (entries may describe code that has since changed).");
    return out.join("\n");
  }

  // Load capabilities registry
  let capabilities = [];
  try {
    const capsPath = path.join(infernoDir, "capabilities.json");
    if (fs.existsSync(capsPath)) capabilities = JSON.parse(fs.readFileSync(capsPath, "utf8")).capabilities || [];
  } catch {}

  // Load capability-map if present
  let capMap = null;
  try {
    const mapPath = path.join(infernoDir, "capability-map.json");
    if (fs.existsSync(mapPath)) capMap = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  } catch {}

  const capHits = new Map();
  const mappedFiles = new Set();

  const addHit = (capId, capTitle, file) => {
    if (!capHits.has(capId)) capHits.set(capId, { id: capId, title: capTitle || capId, files: new Set() });
    capHits.get(capId).files.add(file);
    mappedFiles.add(file);
  };

  // Strategy 1: capability-map.json
  if (capMap) {
    for (const file of changedFiles) {
      for (const [prefix, capIds] of Object.entries(capMap)) {
        if (file.startsWith(prefix.replace(/\\/g, "/"))) {
          for (const capId of capIds) {
            const cap = capabilities.find(c => c.id === capId);
            addHit(capId, cap?.title, file);
          }
        }
      }
    }
  }

  // Strategy 2: heuristic keyword matching on filename
  const RULES = [
    { kw: ["search"], id: "SearchItems" }, { kw: ["filter"], id: "FilterItems" },
    { kw: ["auth", "login", "logout"], id: "Authentication" },
    { kw: ["create", "add", "new"], id: "CreateItem" },
    { kw: ["update", "edit"], id: "UpdateItem" },
    { kw: ["delete", "remove"], id: "DeleteItem" },
    { kw: ["list", "read", "view"], id: "ReadItems" },
    { kw: ["due", "deadline"], id: "SetDueDate" },
    { kw: ["priority"], id: "SetPriority" },
    { kw: ["complete", "toggle"], id: "ToggleComplete" },
  ];
  for (const file of changedFiles) {
    if (mappedFiles.has(file)) continue;
    const lower = file.toLowerCase();
    for (const rule of RULES) {
      if (rule.kw.some(k => lower.includes(k))) {
        const cap = capabilities.find(c => c.id === rule.id);
        addHit(rule.id, cap?.title, file);
        break;
      }
    }
  }

  const unmapped = changedFiles.filter(f => !mappedFiles.has(f));
  const affected = Array.from(capHits.values());

  // Format output
  const lines = [
    `## infernoflow git drift report`,
    ...(note ? [note] : []),
    `Changed files: ${changedFiles.length}`,
    `Affected capabilities: ${affected.length}`,
    "",
  ];

  if (affected.length) {
    lines.push("### Capabilities likely needing contract review:");
    for (const cap of affected) {
      lines.push(`\n**${cap.id}** — ${cap.title}`);
      for (const f of cap.files) lines.push(`  - ${f}`);
    }
    lines.push("");
    lines.push("### Suggested action:");
    lines.push(`Call infernoflow_run with task "review changes to ${affected.map(c => c.id).join(", ")}" to update the contract.`);
  } else {
    lines.push("No capability matches found for changed files.");
    lines.push("Consider updating inferno/capability-map.json to map your source paths to capabilities.");
  }

  if (unmapped.length) {
    lines.push(`\n### Unmapped changed files (${unmapped.length}):`);
    for (const f of unmapped.slice(0, 10)) lines.push(`  - ${f}`);
    if (unmapped.length > 10) lines.push(`  ... +${unmapped.length - 10} more`);
  }

  return lines.join("\n");
}

// ── D5 (0.46.0): write to the repo the entry is about ─────────────────────
// In a multi-folder workspace the server runs for one project, but the agent
// may be working on files of another open folder. When amp_write / bookmark
// name a `file` inside ANOTHER workspace root that has its own .ai-memory,
// the entry goes there. Only roots the IDE itself reports are considered
// (WORKSPACE_FOLDER_PATHS) — never an arbitrary path from the tool input.
function workspaceRoots() {
  const roots = (process.env.WORKSPACE_FOLDER_PATHS || "").split(path.delimiter).filter(Boolean);
  const out = [];
  for (const r of roots) {
    try { const real = fs.realpathSync(r); if (fs.existsSync(path.join(real, ".ai-memory"))) out.push(real); } catch { /* gone */ }
  }
  return out;
}
/** Real path of p, resolving symlinks in the part that exists (macOS /var → /private/var). */
function realish(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); }
    catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}
function routeByFile(file) {
  const fallback = { dir: PROJECT_DIR, file };
  if (!file) return fallback;
  let abs;
  try { abs = realish(path.resolve(PROJECT_DIR, String(file))); } catch { return fallback; }
  const inside = (root) => { const rel = path.relative(root, abs); return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : null; };
  // Store paths relative to their project (no absolute paths in shared memory).
  const projectReal = realish(PROJECT_DIR);
  const own = inside(projectReal);
  if (own) return { dir: PROJECT_DIR, file: own.split(path.sep).join("/") };
  for (const root of workspaceRoots()) {
    if (root === projectReal) continue;
    const rel = inside(root);
    if (rel) return { dir: root, file: rel.split(path.sep).join("/") };
  }
  // Outside every known root: keep the entry here but don't store an absolute
  // path (it would leak this machine's layout into shared memory).
  return { dir: PROJECT_DIR, file: path.isAbsolute(String(file)) ? undefined : file };
}

function handleTool(id, name, rawInput) {
  try {
    const checked = validateToolInput(name, rawInput);
    if (!checked.ok) {
      const code = checked.error.startsWith("Unknown tool") ? -32601 : -32602;
      return sendError(id, code, checked.error);
    }
    const input = checked.value;
    let text = "";
    if (CONTRACT_TOOLS.has(name) && !hasContract()) {
      return sendResult(id, { content: [{ type: "text", text: NO_CONTRACT_TEXT }] });
    }
    // ── Read-only contract helpers ─────────────────────────────────────────
    if (name === "infernoflow_check") {
      text = runCli(["check"]);
    } else if (name === "infernoflow_status") {
      text = runCli(["status"]);
    } else if (name === "infernoflow_context") {
      const args = ["context"];
      if (input.intent)  args.push("--intent",  asCliText(input.intent));
      if (input.working) args.push("--working", asCliText(input.working));
      text = runCli(args);
    } else if (name === "infernoflow_git_drift") {
      text = detectGitDrift(input.sinceCommits ?? 1);

    // ── AMP-spec memory tools ──────────────────────────────────────────────
    } else if (name === "amp_read") {
      const args = ["ask"];
      if (input.query) args.push(asCliText(input.query));
      if (input.type)  args.push("--type", input.type);
      if (input.limit) args.push("--limit", String(input.limit));
      if (input.file)  args.push("--file", asCliText(input.file));   // D16: rank by file
      text = runCli(args);
    } else if (name === "amp_resume") {
      const args = ["resume"];
      if (input.file) args.push("--file", asCliText(input.file));
      text = runCli(args);
    } else if (name === "amp_write") {
      // Prefer in-process write: no subprocess, no `npx` version skew, and
      // file/line/tags reach disk unchanged. The CLI fallback below is only
      // used when infernoflow's AMP layer can't be imported.
      if (ampIo) {
        const entry = {
          ts:      new Date().toISOString(),
          type:    input.type || "note",
          summary: input.msg || "",
          agent:   agentName(),
        };
        const routed = routeByFile(input.file);
        if (routed.file)                      entry.file = routed.file;
        if (input.line)                       entry.line = input.line;
        if (input.tags && input.tags.length)  entry.tags = input.tags;
        if (input.detail && String(input.detail).trim()) entry.detail = String(input.detail);
        try {
          const written = ampIo.appendEntry(routed.dir, entry);
          // NOTE: rule-file refresh deliberately NOT called here — clean-tree
          // policy regenerates them once at MCP boot only. Doing it on every
          // write dirties tracked files and blocks `git checkout`. Within a
          // session, the agent uses amp_read for fresh queries; rule files
          // are for cold-start injection of the *next* session.
          // D3 (0.45.0): always say which store was written, so a wrong store is visible.
          text = (typeof ampIo.describeStore === "function" ? ampIo.describeStore(routed.dir) + "\n" : "") +
                 (routed.dir !== PROJECT_DIR ? `↪ routed to ${path.basename(routed.dir)} (the file belongs to that workspace folder)\n` : "") +
                 `✔ Logged [${written.type}] ${written.id}\n  msg:  ${written.msg}` +
                 (written.meta && written.meta.redacted ? `\n  ⚠ secrets redacted: ${written.meta.redacted.join(", ")}` : "") +
                 (written.file ? `\n  file: ${written.file}${written.line ? ":" + written.line : ""}` : "") +
                 (written.tags ? `\n  tags: ${written.tags.join(", ")}` : "") +
                 (written.meta && written.meta.detailRef ? `\n  detail: ${written.meta.detailRef}` : "");
        } catch (err) {
          return sendError(id, -32000, `amp_write failed (in-process): ${err.message}`);
        }
      } else {
        // Fallback: run the CLI (argument array, no shell). Pass
        // --file/--line/--tags through so they're not silently dropped.
        const args = ["log", asCliText(input.msg), "--type", input.type || "note"];
        if (input.file)                      args.push("--file", asCliText(input.file));
        if (input.line)                      args.push("--line", String(input.line));
        if (input.tags && input.tags.length) args.push("--tags", input.tags.map(asCliText).join(","));
        args.push("--agent", agentName());
        text = runCli(args);
      }
    } else if (name === "amp_bookmark") {
      // A bookmark is a `note` entry tagged "bookmark"; the optional `note`
      // becomes its Tier-2 detail (a resume point the next session can recall).
      if (ampIo) {
        const entry = {
          ts:      new Date().toISOString(),
          type:    "note",
          summary: input.label || "",
          agent:   agentName(),
          tags:    ["bookmark"],
        };
        // Context: explicit note wins; otherwise auto-capture the session
        // transcript (the "save everything here" resume point).
        if (input.note && String(input.note).trim()) {
          entry.detail = String(input.note);
        } else if (harvestSnapshot) {
          // Automatic transcript snapshots stay on this machine (gitignored store).
          try { const snap = harvestSnapshot(PROJECT_DIR); if (snap) { entry.detail = snap; entry.detailLocal = true; } } catch { /* best-effort */ }
        }
        try {
          const written = ampIo.appendEntry(PROJECT_DIR, entry);
          text = (typeof ampIo.describeStore === "function" ? ampIo.describeStore(PROJECT_DIR) + "\n" : "") +
                 `🔖 Bookmark saved: ${written.msg} (${written.id})` +
                 (written.meta && written.meta.redacted ? `\n  ⚠ secrets redacted: ${written.meta.redacted.join(", ")}` : "") +
                 (written.meta && written.meta.detailRef ? `\n  context: ${written.meta.detailRef}` : "");
        } catch (err) {
          return sendError(id, -32000, `amp_bookmark failed (in-process): ${err.message}`);
        }
      } else {
        const args = ["bookmark", asCliText(input.label)];
        if (input.note) args.push("--note", asCliText(input.note));
        args.push("--agent", agentName());
        text = runCli(args);
      }
    } else if (name === "amp_handoff") {
      // switch writes a file; we read it back to return the content
      const switchResult = runCli(["switch"]);
      if (isCmdError(switchResult)) {
        return sendError(id, -32000, `infernoflow switch failed: ${switchResult.message}\n${switchResult.stderr || switchResult.stdout || ""}`.trim());
      }
      try {
        const ampPath    = path.join(PROJECT_DIR, ".ai-memory", "handoff.md");
        const legacyPath = path.join(PROJECT_DIR, "inferno",    "HANDOFF.md");
        const target = fs.existsSync(ampPath) ? ampPath : legacyPath;
        text = fs.readFileSync(target, "utf8");
        if (input.format === "json") {
          // very small markdown-to-json — caller can re-parse if needed
          text = JSON.stringify({ handoff: text });
        }
      } catch (err) {
        text = "(handoff generated; could not read back: " + err.message + ")";
      }
    } else if (name === "amp_search") {
      const args = ["ask", asCliText(input.query)];
      if (input.type) args.push("--type", input.type);
      text = runCli(args);
    } else if (name === "amp_health") {
      const recap = runCli(["recap", "--json"]);
      if (isCmdError(recap)) {
        text = runCli(["status"]);
      } else {
        text = recap.trim() || runCli(["status"]);
      }

    } else { return sendError(id, -32601, `Unknown tool: ${name}`); }

    // Central error check — if any runCli() call produced a structured error,
    // surface it as a real JSON-RPC error so the calling AI sees a proper
    // failure instead of garbled stderr text mixed into a "successful" reply.
    if (isCmdError(text)) {
      const detail = (text.stderr || text.stdout || "").trim();
      const fullMsg = detail
        ? `infernoflow CLI failed: ${text.message}\n${detail}`
        : `infernoflow CLI failed: ${text.message}`;
      return sendError(id, -32000, fullMsg);
    }
    sendResult(id, { content: [{ type: "text", text: text || "(no output)" }] });
  } catch (err) { sendError(id, -32000, err.message); }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === "initialize") {
    try { CLIENT_NAME = String((params && params.clientInfo && params.clientInfo.name) || "").slice(0, 100); } catch { CLIENT_NAME = ""; }
    sendResult(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "infernoflow", version: "1.0.0" } });
    return;
  }
  if (method === "tools/list") { sendResult(id, { tools: listedTools() }); return; }
  if (method === "tools/call") { handleTool(id, params.name, params.arguments || {}); return; }
  if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
});
process.stderr.write("[infernoflow MCP] started\n");