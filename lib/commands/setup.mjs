/**
 * infernoflow setup
 * One command that gets a project fully operational:
 *   1. Detects IDE (Cursor / VS Code / other)
 *   2. Runs `infernoflow init` if inferno/ doesn't exist yet
 *   3. Installs the appropriate hooks + MCP server
 *   4. Prints a single green confirmation line
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { detectIdeContext } from "../ai/ideDetection.mjs";
import { header, ok, warn, info, done, cyan, yellow, bold } from "../ui/output.mjs";
import { installCursorHooksArtifacts } from "../cursorHooksInstall.mjs";
import { installVsCodeCopilotHooksArtifacts } from "../vsCodeCopilotHooksInstall.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getTemplatesRoot() {
  return path.resolve(__dirname, "../../templates");
}

function runInferno(args) {
  try {
    const result = execSync(`npx infernoflow ${args}`, {
      encoding: "utf8",
      cwd: process.cwd(),
      timeout: 60_000,
      stdio: ["inherit", "pipe", "pipe"],
    });
    return result;
  } catch (err) {
    return err.stdout || err.stderr || err.message;
  }
}

export async function setupCommand(args) {
  const cwd = process.cwd();
  const force = args.includes("--force") || args.includes("-f");
  const yes   = args.includes("--yes")   || args.includes("-y");
  const templatesRoot = getTemplatesRoot();

  header("infernoflow setup");

  // ── 1. Detect IDE ────────────────────────────────────────────────────────
  const { ideDetected } = detectIdeContext("auto");
  const ideLabel = ideDetected === "cursor"   ? "Cursor"
                 : ideDetected === "vscode"   ? "VS Code + Copilot"
                 : ideDetected === "windsurf" ? "Windsurf"
                 : "unknown";

  console.log(`  IDE detected: ${bold(ideLabel)}`);

  // ── 2. Init if needed ────────────────────────────────────────────────────
  const infernoDir = path.join(cwd, "inferno");
  const contractPath = path.join(infernoDir, "contract.json");

  if (!fs.existsSync(contractPath)) {
    console.log(`\n  ${yellow("inferno/")} not found — running init --adopt ...\n`);
    const initArgs = ["--adopt", yes ? "--yes" : ""].filter(Boolean).join(" ");
    runInferno(`init ${initArgs}`);
  } else {
    ok("inferno/contract.json already exists — skipping init");
  }

  // ── 3. Install hooks ─────────────────────────────────────────────────────
  const logOk   = (msg) => ok(msg);
  const logWarn = (msg) => warn(msg);

  if (ideDetected === "cursor" || ideDetected === "unknown") {
    // Default: Cursor (also works as fallback)
    installCursorHooksArtifacts({ cwd, templatesRoot, force, silent: false, logOk, logWarn });
    ok("Cursor hooks + MCP server installed");
    console.log(`  → Restart Cursor, then go to Settings → MCP and verify ${yellow("infernoflow")} shows 4 tools`);
  }

  if (ideDetected === "vscode") {
    installVsCodeCopilotHooksArtifacts({ cwd, templatesRoot, force, silent: false, logOk, logWarn });
    ok("VS Code Copilot hooks installed");
    console.log(`  → Restart VS Code, then open GitHub Copilot Chat in ${yellow("Agent")} mode`);

    // Also install Cursor hooks as fallback (MCP server works in VS Code too)
    installCursorHooksArtifacts({ cwd, templatesRoot, force: false, silent: true, logOk: () => {}, logWarn: () => {} });
  }

  // ── 4. Verify contract is readable ──────────────────────────────────────
  let capCount = 0;
  try {
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    capCount = (contract.capabilities || []).length;
  } catch {}

  // ── 5. Summary ───────────────────────────────────────────────────────────
  console.log();
  done(
    capCount > 0
      ? `infernoflow ready — ${capCount} capabilities tracked, MCP server installed for ${ideLabel}`
      : `infernoflow ready — MCP server installed for ${ideLabel}`
  );

  console.log(`\n  ${cyan("Next steps:")}`);
  if (ideDetected === "cursor") {
    console.log(`    1. Restart Cursor`);
    console.log(`    2. In Cursor chat, try: ${cyan('Use infernoflow_run with task "add a new feature"')}`);
  } else if (ideDetected === "vscode") {
    console.log(`    1. Restart VS Code`);
    console.log(`    2. Switch Copilot Chat to ${yellow("Agent")} mode`);
    console.log(`    3. Try: ${cyan('Use infernoflow_run with task "add a new feature"')}`);
  } else {
    console.log(`    1. Open your IDE and install the MCP server from ${yellow("inferno-mcp-server.mjs")}`);
    console.log(`    2. Run: ${cyan("infernoflow status")} to verify everything is working`);
  }
  console.log();
}
