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

  let config = {};
  if (fs.existsSync(claudeJsonPath)) {
    try { config = JSON.parse(fs.readFileSync(claudeJsonPath, "utf8")); }
    catch { config = {}; }
  }

  if (!config.mcpServers) config.mcpServers = {};

  // Check if already configured with the same path
  const existing = config.mcpServers.infernoflow;
  if (existing && existing.args && existing.args[0] === mcpServerAbsPath) {
    return { updated: false };
  }

  config.mcpServers.infernoflow = {
    command: "node",
    args: [mcpServerAbsPath],
  };

  // Strip null bytes before writing (Windows artifact)
  const content = JSON.stringify(config, null, 2).replace(/\u0000+/g, "");
  fs.writeFileSync(claudeJsonPath, content, "utf8");
  return { updated: true, path: claudeJsonPath };
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

  let existing = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")); } catch { existing = {}; }
  }
  if (!existing.servers) existing.servers = {};

  const current = existing.servers.infernoflow;
  if (current && current.args && current.args[0] === mcpServerAbsPath) {
    return { updated: false };
  }

  existing.servers.infernoflow = {
    type: "stdio",
    command: "node",
    args: [mcpServerAbsPath],
  };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + "\n", "utf8");
  return { updated: true, path: file };
}

// ── .claude/settings.json (auto-approve tools) ───────────────────────────────
export function writeClaudeSettings(cwd, force) {
  const settingsDir  = path.join(cwd, ".claude");
  const settingsPath = path.join(settingsDir, "settings.json");

  let existing = {};
  if (fs.existsSync(settingsPath)) {
    try { existing = JSON.parse(fs.readFileSync(settingsPath, "utf8")); }
    catch { existing = {}; }
  }

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
  const summary = { mcpServer: false, claudeJson: false, claudeSettings: false };

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
    let cursorCfg = {};
    if (fs.existsSync(cursorMcpPath)) {
      try { cursorCfg = JSON.parse(fs.readFileSync(cursorMcpPath, "utf8")); } catch { cursorCfg = {}; }
    }
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
  console.log();
  console.log(`  ${bold("Next step:")} Restart your AI tool. Test by asking:`);
  console.log(`    ${cyan('"call the amp_write tool with a test note"')}`);
  console.log();
}
