/**
 * infernoflow setup
 * One command that gets a project fully operational:
 *   1. Detects IDE (Cursor / VS Code / other)
 *   2. Runs `infernoflow init --adopt` if inferno/ doesn't exist yet
 *   3. Copies MCP server + hooks
 *   4. Auto-updates ~/.claude.json for Claude Code (VS Code extension)
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
import { installVsCodeCopilotHooksArtifacts } from "../vsCodeCopilotHooksInstall.mjs";
import { updateInjectionConfig } from "../amp/io.mjs";
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

// ── Claude Desktop app config (claude_desktop_config.json) ───────────────────
// Distinct from Claude Code (~/.claude.json). The standalone Claude Desktop app
// reads its MCP servers from a platform-specific config file. `setup` never
// wired this before, so Desktop users got the server file on disk but the app
// never learned about it → amp_write / amp_read never appeared.
export function claudeDesktopConfigPath() {
  const home = os.homedir();
  if (process.platform === "win32")  return path.join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}

export function updateClaudeDesktopConfig(mcpServerAbsPath) {
  const file = claudeDesktopConfigPath();
  const dir  = path.dirname(file);
  // Only wire the Desktop app when it's actually installed (config dir/file
  // present). Don't fabricate a phantom Claude/ dir on machines without it.
  if (!fs.existsSync(dir) && !fs.existsSync(file)) return { updated: false, skipped: "not-installed" };
  const { data: config, backup } = readJsonSafe(file);
  if (!config.mcpServers) config.mcpServers = {};
  const existing = config.mcpServers.infernoflow;
  if (existing && Array.isArray(existing.args) && existing.args[0] === mcpServerAbsPath) {
    return { updated: false, backup };
  }
  config.mcpServers.infernoflow = { command: "node", args: [mcpServerAbsPath] };
  const content = JSON.stringify(config, null, 2);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return { updated: true, path: file, backup };
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
const CAPTURE_HOOK_SCRIPT = `#!/usr/bin/env node
// infernoflow UserPromptSubmit hook (Claude Code / Cursor).
// Logs a best-effort 'attempt' entry when the user's prompt shows frustration,
// so the highest-value capture signal doesn't depend on the model remembering.
// Never blocks the prompt.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
let prompt = "";
try { const j = JSON.parse(raw); prompt = j.prompt || j.user_prompt || j.userPrompt || ""; }
catch { prompt = raw; }

const MARKERS = [/!!+/, /not working/i, /still (broken|failing|not)/i, /does ?n'?t work/i, /\\bbroken\\b/i, /\\bretry(ing)?\\b/i, /same error/i, /no change/i];
if (prompt && MARKERS.some((re) => re.test(prompt))) {
  const msg = "User frustration: " + prompt.replace(/\\s+/g, " ").trim().slice(0, 120);
  try {
    spawnSync("infernoflow", ["log", msg, "--type", "attempt", "--result", "failed", "--auto", "--quiet", "--source", "hook"], {
      stdio: "ignore", timeout: 5000, shell: process.platform === "win32",
    });
  } catch {}
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

// ── ~/.claude.json updater (Claude Code for VS Code) ─────────────────────────
export function updateClaudeJson(mcpServerAbsPath) {
  const claudeJsonPath = path.join(os.homedir(), ".claude.json");

  // Wipe-guard: never reset a corrupt file to {} and overwrite it — that used
  // to destroy every MCP server + all project history in ~/.claude.json on a
  // single transient JSON parse error. readJsonSafe backs the bad file up first.
  const { data: config, backup } = readJsonSafe(claudeJsonPath);

  if (!config.mcpServers) config.mcpServers = {};

  // Check if already configured with the same path
  const existing = config.mcpServers.infernoflow;
  if (existing && existing.args && existing.args[0] === mcpServerAbsPath) {
    return { updated: false, backup };
  }

  config.mcpServers.infernoflow = {
    command: "node",
    args: [mcpServerAbsPath],
  };

  // Strip null bytes before writing (Windows artifact)
  const content = JSON.stringify(config, null, 2).replace(/\u0000+/g, "");
  fs.writeFileSync(claudeJsonPath, content, "utf8");
  return { updated: true, path: claudeJsonPath, backup };
}

// ── .vscode/mcp.json (VS Code Copilot Chat MCP server config) ────────────────
// VS Code's GitHub Copilot Chat reads MCP servers from `.vscode/mcp.json` —
// distinct from Claude Code (`~/.claude.json`) and Cursor (`.cursor/mcp.json`).
// Without this, Copilot users get the Memory protocol skill block in their
// rule file but no actual `amp_write` tool to call — same dead-end the
// agent's review flagged.
export function updateVscodeMcpJson(cwd, mcpServerAbsPath) {
  const dir  = path.join(cwd, ".vscode");
  const file = path.join(dir, "mcp.json");

  const { data: existing, backup } = readJsonSafe(file);
  if (!existing.servers) existing.servers = {};

  const current = existing.servers.infernoflow;
  if (current && current.args && current.args[0] === mcpServerAbsPath) {
    return { updated: false, backup };
  }

  existing.servers.infernoflow = {
    type: "stdio",
    command: "node",
    args: [mcpServerAbsPath],
  };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + "\n", "utf8");
  return { updated: true, path: file, backup };
}

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
  const summary = { mcpServer: false, claudeJson: false, claudeSettings: false, claudeDesktop: false, gitHooks: false, captureHook: false, backups: [] };

  // Copy MCP server into .cursor/ so it's findable by absolute path
  const srcMcp = path.join(templatesRoot, "cursor", "inferno-mcp-server.mjs");
  const dstMcp = path.join(cwd, ".cursor", "inferno-mcp-server.mjs");
  try {
    if (!fs.existsSync(dstMcp)) {
      fs.mkdirSync(path.dirname(dstMcp), { recursive: true });
      fs.copyFileSync(srcMcp, dstMcp);
      summary.mcpServer = true;
      log("Copied MCP server → " + cyan(".cursor/inferno-mcp-server.mjs"));
    }
  } catch (err) {
    logWarn("MCP server copy skipped: " + err.message);
  }

  // Register with Claude Code (VS Code extension reads ~/.claude.json)
  try {
    const r = updateClaudeJson(dstMcp);
    if (r.updated) {
      summary.claudeJson = true;
      log("Registered MCP server in " + cyan("~/.claude.json"));
    }
    if (r.backup) { summary.backups.push(r.backup); logWarn("~/.claude.json was unreadable — backed up to " + r.backup + " before rewrite"); }
  } catch (err) {
    logWarn("~/.claude.json update skipped: " + err.message);
  }

  // Register with VS Code Copilot Chat (reads .vscode/mcp.json per project)
  try {
    const r = updateVscodeMcpJson(cwd, dstMcp);
    if (r.updated) {
      summary.vscodeMcp = true;
      log("Registered MCP server in " + cyan(".vscode/mcp.json") + gray(" (Copilot Chat)"));
    }
  } catch (err) {
    logWarn(".vscode/mcp.json update skipped: " + err.message);
  }

  // Register with Cursor (reads .cursor/mcp.json per project)
  try {
    const cursorMcpPath = path.join(cwd, ".cursor", "mcp.json");
    const { data: cursorCfg } = readJsonSafe(cursorMcpPath);
    if (!cursorCfg.mcpServers) cursorCfg.mcpServers = {};
    const cur = cursorCfg.mcpServers.infernoflow;
    if (!cur || !cur.args || cur.args[0] !== dstMcp) {
      cursorCfg.mcpServers.infernoflow = { command: "node", args: [dstMcp], env: {} };
      fs.mkdirSync(path.dirname(cursorMcpPath), { recursive: true });
      fs.writeFileSync(cursorMcpPath, JSON.stringify(cursorCfg, null, 2) + "\n", "utf8");
      summary.cursorMcp = true;
      log("Registered MCP server in " + cyan(".cursor/mcp.json"));
    }
  } catch (err) {
    logWarn(".cursor/mcp.json update skipped: " + err.message);
  }

  // Pre-approve infernoflow tools so the AI doesn't prompt on every call
  try {
    writeClaudeSettings(cwd, false);
    summary.claudeSettings = true;
    log("Pre-approved infernoflow tools in " + cyan(".claude/settings.json"));
  } catch (err) {
    logWarn(".claude/settings.json skipped: " + err.message);
  }

  // Register with the Claude Desktop app (claude_desktop_config.json) when it's
  // installed — distinct from ~/.claude.json (Claude Code). Without it, Desktop
  // users never see the amp_write / amp_read MCP tools.
  try {
    const r = updateClaudeDesktopConfig(dstMcp);
    if (r.updated) {
      summary.claudeDesktop = true;
      log("Registered MCP server in " + cyan("claude_desktop_config.json") + gray(" (Claude Desktop app)"));
    }
    if (r.backup) { summary.backups.push(r.backup); logWarn("Claude Desktop config was unreadable — backed up to " + r.backup); }
  } catch (err) {
    logWarn("Claude Desktop config skipped: " + err.message);
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
  //   .cursor/inferno-mcp-server.mjs   (no root pollution)
  //   .cursor/mcp.json                  (Cursor MCP config)
  //   .vscode/mcp.json                  (VS Code Copilot Chat MCP config)
  //   ~/.claude.json                    (Claude Code VS Code extension)
  //   .claude/settings.json             (tool pre-approvals)
  console.log();
  info("Wiring up MCP servers for Cursor / VS Code Copilot / Claude Code ...");
  const summary = autoSetupMcp(cwd, { silent: false });

  // ── 4. Summary ────────────────────────────────────────────────────────────
  console.log();
  done("infernoflow ready");

  console.log(`\n  ${bold("What was set up:")}`);
  console.log(`    ${green("✔")} MCP server installed → ${cyan(".cursor/inferno-mcp-server.mjs")}`);
  if (summary.cursorMcp)     console.log(`    ${green("✔")} Cursor MCP config → ${cyan(".cursor/mcp.json")}`);
  if (summary.vscodeMcp)     console.log(`    ${green("✔")} VS Code Copilot MCP config → ${cyan(".vscode/mcp.json")}`);
  if (summary.claudeJson)    console.log(`    ${green("✔")} Claude Code MCP config → ${cyan("~/.claude.json")}`);
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
