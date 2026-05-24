import { execSync } from "node:child_process";
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
    const lookup = process.platform === "win32" ? "where infernoflow" : "which infernoflow";
    const out = execSync(lookup, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    for (const candidate of out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
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
// Returns null if nothing is found; runCmd surfaces a clear error in that case.
function resolveInfernoflowBin() {
  if (INFERNOFLOW_ROOT) {
    for (const c of [
      path.join(INFERNOFLOW_ROOT, "dist", "bin", "infernoflow.mjs"),
      path.join(INFERNOFLOW_ROOT, "bin",  "infernoflow.mjs"),
    ]) if (fs.existsSync(c)) return c;
  }
  try {
    const lookup = process.platform === "win32" ? "where infernoflow" : "which infernoflow";
    const out = execSync(lookup, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const first = out.split(/\r?\n/)[0];
    if (first && fs.existsSync(first)) return first;
  } catch {}
  return null;
}

const INFERNOFLOW_BIN = resolveInfernoflowBin();

// In-process AMP I/O loader. When available, amp_write / amp_read bypass the
// CLI entirely — no subprocess, no version skew, no flag-mapping field loss.
// Falls back to shell-out via runCmd() if the AMP layer can't be loaded.
let ampIo = null;
let refreshRuleFiles = null;
if (INFERNOFLOW_ROOT) {
  try {
    for (const c of [
      path.join(INFERNOFLOW_ROOT, "lib",  "amp", "io.mjs"),
      path.join(INFERNOFLOW_ROOT, "dist", "lib", "amp", "io.mjs"),
    ]) {
      if (fs.existsSync(c)) { ampIo = await import(pathToFileURL(c).href); break; }
    }
    for (const c of [
      path.join(INFERNOFLOW_ROOT, "lib",  "ruleFiles.mjs"),
      path.join(INFERNOFLOW_ROOT, "dist", "lib", "ruleFiles.mjs"),
    ]) {
      if (fs.existsSync(c)) { refreshRuleFiles = (await import(pathToFileURL(c).href)).refreshRuleFilesFromMemory; break; }
    }
  } catch { /* swallow — fallback path handles it */ }
}

// ── Clean-tree policy: regenerate rule files ONCE at boot ──────────────────
// Historically, every amp_write rewrote CLAUDE.md / .cursorrules. That
// dirtied tracked files dozens of times per session and blocked git
// checkout. Now we regenerate exactly once when the MCP server starts —
// enough for the next AI session to boot warm — and never again during
// the session. amp_read serves runtime queries; rule-file content is
// for cold-start injection only.
if (refreshRuleFiles) {
  try { refreshRuleFiles(process.cwd()); } catch { /* non-fatal */ }
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
  const memDir = path.join(process.cwd(), ".ai-memory");
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
 */
function runCmd(args, env = {}) {
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
    const isMjs = INFERNOFLOW_BIN.toLowerCase().endsWith(".mjs");
    const cmd = isMjs
      ? `"${process.execPath}" "${INFERNOFLOW_BIN}" ${args}`
      : `"${INFERNOFLOW_BIN}" ${args}`;
    return execSync(cmd, {
      encoding: "utf8",
      cwd: process.cwd(),
      timeout: 30000,
      env: { ...process.env, ...env },
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

/** True if a runCmd() result is actually a structured error. */
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
  { name: "amp_read",    description: "AMP: read session memory entries with optional filters.", inputSchema: { type: "object", properties: { file: { type: "string" }, type: { type: "string", enum: ["gotcha","decision","attempt","note","detection","pattern"] }, query: { type: "string" }, limit: { type: "number" } } } },
  { name: "amp_write",   description: "AMP: log a new entry. Required: type + msg. Optional: file, line, tags.", inputSchema: { type: "object", properties: { type: { type: "string", enum: ["gotcha","decision","attempt","note","detection","pattern"] }, msg: { type: "string" }, file: { type: "string" }, line: { type: "number" }, tags: { type: "array", items: { type: "string" } } }, required: ["type","msg"] } },
  { name: "amp_search",  description: "AMP: search entries by keyword. Optional type filter.", inputSchema: { type: "object", properties: { query: { type: "string" }, type: { type: "string", enum: ["gotcha","decision","attempt","note","detection","pattern"] } }, required: ["query"] } },
  { name: "amp_handoff", description: "AMP: generate the handoff document for the next AI session. format=markdown|json (default: markdown).", inputSchema: { type: "object", properties: { format: { type: "string", enum: ["markdown","json"] } } } },
  { name: "amp_health",  description: "AMP: get the session health score (0-100, A-F grade).", inputSchema: { type: "object", properties: {} } },

  // ── Read-only contract helpers ───────────────────────────────────────────
  { name: "infernoflow_status",    description: "Show project memory + contract health at a glance.", inputSchema: { type: "object", properties: {} } },
  { name: "infernoflow_check",     description: "Validate the capability contract (read-only).", inputSchema: { type: "object", properties: {} } },
  { name: "infernoflow_context",   description: "Generate AI-ready context for a task.", inputSchema: { type: "object", properties: { intent: { type: "string" }, working: { type: "string" } } } },
  { name: "infernoflow_git_drift", description: "Detect which capabilities may be affected by recent code changes — useful when memory needs branch-aware revalidation.", inputSchema: { type: "object", properties: { sinceCommits: { type: "number", description: "How many commits back to check (default: 1)" } } } },
];

// ── git drift detection (inline — no external imports in this template file) ─
function detectGitDrift(sinceCommits) {
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  const runGit = (cmd) => {
    try { return execSync(cmd, { cwd, encoding: "utf8", timeout: 10_000 }); }
    catch { return ""; }
  };

  const changedSet = new Set();
  const addLines = (out) => out.split("\n").map(l => l.trim()).filter(Boolean).forEach(f => changedSet.add(f));

  addLines(runGit("git diff --name-only HEAD"));
  addLines(runGit(`git diff --name-only HEAD~${sinceCommits} HEAD`));
  addLines(runGit("git ls-files --others --exclude-standard"));

  const changedFiles = Array.from(changedSet).sort();
  if (!changedFiles.length) return "No changed files detected since last commit.";

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

function handleTool(id, name, input) {
  try {
    let text = "";
    // ── Read-only contract helpers ─────────────────────────────────────────
    if (name === "infernoflow_check") {
      text = runCmd("check");
    } else if (name === "infernoflow_status") {
      text = runCmd("status");
    } else if (name === "infernoflow_context") {
      const parts = [];
      if (input.intent) parts.push(`--intent "${input.intent}"`);
      if (input.working) parts.push(`--working "${input.working}"`);
      text = runCmd("context " + parts.join(" "));
    } else if (name === "infernoflow_git_drift") {
      text = detectGitDrift(input.sinceCommits || 1);

    // ── AMP-spec memory tools ──────────────────────────────────────────────
    } else if (name === "amp_read") {
      const args = [];
      if (input.query) args.push(JSON.stringify(input.query));
      if (input.type)  args.push("--type", input.type);
      if (input.limit) args.push("--limit", String(input.limit));
      text = runCmd("ask " + args.join(" "));
    } else if (name === "amp_write") {
      // Prefer in-process write: no subprocess, no `npx` version skew, and
      // file/line/tags reach disk unchanged. The CLI fallback below is only
      // used when infernoflow's AMP layer can't be imported.
      if (ampIo) {
        const entry = {
          ts:      new Date().toISOString(),
          type:    input.type || "note",
          summary: input.msg || "",
          agent:   process.env.INFERNOFLOW_AGENT
                   || (process.env.CLAUDE_CODE_SESSION ? "claude"
                   :  process.env.CURSOR_SESSION       ? "cursor"
                   :  process.env.COPILOT_SESSION      ? "copilot"
                   :                                     "claude"),
        };
        if (input.file)                       entry.file = input.file;
        if (input.line)                       entry.line = input.line;
        if (input.tags && input.tags.length)  entry.tags = input.tags;
        try {
          const written = ampIo.appendEntry(process.cwd(), entry);
          // NOTE: rule-file refresh deliberately NOT called here — clean-tree
          // policy regenerates them once at MCP boot only. Doing it on every
          // write dirties tracked files and blocks `git checkout`. Within a
          // session, the agent uses amp_read for fresh queries; rule files
          // are for cold-start injection of the *next* session.
          text = `✔ Logged [${written.type}] ${written.id}\n  msg:  ${written.msg}` +
                 (written.file ? `\n  file: ${written.file}${written.line ? ":" + written.line : ""}` : "") +
                 (written.tags ? `\n  tags: ${written.tags.join(", ")}` : "");
        } catch (err) {
          return sendError(id, -32000, `amp_write failed (in-process): ${err.message}`);
        }
      } else {
        // Fallback: shell-out. Pass --file/--line/--tags through the CLI so
        // they're not silently dropped like in the original implementation.
        const t = (input.type || "note").replace(/[^a-z]/g, "");
        const m = JSON.stringify(input.msg || "");
        const extras = [];
        if (input.file)                      extras.push("--file", JSON.stringify(input.file));
        if (input.line)                      extras.push("--line", String(input.line));
        if (input.tags && input.tags.length) extras.push("--tags", JSON.stringify(input.tags.join(",")));
        text = runCmd(`log ${m} --type ${t} ${extras.join(" ")}`);
      }
    } else if (name === "amp_handoff") {
      // switch writes a file; we read it back to return the content
      const switchResult = runCmd("switch");
      if (isCmdError(switchResult)) {
        return sendError(id, -32000, `infernoflow switch failed: ${switchResult.message}\n${switchResult.stderr || switchResult.stdout || ""}`.trim());
      }
      try {
        const ampPath    = path.join(process.cwd(), ".ai-memory", "handoff.md");
        const legacyPath = path.join(process.cwd(), "inferno",    "HANDOFF.md");
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
      const args = [JSON.stringify(input.query || "")];
      if (input.type) args.push("--type", input.type);
      text = runCmd("ask " + args.join(" "));
    } else if (name === "amp_health") {
      const recap = runCmd("recap --json");
      if (isCmdError(recap)) {
        text = runCmd("status");
      } else {
        text = recap.trim() || runCmd("status");
      }

    } else { return sendError(id, -32601, `Unknown tool: ${name}`); }

    // Central error check — if any runCmd() call produced a structured error,
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
  if (method === "initialize") { sendResult(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "infernoflow", version: "1.0.0" } }); return; }
  if (method === "tools/list") { sendResult(id, { tools: TOOLS }); return; }
  if (method === "tools/call") { handleTool(id, params.name, params.arguments || {}); return; }
  if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
});
process.stderr.write("[infernoflow MCP] started\n");