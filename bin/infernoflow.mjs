#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bold, gray, cyan, red } from "../lib/ui/output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
const VERSION = pkg.version || "0.0.0";
const COMMAND_DESCRIPTIONS = {
  setup: "One command to get fully operational — detects IDE, inits, installs hooks + MCP",
  init: "Scaffold inferno/ in your project (or adopt existing project)",
  "install-cursor-hooks": "Install Cursor hooks: draft agent replies to inferno/CONTEXT.draft.md",
  "install-vscode-copilot-hooks":
    "Install VS Code + Copilot agent hooks (Preview): draft to inferno/CONTEXT.draft.md",
  check: "Validate contract, capabilities, scenarios, changelog",
  status: "Show contract health at a glance",
  "pr-impact": "Summarize PR impact on capabilities and docs",
  sync: "Run deterministic inferno sync flow",
  run: "One-command detect/propose/apply/validate flow",
  "doc-gate": "Fail if code changed but docs were not updated",
  suggest: "Generate AI prompt + apply capability updates",
  implement: "Generate code-agent implementation prompt(s)",
  context: "Generate AI-ready context for new sessions",
  "generate-skills": "Generate personalised Cursor rules + skill files from your developer profile",
};

const COMMAND_HANDLERS = {
  setup: async (args) => (await import("../lib/commands/setup.mjs")).setupCommand(args),
  init: async (args) => (await import("../lib/commands/init.mjs")).initCommand(args),
  "install-cursor-hooks": async (args) =>
    (await import("../lib/commands/installCursorHooks.mjs")).installCursorHooksCommand(args),
  "install-vscode-copilot-hooks": async (args) =>
    (await import("../lib/commands/installVsCodeCopilotHooks.mjs")).installVsCodeCopilotHooksCommand(args),
  check: async (args) => (await import("../lib/commands/check.mjs")).checkCommand(args),
  status: async (args) => (await import("../lib/commands/status.mjs")).statusCommand(args),
  "pr-impact": async (args) => (await import("../lib/commands/prImpact.mjs")).prImpactCommand(args),
  sync: async (args) => (await import("../lib/commands/syncAuto.mjs")).syncCommand(args),
  run: async (args) => (await import("../lib/commands/run.mjs")).runCommand(args),
  suggest: async (args) => (await import("../lib/commands/suggest.mjs")).suggestCommand(args),
  implement: async (args) => (await import("../lib/commands/implement.mjs")).implementCommand(args),
  context: async (args) => (await import("../lib/commands/context.mjs")).contextCommand(args),
  "doc-gate": async (args) => (await import("../lib/commands/docGate.mjs")).docGateCommand(args),
  "generate-skills": async (args) => (await import("../lib/commands/generateSkills.mjs")).generateSkillsCommand(args),
};

function formatCommandsHelp() {
  const names = Object.keys(COMMAND_DESCRIPTIONS);
  const w = Math.max(...names.map((n) => n.length), 8) + 1;
  return Object.entries(COMMAND_DESCRIPTIONS)
    .map(([name, desc]) => `    ${name.padEnd(w, " ")}${desc}`)
    .join("\n");
}

const HELP = `
  ${bold("🔥 infernoflow")} ${gray("v" + VERSION)}
  ${gray("The forge for liquid code — keep every AI session in sync")}

  ${bold("Usage:")}
    infernoflow <command> [options]

  ${bold("Commands:")}
${formatCommandsHelp()}

  ${bold("setup options:")}
    --yes, -y           Skip prompts (non-interactive)
    --force, -f         Overwrite existing hook files

  ${bold("init options:")}
    --cursor-hooks           Also install Cursor hooks (draft → inferno/CONTEXT.draft.md)
    --vscode-copilot-hooks   Also install VS Code + Copilot hooks (.github/hooks — Preview)
    --adopt             Infer capabilities from an existing codebase
    --lang <name>       Override detected language (e.g. ts, js, py)
    --framework <name>  Override detected framework (e.g. react, angular, express)
    --project-type <t>  Override project type (frontend|backend|fullstack|cli|library)
    --report-json       Print inferred adoption report as JSON
    --report-json-only  Print JSON report only (no human-readable logs)
    --report-human-only Print only human-readable adoption report (no JSON block)
    --yes, -y           Skip prompts and accept inferred/default values
    --force, -f         Overwrite existing inferno/ files

  ${bold("install-cursor-hooks options:")}
    --force, -f         Overwrite .cursor/hooks.json and hook scripts if they exist

  ${bold("install-vscode-copilot-hooks options:")}
    --force, -f         Overwrite .github/hooks/infernoflow-drafts.json and scripts if they exist

  ${bold("context options:")}
    --intent  "..."     What you plan to build next
    --working "..."     What you are building right now
    --decision "..."    Record a decision or note
    --show              Print context without writing file
    --copy, -c          Copy context to clipboard instantly
    --reset             Clear all stored state
    --watch             Poll git diff every 30s and auto-update CONTEXT.md (living context)
    --interval <secs>   Watch poll interval in seconds (default: 30)

  ${bold("generate-skills options:")}
    --cursor            Also install rules to .cursor/rules/infernoflow.md
    --force, -f         Overwrite existing generated skill files

  ${bold("implement options:")}
    --mode <type>       cursor | generic | both (default: both)
    --copy, -c          Copy generated prompt(s) to clipboard

  ${bold("run options:")}
    --dry-run           Execute full flow without writing files
    --json              Emit machine-readable events and result payload
    --no-rollback       Keep changes even if validation fails
    --provider <type>   auto | agent | local | prompt (default: auto)
    --ide <name>        auto | cursor | vscode | windsurf (default: auto)

  ${bold("Typical workflow:")}
    ${gray('1. infernoflow context --intent "what I want to build"')}
    ${gray("2. [paste inferno/CONTEXT.md into Claude / Cursor / Copilot]")}
    ${gray("3. [build the feature]")}
    ${gray('4. infernoflow suggest "what I built"')}
    ${gray("5. infernoflow check")}

  ${bold("Machine output:")}
    ${gray("status --json")}
    ${gray("check --json")}
    ${gray("doc-gate --json")}
    ${gray("pr-impact --json")}
    ${gray("sync --auto --json")}
    ${gray('run "task" --json')}
`;

// ── Silent behavior observation ───────────────────────────────────────────
import * as fs from "node:fs";
import * as path from "node:path";
try {
  const infernoDir = path.join(process.cwd(), "inferno");
  if (fs.existsSync(infernoDir)) {
    const { observeCommandStart } = await import("../lib/learning/observe.mjs");
    const cmdForObserve = process.argv[2];
    if (cmdForObserve && !cmdForObserve.startsWith("-")) {
      observeCommandStart(infernoDir, cmdForObserve);
    }
  }
} catch {}

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(HELP);
  process.exit(0);
}
if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
  process.exit(0);
}

const commands = Object.keys(COMMAND_HANDLERS);

if (!commands.includes(cmd)) {
  console.error(red(`\nUnknown command: ${cmd}`));
  console.error(gray("Run: infernoflow --help\n"));
  process.exit(1);
}

const args = [cmd, ...rest];
COMMAND_HANDLERS[cmd](args).catch((err) => {
  console.error(red("\nError: ") + err.message);
  process.exit(1);
});
