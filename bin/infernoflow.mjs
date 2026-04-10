#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bold, gray, cyan, red } from "../lib/ui/output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
const VERSION = pkg.version || "0.0.0";
const COMMAND_DESCRIPTIONS = {
  init: "Scaffold inferno/ in your project (or adopt existing project)",
  check: "Validate contract, capabilities, scenarios, changelog",
  status: "Show contract health at a glance",
  "pr-impact": "Summarize PR impact on capabilities and docs",
  sync: "Run deterministic inferno sync flow",
  run: "One-command detect/propose/apply/validate flow",
  "doc-gate": "Fail if code changed but docs were not updated",
  suggest: "Generate AI prompt + apply capability updates",
  implement: "Generate code-agent implementation prompt(s)",
  context: "Generate AI-ready context for new sessions",
};

const COMMAND_HANDLERS = {
  init: async (args) => (await import("../lib/commands/init.mjs")).initCommand(args),
  check: async (args) => (await import("../lib/commands/check.mjs")).checkCommand(args),
  status: async (args) => (await import("../lib/commands/status.mjs")).statusCommand(args),
  "pr-impact": async (args) => (await import("../lib/commands/prImpact.mjs")).prImpactCommand(args),
  sync: async (args) => (await import("../lib/commands/syncAuto.mjs")).syncCommand(args),
  run: async (args) => (await import("../lib/commands/run.mjs")).runCommand(args),
  suggest: async (args) => (await import("../lib/commands/suggest.mjs")).suggestCommand(args),
  implement: async (args) => (await import("../lib/commands/implement.mjs")).implementCommand(args),
  context: async (args) => (await import("../lib/commands/context.mjs")).contextCommand(args),
  "doc-gate": async (args) => (await import("../lib/commands/docGate.mjs")).docGateCommand(args),
};

function formatCommandsHelp() {
  return Object.entries(COMMAND_DESCRIPTIONS)
    .map(([name, desc]) => `    ${name.padEnd(13, " ")}${desc}`)
    .join("\n");
}

const HELP = `
  ${bold("🔥 infernoflow")} ${gray("v" + VERSION)}
  ${gray("The forge for liquid code — keep every AI session in sync")}

  ${bold("Usage:")}
    infernoflow <command> [options]

  ${bold("Commands:")}
${formatCommandsHelp()}

  ${bold("init options:")}
    --adopt             Infer capabilities from an existing codebase
    --lang <name>       Override detected language (e.g. ts, js, py)
    --framework <name>  Override detected framework (e.g. react, angular, express)
    --project-type <t>  Override project type (frontend|backend|fullstack|cli|library)
    --report-json       Print inferred adoption report as JSON
    --report-json-only  Print JSON report only (no human-readable logs)
    --report-human-only Print only human-readable adoption report (no JSON block)
    --yes, -y           Skip prompts and accept inferred/default values
    --force, -f         Overwrite existing inferno/ files

  ${bold("context options:")}
    --intent  "..."     What you plan to build next
    --working "..."     What you are building right now
    --decision "..."    Record a decision or note
    --show              Print context without writing file
    --copy, -c          Copy context to clipboard instantly
    --reset             Clear all stored state

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
