#!/usr/bin/env node

import { bold, gray, cyan, red } from "../lib/ui/output.mjs";

const VERSION = "0.4.2";

const HELP = `
  ${bold("í´¥ infernoflow")} ${gray("v" + VERSION)}
  ${gray("The forge for liquid code")}

  ${bold("Usage:")}
    infernoflow <command> [options]

  ${bold("Commands:")}
    init          Scaffold inferno/ in your project (interactive)
    check         Validate contract, capabilities, scenarios, changelog
    status        Show contract health at a glance
    doc-gate      Fail if code changed but docs were not updated
    suggest       Generate AI prompt + apply capability updates

  ${bold("Options:")}
    init:
      --force, -f     Overwrite existing files
      --yes, -y       Skip prompts, use defaults

    check:
      --skip-doc-gate   Skip the git doc-gate check
      --json            Machine-readable JSON output (for CI)
`;

const [,, cmd, ...rest] = process.argv;

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(HELP);
  process.exit(0);
}

if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
  process.exit(0);
}

const commands = ["init", "check", "status", "doc-gate", "suggest"];

if (!commands.includes(cmd)) {
  console.error(red(`\nUnknown command: ${cmd}`));
  console.error(gray("Run: infernoflow --help\n"));
  process.exit(1);
}

const args = [cmd, ...rest];

switch (cmd) {
  case "init":
    import("../lib/commands/init.mjs")
      .then(m => m.initCommand(args))
      .catch(err => { console.error(red("\nError: ") + err.message); process.exit(1); });
    break;
  case "check":
    import("../lib/commands/check.mjs")
      .then(m => m.checkCommand(args))
      .catch(err => { console.error(red("\nError: ") + err.message); process.exit(1); });
    break;
  case "status":
    import("../lib/commands/status.mjs")
      .then(m => m.statusCommand(args))
      .catch(err => { console.error(red("\nError: ") + err.message); process.exit(1); });
    break;
  case "suggest":
    import("../lib/commands/suggest.mjs")
      .then(m => m.suggestCommand(args))
      .catch(err => { console.error(red("\nError: ") + err.message); process.exit(1); });
    break;
  case "doc-gate":
    import("../lib/commands/docGate.mjs")
      .then(m => m.docGateCommand())
      .catch(err => { console.error(red("\nError: ") + err.message); process.exit(1); });
    break;
}
