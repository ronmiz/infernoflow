#!/usr/bin/env node
import { bold, gray, cyan, red } from "../lib/ui/output.mjs";

const VERSION = "0.5.0";

const HELP = `
  ${bold("🔥 infernoflow")} ${gray("v" + VERSION)}
  ${gray("The forge for liquid code — keep every AI session in sync")}

  ${bold("Usage:")}
    infernoflow <command> [options]

  ${bold("Commands:")}
    init          Scaffold inferno/ in your project
    check         Validate contract, capabilities, scenarios, changelog
    status        Show contract health at a glance
    doc-gate      Fail if code changed but docs were not updated
    suggest       Generate AI prompt + apply capability updates
    context       Generate AI-ready context for new sessions

  ${bold("context options:")}
    --intent  "..."     What you plan to build next
    --working "..."     What you are building right now
    --decision "..."    Record a decision or note
    --show              Print context without writing file
    --copy, -c          Copy context to clipboard instantly
    --reset             Clear all stored state

  ${bold("Typical workflow:")}
    ${gray('1. infernoflow context --intent "what I want to build"')}
    ${gray("2. [paste inferno/CONTEXT.md into Claude / Cursor / Copilot]")}
    ${gray("3. [build the feature]")}
    ${gray('4. infernoflow suggest "what I built"')}
    ${gray("5. infernoflow check")}
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

const commands = ["init", "check", "status", "doc-gate", "suggest", "context"];

if (!commands.includes(cmd)) {
  console.error(red(`\nUnknown command: ${cmd}`));
  console.error(gray("Run: infernoflow --help\n"));
  process.exit(1);
}

const args = [cmd, ...rest];

switch (cmd) {
  case "init":
    import("../lib/commands/init.mjs")
      .then((m) => m.initCommand(args))
      .catch((err) => {
        console.error(red("\nError: ") + err.message);
        process.exit(1);
      });
    break;
  case "check":
    import("../lib/commands/check.mjs")
      .then((m) => m.checkCommand(args))
      .catch((err) => {
        console.error(red("\nError: ") + err.message);
        process.exit(1);
      });
    break;
  case "status":
    import("../lib/commands/status.mjs")
      .then((m) => m.statusCommand(args))
      .catch((err) => {
        console.error(red("\nError: ") + err.message);
        process.exit(1);
      });
    break;
  case "suggest":
    import("../lib/commands/suggest.mjs")
      .then((m) => m.suggestCommand(args))
      .catch((err) => {
        console.error(red("\nError: ") + err.message);
        process.exit(1);
      });
    break;
  case "context":
    import("../lib/commands/context.mjs")
      .then((m) => m.contextCommand(args))
      .catch((err) => {
        console.error(red("\nError: ") + err.message);
        process.exit(1);
      });
    break;
  case "doc-gate":
    import("../lib/commands/docGate.mjs")
      .then((m) => m.docGateCommand())
      .catch((err) => {
        console.error(red("\nError: ") + err.message);
        process.exit(1);
      });
    break;
}
