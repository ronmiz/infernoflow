/**
 * infernoflow setup
 * One command that gets a project fully operational:
 *   1. Detects IDE (Cursor / VS Code / other)
 *   2. Runs `infernoflow init --adopt` if inferno/ doesn't exist yet
 *   3. Copies MCP server + hooks
 *   4. Auto-updates ~/.claude.json for Claude Code (VS Code extension):
 *      - Registers MCP server under mcpServers.infernoflow
 *      - Pre-approves all tools under projects[cwd].allowedTools  ← kills prompts
 *   5. Writes .claude/settings.json with pre-approved tools (CLI fallback)
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
import { writeClaudeMd } from "./claudeMd.mjs";

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
  "infernoflow_synthesize",
  "infernoflow_agent_list",
  "infernoflow_agent_run",
  "infernoflow_version",
];

// ── Git hooks installer ───────────────────────────────────────────────────────
function installGitHooks(cwd, templatesRoot, force) {
  const gitDir  = path.join(cwd, ".git");
  const hooksDir = path.join(gitDir, "hooks");

  if (!fs.existsSync(gitDir)) {
    return { skipped: true, reason: "no .git directory" };
  }

  fs.mkdirSync(hooksDir, { recursive: true });

  const hooks = ["post-commit", "pre-push", "pre-stash"];
  const installed = [];

  for (const hookName of hooks) {
    const src = path.join(templatesRoot, "git-hooks", hookName);
    const dst = path.join(hooksDir, hookName);

    if (!fs.existsSync(src)) continue;

    if (fs.existsSync(dst) && !force) {
      // Append our hook to existing one rather than overwriting
      const existing = fs.readFileSync(dst, "utf8");
      const marker = "# infernoflow";
      if (!existing.includes(marker)) {
        const hookContent = fs.readFileSync(src, "utf8");
        // Append the infernoflow block after the existing content
        fs.appendFileSync(dst, `\n${hookContent}`);
        installed.push(`${hookName} (appended)`);
      }
      // Already has infernoflow — skip silently
    } else {
      fs.copyFileSync(src, dst);
      // Make executable
      try { fs.chmodSync(dst, 0o755); } catch {}
      installed.push(hookName);
    }
  }

  return { skipped: false, installed };
}

// ── ~/.claude.json updater (Claude Code for VS Code) ─────────────────────────
//
// Claude Code VS Code stores two kinds of data in ~/.claude.json:
//   mcpServers           → global MCP server registry
//   projects[path]       → per-project settings incl. allowedTools
//
// Writing allowedTools under projects[cwd] is the same thing the extension
// does when you click "Yes, allow for this project" — so setup pre-fills it.
//
function updateClaudeJson(mcpServerAbsPath, projectPath, allowedToolNames) {
  const claudeJsonPath = path.join(os.homedir(), ".claude.json");

  let config = {};
  if (fs.existsSync(claudeJsonPath)) {
    try {
      const raw = fs.readFileSync(claudeJsonPath, "utf8").replace(/\u0000+/g, "");
      config = JSON.parse(raw);
    } catch { config = {}; }
  }

  let changed = false;

  // ── 1. MCP server registration ────────────────────────────────────────────
  if (!config.mcpServers) config.mcpServers = {};
  const existingSrv = config.mcpServers.infernoflow;
  if (!existingSrv || !existingSrv.args || existingSrv.args[0] !== mcpServerAbsPath) {
    config.mcpServers.infernoflow = { command: "node", args: [mcpServerAbsPath] };
    changed = true;
  }

  // ── 2. Per-project tool approvals ─────────────────────────────────────────
  // This mirrors exactly what Claude Code writes when user clicks
  // "Yes, allow <tool> for this project (just you)".
  if (!config.projects) config.projects = {};
  if (!config.projects[projectPath]) config.projects[projectPath] = {};

  const proj = config.projects[projectPath];
  const existingAllowed = new Set(proj.allowedTools || []);
  const sizeBefore = existingAllowed.size;
  for (const name of allowedToolNames) existingAllowed.add(name);

  if (existingAllowed.size !== sizeBefore || proj.allowedTools === undefined) {
    proj.allowedTools = [...existingAllowed];
    changed = true;
  }

  // Strip null bytes before writing (Windows artifact)
  const content = JSON.stringify(config, null, 2).replace(/\u0000+/g, "");
  fs.writeFileSync(claudeJsonPath, content, "utf8");
  return { changed, mcpUpdated: !existingSrv || existingSrv.args[0] !== mcpServerAbsPath };
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

  const mcpAbsPath    = dstMcp;  // absolute path to .cursor/inferno-mcp-server.mjs
  const allowedTools  = MCP_TOOLS.map(t => `mcp__infernoflow__${t}`);

  try {
    const result = updateClaudeJson(mcpAbsPath, cwd, allowedTools);
    if (result.mcpUpdated) {
      ok(`~/.claude.json → MCP server registered`);
    } else {
      ok(`~/.claude.json → MCP server already registered`);
    }
    ok(`~/.claude.json → ${allowedTools.length} infernoflow tools pre-approved for this project`);
  } catch (err) {
    warn(`Could not update ~/.claude.json: ${err.message}`);
    warn(`Add manually: ${cyan('"mcpServers": { "infernoflow": { "command": "node", "args": ["' + mcpAbsPath + '"] } }')}`);
  }

  // ── 5. Write .claude/settings.json (CLI / non-interactive fallback) ───────
  try {
    writeClaudeSettings(cwd, force);
    ok(`.claude/settings.json → tools pre-approved (CLI fallback)`);
  } catch (err) {
    warn(`Could not write .claude/settings.json: ${err.message}`);
  }

  // ── 6. Generate CLAUDE.md (invisible instruction layer) ──────────────────
  console.log();
  info("Installing invisible AI behavior layer...");
  try {
    const claudeMdResult = writeClaudeMd(cwd, infernoDir, { force });
    ok(`CLAUDE.md → ${claudeMdResult.action} (auto-behavior instructions for Claude)`);
  } catch (err) {
    warn(`Could not write CLAUDE.md: ${err.message}`);
  }

  // ── 7. Install git hooks ──────────────────────────────────────────────────
  try {
    const hooksResult = installGitHooks(cwd, templatesRoot, force);
    if (hooksResult.skipped) {
      warn(`Git hooks skipped: ${hooksResult.reason}`);
    } else if (hooksResult.installed.length > 0) {
      ok(`Git hooks → ${hooksResult.installed.join(", ")} installed`);
    } else {
      ok(`Git hooks → already installed (use --force to overwrite)`);
    }
  } catch (err) {
    warn(`Could not install git hooks: ${err.message}`);
  }

  // ── 8. Verify contract ────────────────────────────────────────────────────
  let capCount = 0;
  try {
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    capCount = (contract.capabilities || []).length;
  } catch {}

  // ── 9. Summary ────────────────────────────────────────────────────────────
  console.log();
  done(
    capCount > 0
      ? `infernoflow ready — ${capCount} capabilities tracked`
      : `infernoflow ready`
  );

  console.log(`\n  ${bold("What was set up:")}`);
  console.log(`    ${green("✔")} MCP server → .cursor/inferno-mcp-server.mjs`);
  console.log(`    ${green("✔")} ~/.claude.json → MCP registered + ${allowedTools.length} tools pre-approved (no prompts)`);
  console.log(`    ${green("✔")} .claude/settings.json → CLI fallback approvals`);
  console.log(`    ${green("✔")} CLAUDE.md → Claude auto-calls infernoflow silently every session`);
  console.log(`    ${green("✔")} Git hooks → post-commit (changelog) + pre-push (drift check)`);
  console.log();
  console.log(`  ${bold("You're done.")} Just write code — infernoflow handles itself.`);
  console.log(`  Claude automatically tracks capabilities, updates the contract,`);
  console.log(`  and synthesizes agents from your workflow patterns.`);
  console.log();
  console.log(`  ${bold("Restart VS Code")} to activate the MCP server.`);
  console.log();
}
