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
import { header, ok, warn, info, done, cyan, yellow, bold, green } from "../ui/output.mjs";
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
const MCP_TOOLS = [
  "infernoflow_status",
  "infernoflow_run",
  "infernoflow_suggest",
  "infernoflow_check",
  "infernoflow_context",
  "infernoflow_implement",
  "infernoflow_git_drift",
  "infernoflow_scan_ui",
  "infernoflow_review",
];

// ── ~/.claude.json updater (Claude Code for VS Code) ─────────────────────────
function updateClaudeJson(mcpServerAbsPath) {
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

// ── .claude/settings.json (auto-approve tools) ───────────────────────────────
function writeClaudeSettings(cwd, force) {
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

  // ── 2. Init if needed ─────────────────────────────────────────────────────
  const infernoDir   = path.join(cwd, "inferno");
  const contractPath = path.join(infernoDir, "contract.json");

  if (!fs.existsSync(contractPath)) {
    console.log(`\n  ${yellow("inferno/")} not found — running init --adopt ...\n`);
    const initArgs = ["--adopt", yes ? "--yes" : ""].filter(Boolean).join(" ");
    runInferno(`init ${initArgs}`);
  } else {
    ok("inferno/contract.json already exists — skipping init");
  }

  // ── 3. Install hooks + MCP server file ───────────────────────────────────
  const logOk   = (msg) => ok(msg);
  const logWarn = (msg) => warn(msg);

  // Always install Cursor artifacts (MCP server works for both Cursor + VS Code)
  installCursorHooksArtifacts({ cwd, templatesRoot, force, silent: false, logOk, logWarn });

  // Also copy MCP server into .cursor/ so it's findable by absolute path
  const srcMcp = path.join(templatesRoot, "cursor", "inferno-mcp-server.mjs");
  const dstMcp = path.join(cwd, ".cursor", "inferno-mcp-server.mjs");
  if (!fs.existsSync(dstMcp) || force) {
    fs.mkdirSync(path.dirname(dstMcp), { recursive: true });
    fs.copyFileSync(srcMcp, dstMcp);
    ok("Copied MCP server → .cursor/inferno-mcp-server.mjs");
  }

  if (ideDetected === "vscode") {
    installVsCodeCopilotHooksArtifacts({ cwd, templatesRoot, force, silent: false, logOk, logWarn });
  }

  // ── 4. Auto-update ~/.claude.json for Claude Code VS Code ────────────────
  console.log();
  info("Configuring Claude Code (VS Code extension)...");

  const mcpAbsPath = dstMcp; // absolute path to .cursor/inferno-mcp-server.mjs
  try {
    const result = updateClaudeJson(mcpAbsPath);
    if (result.updated) {
      ok(`Updated ~/.claude.json → infernoflow MCP server registered`);
    } else {
      ok(`~/.claude.json already has infernoflow — no changes needed`);
    }
  } catch (err) {
    warn(`Could not update ~/.claude.json: ${err.message}`);
    warn(`Add manually: ${cyan('"mcpServers": { "infernoflow": { "command": "node", "args": ["' + mcpAbsPath + '"] } }')}`);
  }

  // ── 5. Write .claude/settings.json (auto-approve tools) ──────────────────
  try {
    const settingsPath = writeClaudeSettings(cwd, force);
    ok(`Written .claude/settings.json — infernoflow tools pre-approved (no more prompts)`);
  } catch (err) {
    warn(`Could not write .claude/settings.json: ${err.message}`);
  }

  // ── 6. Verify contract ────────────────────────────────────────────────────
  let capCount = 0;
  try {
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    capCount = (contract.capabilities || []).length;
  } catch {}

  // ── 7. Summary ────────────────────────────────────────────────────────────
  console.log();
  done(
    capCount > 0
      ? `infernoflow ready — ${capCount} capabilities tracked`
      : `infernoflow ready`
  );

  console.log(`\n  ${bold("What was set up:")}`);
  console.log(`    ${green("✔")} MCP server installed → .cursor/inferno-mcp-server.mjs`);
  console.log(`    ${green("✔")} ~/.claude.json updated → Claude Code will find infernoflow`);
  console.log(`    ${green("✔")} .claude/settings.json → no permission prompts`);
  console.log();
  console.log(`  ${bold("Next step:")} Restart VS Code, then ask Claude:`);
  console.log(`    ${cyan('"show me the infernoflow status of this project"')}`);
  console.log();
}
