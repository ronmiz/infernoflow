/**
 * Per-project MCP registration (0.45.0).
 *
 * Problem this replaces: `setup` (and the silent upgrade backfill) wrote ONE
 * user-level `infernoflow` entry into ~/.claude.json and the Claude Desktop
 * config, pinned to whichever project ran it last. Every session in every repo
 * then read and wrote that one project's memory, and Claude Code ran a server
 * file that lived inside that repo (git-tracked) for all projects, without the
 * project-trust prompt.
 *
 * Now:
 *   - Claude Code  → the project's own `.mcp.json` (project scope wins over user
 *                    scope for the same server name). Gitignored when we create
 *                    it, because it holds this machine's paths. A tracked
 *                    `.mcp.json` is never modified.
 *   - Claude Desktop (no project scope) → one entry PER PROJECT, named
 *                    `infernoflow-<repo>`; never overwrites another project's.
 *   - Cursor / VS Code → their per-project files, as before.
 *   - Every config runs `node <installed package>/bin/infernoflow.mjs mcp`, i.e.
 *     the server shipped with the installed CLI — not a copy inside the repo.
 *   - The old pinned user-level `infernoflow` entry is removed (backup first).
 */
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the running CLI entry point (lib/ → ../bin, dist/lib → dist/bin). */
export function cliEntryPath() {
  return path.resolve(__dirname, "..", "bin", "infernoflow.mjs");
}

/** True when running from npx's throw-away cache — configs pointing there break when it is cleared. */
export function runningFromNpxCache() {
  return /[\\/]_npx[\\/]/.test(cliEntryPath());
}

/** The server definition every config gets. `node` is a real executable on every OS (no cmd /c needed). */
export function mcpServerEntry(projectDir) {
  return { command: "node", args: [cliEntryPath(), "mcp"], env: { INFERNOFLOW_PROJECT_DIR: projectDir } };
}

function readJson(file) {
  if (!fs.existsSync(file)) return { data: {}, existed: false, ok: true };
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return { data: {}, existed: true, ok: false };
    return { data, existed: true, ok: true };
  } catch { return { data: {}, existed: true, ok: false }; }
}

/**
 * Write via temp file + rename so a concurrent reader (Claude Code / Desktop
 * rewriting their own config) never sees a half-written file.
 */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.infernoflow-${process.pid}-${Date.now()}.tmp`;
  let mode;
  try { mode = fs.statSync(file).mode & 0o777; } catch { /* new file */ }
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2).replace(/\u0000+/g, "") + "\n", { encoding: "utf8", ...(mode ? { mode } : {}) });
  try { fs.renameSync(tmp, file); }
  catch (err) { try { fs.unlinkSync(tmp); } catch {} throw err; }
}

function sameEntry(a, b) {
  return !!a && !!b && a.command === b.command && JSON.stringify(a.args) === JSON.stringify(b.args)
    && (a.env || {}).INFERNOFLOW_PROJECT_DIR === (b.env || {}).INFERNOFLOW_PROJECT_DIR;
}

/** True if `rel` is tracked by git in `projectDir` (false when git is missing / not a repo). */
export function isGitTracked(projectDir, rel) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", rel], { cwd: projectDir, stdio: "ignore", windowsHide: true, timeout: 5000 });
    return true;
  } catch { return false; }
}

/** Append `line` to the project's .gitignore unless an identical line is already there. */
export function ensureGitignoreLine(projectDir, line, comment) {
  const gi = path.join(projectDir, ".gitignore");
  let text = "";
  try { text = fs.readFileSync(gi, "utf8"); } catch { /* new file */ }
  if (text.split(/\r?\n/).some(l => l.trim() === line)) return false;
  const add = (text && !text.endsWith("\n") ? "\n" : "") + (comment ? `# ${comment}\n` : "") + line + "\n";
  fs.writeFileSync(gi, text + add, "utf8");
  return true;
}

/** Back up a file before we remove anything from it. Returns the backup path or null. */
function backupFile(file) {
  try {
    const dir = path.join(process.env.INFERNOFLOW_HOME || path.join(os.homedir(), ".infernoflow"), "backups");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dst = path.join(dir, `${path.basename(file)}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`);
    fs.copyFileSync(file, dst);
    // These configs can hold other tools' credentials — keep the copy owner-only.
    try { fs.chmodSync(dst, 0o600); } catch { /* Windows: ACLs */ }
    return dst;
  } catch { return null; }
}

/** Claude Code: project `.mcp.json`. */
export function updateProjectMcpJson(projectDir) {
  const rel  = ".mcp.json";
  const file = path.join(projectDir, rel);
  const existed = fs.existsSync(file);
  if (existed && isGitTracked(projectDir, rel)) {
    // Never put this machine's absolute paths into a file the team shares.
    return { updated: false, skipped: "tracked", path: file };
  }
  const { data, ok } = readJson(file);
  if (!ok) return { updated: false, skipped: "unreadable", path: file };
  if (!data.mcpServers || typeof data.mcpServers !== "object") data.mcpServers = {};
  const want = mcpServerEntry(projectDir);
  // Not tracked (new, or existing but never committed): it is about to hold
  // this machine's absolute paths, so keep it out of git.
  let gitignored = false;
  try { gitignored = ensureGitignoreLine(projectDir, ".mcp.json", "infernoflow: machine-specific MCP config (absolute paths) — not for git"); } catch { /* best effort */ }
  if (sameEntry(data.mcpServers.infernoflow, want)) return { updated: false, path: file, gitignored };
  data.mcpServers.infernoflow = want;
  writeJson(file, data);
  return { updated: true, path: file, created: !existed, gitignored };
}

/** Cursor (.cursor/mcp.json → mcpServers) and VS Code (.vscode/mcp.json → servers, type stdio). */
export function updateIdeMcpJson(projectDir, which) {
  const isVsCode = which === "vscode";
  const file = path.join(projectDir, isVsCode ? ".vscode" : ".cursor", "mcp.json");
  const { data, ok } = readJson(file);
  if (!ok) return { updated: false, skipped: "unreadable", path: file };
  const key = isVsCode ? "servers" : "mcpServers";
  if (!data[key] || typeof data[key] !== "object") data[key] = {};
  const want = isVsCode ? { type: "stdio", ...mcpServerEntry(projectDir) } : mcpServerEntry(projectDir);
  const cur = data[key].infernoflow;
  if (sameEntry(cur, want) && (!isVsCode || cur.type === "stdio")) return { updated: false, path: file };
  // Keep any extra env the user added.
  want.env = { ...((cur && cur.env) || {}), ...want.env };
  data[key].infernoflow = want;
  writeJson(file, data);
  return { updated: true, path: file };
}

export function claudeJsonPath() { return path.join(os.homedir(), ".claude.json"); }

export function claudeDesktopConfigPath() {
  const home = os.homedir();
  if (process.platform === "win32")  return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "claude_desktop_config.json");
}

/** Is this an entry infernoflow wrote (any version), as opposed to the user's own server? */
export function isInfernoflowEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const args = Array.isArray(entry.args) ? entry.args.join(" ") : "";
  return /inferno-mcp-server\.mjs/.test(args) || /infernoflow(\.mjs)?["']?\s+mcp\b/.test(args) || /bin[\\/]infernoflow\.mjs/.test(args)
      || !!(entry.env && entry.env.INFERNOFLOW_PROJECT_DIR);
}

/**
 * Remove the legacy user-level `infernoflow` entry that pins every project to
 * one repo. Only removes it if it is recognisably ours. Backs the file up first.
 */
export function removeLegacyUserLevelEntry(file) {
  if (!fs.existsSync(file)) return { removed: false };
  const { data, ok } = readJson(file);
  if (!ok || !data.mcpServers || !data.mcpServers.infernoflow) return { removed: false };
  const entry = data.mcpServers.infernoflow;
  if (!isInfernoflowEntry(entry)) return { removed: false, skipped: "not-ours" };
  const backup = backupFile(file);
  if (!backup) return { removed: false, skipped: "backup-failed" };
  delete data.mcpServers.infernoflow;
  writeJson(file, data);
  return { removed: true, backup, pinnedTo: (entry.env || {}).INFERNOFLOW_PROJECT_DIR || null };
}

/** Name for this project's Claude Desktop entry: infernoflow-<repo>, disambiguated by a short hash if taken. */
export function desktopServerName(projectDir, servers = {}) {
  const base = "infernoflow-" + (path.basename(projectDir).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "project");
  const taken = servers[base];
  if (!taken || (taken.env || {}).INFERNOFLOW_PROJECT_DIR === projectDir) return base;
  const h = crypto.createHash("sha1").update(projectDir).digest("hex").slice(0, 6);
  return `${base}-${h}`;
}

/** Claude Desktop: one entry per project; only when Desktop is installed. */
export function updateClaudeDesktopPerProject(projectDir) {
  const file = claudeDesktopConfigPath();
  if (!fs.existsSync(path.dirname(file)) && !fs.existsSync(file)) return { updated: false, skipped: "not-installed" };
  const { data, ok } = readJson(file);
  if (!ok) return { updated: false, skipped: "unreadable", path: file };
  if (!data.mcpServers || typeof data.mcpServers !== "object") data.mcpServers = {};
  const name = desktopServerName(projectDir, data.mcpServers);
  const want = mcpServerEntry(projectDir);
  if (sameEntry(data.mcpServers[name], want)) return { updated: false, name, path: file };
  data.mcpServers[name] = want;
  writeJson(file, data);
  return { updated: true, name, path: file };
}
