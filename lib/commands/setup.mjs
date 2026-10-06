/**
 * infernoflow setup
 * One command that gets a project fully operational:
 *   1. Detects IDE (Cursor / VS Code / other)
 *   2. Runs `infernoflow init --adopt` if inferno/ doesn't exist yet
 *   3. Installs hooks; registers the MCP server per project (`infernoflow mcp`)
 *   4. Claude Code: project .mcp.json (gitignored). Claude Desktop: one entry
 *      per project. The old pinned user-level entry is removed.
 *   5. Writes .claude/settings.json with pre-approved tools (no more permission prompts)
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import * as os   from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { detectIdeContext } from "../ai/ideDetection.mjs";
import { header, ok, warn, info, done, cyan, yellow, bold, green, gray } from "../ui/output.mjs";
import { installCursorHooksArtifacts } from "../cursorHooksInstall.mjs";
import { refreshSecuritySensitiveCopies } from "../securityRefresh.mjs";
import {
  updateProjectMcpJson, updateIdeMcpJson, updateClaudeDesktopPerProject,
  removeLegacyUserLevelEntry, claudeJsonPath, claudeDesktopConfigPath, runningFromNpxCache,
} from "../mcpRegistration.mjs";
export { claudeDesktopConfigPath };
import { installVsCodeCopilotHooksArtifacts } from "../vsCodeCopilotHooksInstall.mjs";
import { updateInjectionConfig } from "../amp/io.mjs";
import { findProjectRoot } from "../projectRoot.mjs";
import { injectionPatchFromArgs } from "./refresh.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getTemplatesRoot() {
  return path.resolve(__dirname, "../../templates");
}

function runInferno(args) {
  try {
    return execSync(`npx infernoflow ${args}`, {
      encoding: "utf8",
      cwd: process.cwd(),
      timeout: 60_000,
      stdio: ["inherit", "pipe", "pipe"],
    });
  } catch (err) {
    return err.stdout || err.stderr || err.message;
  }
}

/**
 * Safe JSON reader for the shared config files we merge into (~/.claude.json,
 * .claude/settings.json, .vscode/mcp.json, .cursor/mcp.json, the Claude Desktop
 * config). Returns { data, existed, corrupt, backup }.
 *
 * CRITICAL: on a parse failure of an EXISTING file we must NOT silently reset to
 * `{}` and then overwrite — that used to destroy the whole file (e.g. every MCP
 * server and all project history in ~/.claude.json) on a single transient JSON
 * hiccup. Instead we copy the unparseable bytes to a timestamped `.corrupt-*.bak`
 * first, so the original content is always recoverable, and only then start from
 * a fresh object. Callers can surface `backup` to warn the user.
 */
function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return { data: {}, existed: false, corrupt: false, backup: null };
  let raw;
  try { raw = fs.readFileSync(filePath, "utf8"); }
  catch { return { data: {}, existed: true, corrupt: false, backup: null }; }
  try {
    const data = JSON.parse(raw);
    // Guard against a valid-JSON-but-not-an-object file (e.g. "null", "[]", "42").
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { data: {}, existed: true, corrupt: false, backup: null };
    }
    return { data, existed: true, corrupt: false, backup: null };
  } catch {
    let backup = null;
    try {
      backup = `${filePath}.corrupt-${Date.now()}.bak`;
      fs.writeFileSync(backup, raw, "utf8");
    } catch { backup = null; }
    return { data: {}, existed: true, corrupt: true, backup };
  }
}

// ── git hooks (post-commit auto-capture) ─────────────────────────────────────
// Previously `doctor` told users to run `infernoflow setup --yes` to install git
// hooks, but setup installed none — a silent dead end. This makes that advice
// real: a best-effort post-commit hook that logs the commit subject to memory.
export function installGitHooks(cwd) {
  const gitDir = path.join(cwd, ".git");
  if (!fs.existsSync(gitDir)) return { installed: false, skipped: "not-a-git-repo" };
  const hooksDir   = path.join(gitDir, "hooks");
  const postCommit = path.join(hooksDir, "post-commit");
  const captureLine =
    'infernoflow log "commit: $(git log -1 --pretty=%s)" --type note --source git-hook --auto --quiet >/dev/null 2>&1 || true';

  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    if (fs.existsSync(postCommit)) {
      const existing = fs.readFileSync(postCommit, "utf8");
      if (existing.includes("infernoflow")) return { installed: false, already: true };
      // Preserve the user's existing hook — append our line, don't clobber.
      const appended = existing.replace(/\s*$/, "") + "\n\n# infernoflow auto-capture\n" + captureLine + "\n";
      fs.writeFileSync(postCommit, appended, "utf8");
    } else {
      const body = [
        "#!/bin/sh",
        "# infernoflow: auto-capture the commit subject into session memory.",
        "# Best-effort and non-blocking — never fails a commit.",
        captureLine,
        "",
      ].join("\n");
      fs.writeFileSync(postCommit, body, "utf8");
    }
    try { fs.chmodSync(postCommit, 0o755); } catch { /* Windows ignores mode */ }
    return { installed: true, path: postCommit };
  } catch (err) {
    return { installed: false, error: err.message };
  }
}

// ── Claude Code deterministic capture hook (UserPromptSubmit) ────────────────
// The Memory protocol block asks the model to call amp_write proactively, but
// "knows" ≠ "does". This ships a real hook so frustration signals are captured
// deterministically on Claude Code (Cursor supports the same script via its own
// hooks). NOTE: the Claude Desktop app cannot run these hooks — it has no
// UserPromptSubmit mechanism — so on Desktop capture still depends on the model
// calling amp_write over MCP. Host-aware by necessity.
// SECURITY (0.44.20): the hook must never pass the prompt through a shell.
// Before 0.44.20 it ran spawnSync("infernoflow", [...], { shell: true }) on
// Windows; with shell:true Node joins the arguments into ONE cmd.exe command
// line without quoting, so a prompt containing `&` or `|` (a pasted log, a
// command copied from the web) ran as a command. It now runs the CLI's .mjs
// entry point with the current node binary and no shell.
// The "infernoflow-hook-version" line lets setup / upgrade recognise old copies.
export const CAPTURE_HOOK_VERSION = 2;
export const CAPTURE_HOOK_SCRIPT = `#!/usr/bin/env node
// infernoflow UserPromptSubmit hook (Claude Code / Cursor).
// infernoflow-hook-version: ${CAPTURE_HOOK_VERSION}
// Logs a best-effort 'attempt' entry when the user's prompt shows frustration,
// so the highest-value capture signal doesn't depend on the model remembering.
// Never blocks the prompt. Never uses a shell.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
let prompt = "";
try { const j = JSON.parse(raw); prompt = j.prompt || j.user_prompt || j.userPrompt || ""; }
catch { prompt = raw; }

// Find the CLI's JavaScript entry point (never the .cmd / shell wrapper).
function findCliMjs() {
  let hits = [];
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    hits = execFileSync(finder, ["infernoflow"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 3000 })
      .split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean);
  } catch {}
  for (const c of hits) {
    try { const real = realpathSync(c); if (/\\.m?js$/i.test(real)) return real; } catch {}
    const d = dirname(c);
    for (const pkg of [join(d, "node_modules", "infernoflow"), join(d, "..", "lib", "node_modules", "infernoflow")]) {
      for (const f of [join(pkg, "dist", "bin", "infernoflow.mjs"), join(pkg, "bin", "infernoflow.mjs")]) {
        if (existsSync(f)) return f;
      }
    }
  }
  return null;
}

const MARKERS = [/!!+/, /not working/i, /still (broken|failing|not)/i, /does ?n'?t work/i, /\\bbroken\\b/i, /\\bretry(ing)?\\b/i, /same error/i, /no change/i];
if (prompt && MARKERS.some((re) => re.test(prompt))) {
  // Leading dashes are stripped so the text can never be read as a CLI flag.
  const msg = "User frustration: " + prompt.replace(/\\s+/g, " ").trim().replace(/^[\\s-]+/, "").slice(0, 120);
  const cli = findCliMjs();
  if (cli) {
    try {
      spawnSync(process.execPath, [cli, "log", msg, "--type", "attempt", "--result", "failed", "--auto", "--quiet", "--source", "hook"], {
        stdio: "ignore", timeout: 5000, windowsHide: true, shell: false,
      });
    } catch {}
  }
}
process.exit(0);
`;

export function installClaudeCodeCaptureHook(cwd) {
  const hookDir  = path.join(cwd, ".claude", "hooks");
  const hookFile = path.join(hookDir, "log-frustration.mjs");
  try {
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(hookFile, CAPTURE_HOOK_SCRIPT, "utf8");
    try { fs.chmodSync(hookFile, 0o755); } catch {}
  } catch (err) {
    return { installed: false, error: err.message };
  }

  // Register in .claude/settings.json WITHOUT clobbering anything. Deep-merge:
  // preserve allowedTools + any user hooks; only append our UserPromptSubmit
  // entry if it isn't already there.
  const settingsPath = path.join(cwd, ".claude", "settings.json");
  const { data: settings } = readJsonSafe(settingsPath);
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];
  const command = "node .claude/hooks/log-frustration.mjs";
  const already = settings.hooks.UserPromptSubmit.some(
    (m) => Array.isArray(m?.hooks) && m.hooks.some((h) => typeof h?.command === "string" && h.command.includes("log-frustration.mjs")),
  );
  if (!already) settings.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command }] });
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  } catch (err) {
    return { installed: true, registered: false, error: err.message };
  }
  return { installed: true, registered: !already };
}

// ── MCP tool names (must match inferno-mcp-server.mjs) ───────────────────────
// Keep in sync with templates/cursor/inferno-mcp-server.mjs `tools` array.
// Last verified 2026-05-06: 9 infernoflow_* + 5 amp_* aliases = 14 total.
export const MCP_TOOLS = [
  // Contract-tier tools
  "infernoflow_status",
  "infernoflow_run",
  "infernoflow_apply",
  "infernoflow_check",
  "infernoflow_context",
  "infernoflow_implement",
  "infernoflow_git_drift",
  "infernoflow_scan_ui",
  "infernoflow_review",
  // AMP-spec aliases (vendor-neutral memory ops)
  "amp_read",
  "amp_write",
  "amp_search",
  "amp_handoff",
  "amp_health",
];

// ── .claude/settings.json (auto-approve tools) ───────────────────────────────
export function writeClaudeSettings(cwd, force) {
  const settingsDir  = path.join(cwd, ".claude");
  const settingsPath = path.join(settingsDir, "settings.json");

  // Wipe-guard (see readJsonSafe): a corrupt settings.json is backed up, not
  // silently discarded. The spread-merge below preserves every unknown key
  // (hooks, permissions, env, model, …).
  const { data: existing } = readJsonSafe(settingsPath);

  // Build allowedTools — add infernoflow tools, keep any existing entries
  const existingAllowed = new Set(existing.allowedTools || []);
  for (const tool of MCP_TOOLS) {
    existingAllowed.add(`mcp__infernoflow__${tool}`);
  }

  const updated = { ...existing, allowedTools: [...existingAllowed] };

  // Also keep mcpServers if it was in the project settings
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), "utf8");
  return settingsPath;
}

/**
 * Run the silent half of `infernoflow setup` from inside `init`. No prompts,
 * no headers, no narration — just copy the MCP server, register it with
 * Claude Code, and pre-approve the infernoflow tools so the user's AI gets
 * `amp_write` on the very first session after `init`.
 *
 * Why this matters: before this existed, `init` only made `.ai-memory/`. The
 * AI had a Memory protocol skill in the rule file telling it to call
 * `amp_write`, but no actual MCP tool to call. So nothing got logged. This
 * function closes that gap so `init` alone is enough.
 *
 * Failures are non-fatal — init must finish successfully even on a host
 * where ~/.claude.json is locked or write-protected.
 */
export function autoSetupMcp(cwd, { silent = false } = {}) {
  const templatesRoot = getTemplatesRoot();
  const log    = silent ? () => {} : (m) => ok(m);
  const logWarn = silent ? () => {} : (m) => warn(m);
  const summary = { mcpServer: false, projectMcpJson: false, claudeJson: false, claudeSettings: false, claudeDesktop: false, gitHooks: false, captureHook: false, backups: [] };

  // 0.45.0: the MCP server is no longer copied into the project — every config
  // runs the server shipped with the installed CLI (`infernoflow mcp`). A copy
  // left by an older version is still kept current below, in case some
  // hand-written config points at it.
  const projectDir = (() => { try { return findProjectRoot(cwd); } catch { return cwd; } })();

  // SECURITY (0.44.20): older versions copied the server and hooks into the
  // project once and never updated them. Replace outdated generated copies.
  try {
    const refreshed = refreshSecuritySensitiveCopies(cwd, { captureHookScript: CAPTURE_HOOK_SCRIPT });
    if (refreshed.length) {
      summary.securityRefreshed = refreshed;
      if (refreshed.some(r => r.endsWith("inferno-mcp-server.mjs"))) summary.mcpServer = true;
      log("Security update: replaced outdated " + refreshed.map(r => cyan(r)).join(", "));
    }
  } catch { /* never block setup */ }

  // ── MCP registration (0.45.0): per project, never one pinned user-level entry.
  // Every config runs the server shipped with the installed CLI
  // (`node <package>/bin/infernoflow.mjs mcp`), not the copy inside the repo.

  if (runningFromNpxCache()) {
    logWarn("infernoflow is running from the npx cache — MCP configs will point there and break when the cache is cleared. Install it: npm i -g infernoflow, then run: infernoflow setup --yes");
  }

  // Claude Code → the project's own .mcp.json (gitignored when we create it).
  let projectMcpOk = false;
  try {
    const r = updateProjectMcpJson(projectDir);
    if (r.skipped === "tracked") {
      logWarn(".mcp.json is tracked by git — not adding this machine's paths to it. Add the infernoflow server with: claude mcp add infernoflow -s local -- node <infernoflow>/bin/infernoflow.mjs mcp");
    } else if (r.skipped) {
      logWarn(".mcp.json is unreadable — left unchanged");
    } else {
      projectMcpOk = true;
      if (r.updated) { summary.projectMcpJson = true; log("Registered MCP server in " + cyan(".mcp.json") + gray(" (Claude Code, this project only)")); }
      if (r.gitignored) log("Added " + cyan(".mcp.json") + " to .gitignore (it holds this machine's paths)");
    }
  } catch (err) {
    logWarn(".mcp.json update skipped: " + err.message);
  }

  // Remove the old user-level entry that pinned EVERY project to one repo —
  // only once this project has its own registration, so nothing breaks here.
  if (projectMcpOk) {
    try {
      const r = removeLegacyUserLevelEntry(claudeJsonPath());
      if (r.removed) {
        summary.legacyClaudeJsonRemoved = r;
        log("Removed the old user-level infernoflow entry from " + cyan("~/.claude.json") + gray(` (was pinned to ${r.pinnedTo || "one project"}; backup: ${r.backup})`));
      }
    } catch (err) {
      logWarn("~/.claude.json cleanup skipped: " + err.message);
    }
  }

  // VS Code Copilot Chat (.vscode/mcp.json) and Cursor (.cursor/mcp.json).
  for (const [which, label] of [["vscode", ".vscode/mcp.json"], ["cursor", ".cursor/mcp.json"]]) {
    try {
      const r = updateIdeMcpJson(projectDir, which);
      if (r.updated) {
        summary[which === "vscode" ? "vscodeMcp" : "cursorMcp"] = true;
        log("Registered MCP server in " + cyan(label));
      }
    } catch (err) {
      logWarn(label + " update skipped: " + err.message);
    }
  }

  // Claude Desktop has no per-project config: one entry PER PROJECT
  // (infernoflow-<repo>), and the old single pinned `infernoflow` entry goes.
  try {
    const r = updateClaudeDesktopPerProject(projectDir);
    if (r.updated) {
      summary.claudeDesktop = true;
      log("Registered MCP server " + cyan(r.name) + " in " + cyan("claude_desktop_config.json") + gray(" (Claude Desktop app)"));
    }
    if (!r.skipped) {
      const rr = removeLegacyUserLevelEntry(claudeDesktopConfigPath());
      if (rr.removed) {
        summary.legacyDesktopRemoved = rr;
        log("Removed the old pinned infernoflow entry from " + cyan("claude_desktop_config.json") + gray(` (backup: ${rr.backup})`));
      }
    }
  } catch (err) {
    logWarn("Claude Desktop config skipped: " + err.message);
  }

  // Pre-approve infernoflow tools so the AI doesn't prompt on every call
  try {
    writeClaudeSettings(cwd, false);
    summary.claudeSettings = true;
    log("Pre-approved infernoflow tools in " + cyan(".claude/settings.json"));
  } catch (err) {
    logWarn(".claude/settings.json skipped: " + err.message);
  }

  // Install a real git post-commit hook so doctor's "run setup --yes to install
  // git hooks" advice is true instead of a silent no-op.
  try {
    const r = installGitHooks(cwd);
    if (r.installed) {
      summary.gitHooks = true;
      log("Installed git post-commit hook → " + cyan(".git/hooks/post-commit"));
    }
  } catch (err) {
    logWarn("git hook install skipped: " + err.message);
  }

  // Ship the deterministic capture hook for Claude Code / Cursor. (The Claude
  // Desktop app cannot run UserPromptSubmit hooks, so this is inert there —
  // capture on Desktop still depends on the model calling amp_write over MCP.)
  try {
    const r = installClaudeCodeCaptureHook(cwd);
    if (r.installed) {
      summary.captureHook = true;
      log("Installed capture hook → " + cyan(".claude/hooks/log-frustration.mjs"));
    }
  } catch (err) {
    logWarn("capture hook install skipped: " + err.message);
  }

  return summary;
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function setupCommand(args) {
  const cwd          = process.cwd();
  const force        = args.includes("--force") || args.includes("-f");
  const yes          = args.includes("--yes")   || args.includes("-y");
  const templatesRoot = getTemplatesRoot();

  header("infernoflow setup");

  // ── 1. Detect IDE ─────────────────────────────────────────────────────────
  const { ideDetected } = detectIdeContext("auto");
  const ideLabel = ideDetected === "cursor"   ? "Cursor"
                 : ideDetected === "vscode"   ? "VS Code"
                 : ideDetected === "windsurf" ? "Windsurf"
                 : "unknown";

  info(`IDE detected: ${bold(ideLabel)}`);

  // ── 2. Init if needed (memory-only — no contract bloat, no scripts/) ─────
  const ampDir = path.join(cwd, ".ai-memory");
  if (!fs.existsSync(ampDir)) {
    console.log(`\n  ${yellow(".ai-memory/")} not found — running init ...\n`);
    runInferno(yes ? "init --yes" : "init");
  } else {
    ok(".ai-memory/ already exists — skipping init");
  }

  // ── 2b. Persist injection token-budget flags (after init created amp.json) ─
  // e.g. `infernoflow setup --max-memory 3 --max-commits 5 --no-protocol`
  const injPatch = injectionPatchFromArgs(args);
  if (Object.keys(injPatch).length) {
    try {
      updateInjectionConfig(cwd, injPatch);
      ok("Injection config updated → " + JSON.stringify(injPatch));
    } catch { /* non-fatal */ }
  }

  // ── 3. MCP auto-setup — single clean code path for all 4 AI tools ────────
  // This is the same `autoSetupMcp` that `init` now calls. It writes:
  //   .mcp.json                         (Claude Code, this project; gitignored)
  //   .cursor/mcp.json                  (Cursor MCP config)
  //   .vscode/mcp.json                  (VS Code Copilot Chat MCP config)
  //   claude_desktop_config.json        (Claude Desktop: infernoflow-<repo>)
  //   .claude/settings.json             (tool pre-approvals)
  console.log();
  info("Wiring up MCP servers for Cursor / VS Code Copilot / Claude Code ...");
  const summary = autoSetupMcp(cwd, { silent: false });

  // ── 4. Summary ────────────────────────────────────────────────────────────
  console.log();
  done("infernoflow ready");

  console.log(`\n  ${bold("What was set up:")}`);
  console.log(`    ${green("✔")} MCP server → ${cyan("infernoflow mcp")} ${gray("(runs from the installed package)")}`);
  if (summary.projectMcpJson) console.log(`    ${green("✔")} Claude Code MCP config → ${cyan(".mcp.json")} ${gray("(this project)")}`);
  if (summary.cursorMcp)     console.log(`    ${green("✔")} Cursor MCP config → ${cyan(".cursor/mcp.json")}`);
  if (summary.vscodeMcp)     console.log(`    ${green("✔")} VS Code Copilot MCP config → ${cyan(".vscode/mcp.json")}`);
  if (summary.legacyClaudeJsonRemoved) console.log(`    ${green("✔")} Removed old pinned entry from ${cyan("~/.claude.json")} ${gray("(backup saved)")}`);
  if (summary.claudeSettings) console.log(`    ${green("✔")} Auto-approved tools → ${cyan(".claude/settings.json")}`);
  if (summary.claudeDesktop) console.log(`    ${green("✔")} Claude Desktop MCP config → ${cyan("claude_desktop_config.json")}`);
  if (summary.gitHooks)      console.log(`    ${green("✔")} Git post-commit hook → ${cyan(".git/hooks/post-commit")}`);
  if (summary.captureHook)   console.log(`    ${green("✔")} Capture hook (Claude Code/Cursor) → ${cyan(".claude/hooks/log-frustration.mjs")}`);

  // ── 5. Stale-MCP detection ───────────────────────────────────────────────
  // If a stamp exists from a previous boot at a different version, the
  // IDE is still running the OLD wrapper in memory. Tell the user before
  // they wonder why the new bug-fixes haven't taken effect.
  try {
    const { detectStaleMcpRuntime } = await import("../mcpRuntime.mjs");
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "..", "package.json");
    const cliVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version;
    const stale = detectStaleMcpRuntime(cwd, cliVersion);
    if (stale) {
      console.log();
      console.log(`  ${yellow("⚠")} ${bold("Restart required:")} ${stale.message}`);
    }
  } catch { /* never block setup on stamp check */ }

  console.log();
  console.log(`  ${bold("Next step:")} Restart your AI tool. Test by asking:`);
  console.log(`    ${cyan('"call the amp_write tool with a test note"')}`);
  console.log();
}
