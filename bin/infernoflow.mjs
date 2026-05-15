#!/usr/bin/env node

// ── Windows PowerShell unicode fix ───────────────────────────────────────
// Default PowerShell can't render box-drawing chars — patch stdout/stderr
// to replace them with ASCII equivalents before any output happens.
(function patchUnicodeForWindows() {
  if (process.platform !== "win32") return;
  if (process.env.WT_SESSION) return;   // Windows Terminal — supports unicode
  if (process.env.ConEmuPID) return;    // ConEmu/Cmder
  if (process.env.TERM_PROGRAM === "vscode") return; // VS Code terminal

  const MAP = {
    "─": "-", "━": "-", "═": "=",
    "│": "|", "┃": "|", "║": "|",
    "┌": "+", "┐": "+", "└": "+", "┘": "+",
    "├": "+", "┤": "+", "┬": "+", "┴": "+", "┼": "+",
    "·": "*", "→": "->", "←": "<-", "✔": "[OK]", "✓": "[OK]",
    "✘": "[X]", "✗": "[X]", "⚠": "[!]", "ℹ": "[i]",
  };
  const RE = new RegExp(Object.keys(MAP).join("|"), "g");

  function patch(stream) {
    const orig = stream.write.bind(stream);
    stream.write = function(chunk, ...args) {
      if (typeof chunk === "string") chunk = chunk.replace(RE, c => MAP[c]);
      else if (Buffer.isBuffer(chunk)) {
        const s = chunk.toString("utf8").replace(RE, c => MAP[c]);
        chunk = Buffer.from(s, "utf8");
      }
      return orig(chunk, ...args);
    };
  }
  patch(process.stdout);
  patch(process.stderr);
})();

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bold, gray, cyan, red } from "../lib/ui/output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Find package.json: try the dist layout first (../../package.json), then
// fall back to running from source (../package.json) so `node bin/infernoflow.mjs`
// works in development without a build step.
function findPackageJson(start) {
  for (const candidate of [join(start, "..", "..", "package.json"), join(start, "..", "package.json")]) {
    try { return JSON.parse(readFileSync(candidate, "utf8")); } catch {}
  }
  return { version: "0.0.0-source" };
}
const pkg = findPackageJson(__dirname);
const VERSION = pkg.version || "0.0.0";

const COMMAND_DESCRIPTIONS = {
  publish: "Bump version, update changelog, build, npm publish, git commit + push in one shot",
  diff: "Show what capabilities changed since the last git tag (or any ref)",
  changelog: "Draft a changelog entry from commits since the last tag",
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
  watch:    "Watch source files and run suggest automatically on save",
  ci:       "CI-native check: GitHub Actions annotations, GitLab code quality, exit codes",
  notify:   "Post capability drift summary to Slack or Discord",
  monorepo: "Manage infernoflow across monorepo packages (init | list | status | diff | sync)",
  doctor:   "Diagnose your infernoflow setup — checks Node, git, contract, AI providers, MCP, hooks",
  coverage: "Map test files to capabilities — show which caps have test coverage and which don't",
  review:   "AI-powered capability impact review for staged or recent git changes",
  scan:      "Deep AST scan — route discovery, entry point detection, HTTP URL extraction, capability suggestions",
  graph:     "Build capability dependency graph — shows which caps call which, detects breaking changes",
  stability: "Show solid/liquid stability level for every capability (frozen/stable/experimental)",
  freeze:    "Mark a capability as frozen (solid) — AI will not modify it without explicit instruction",
  thaw:      "Reset a capability to experimental (liquid) — free to evolve",
  why:       "Given a file or function name — show which capability it serves, scenarios, stability, and git history",
  impact:    "Blast radius analysis — see every cap, scenario, and risk level affected before you change anything",
  scaffold:  "Generate a new capability — source skeleton, contract registration, and placeholder scenario in one command",
  explain:   "AI narrative about a capability — what it does, why it exists, what's risky, and what to test",
  test:      "Run registered scenarios for a capability — auto-generates a smoke harness if no test runner is configured",
  ai:        "Manage AI providers — setup, status, test connection (subcommands: setup | status | test | clear)",
  demo:      "Interactive walkthrough — scaffolds a sample project and runs the full capability chain end-to-end",
  feedback:  "60-second CLI survey about how you use infernoflow (--form to open web form)",
  telemetry: "Manage anonymous usage telemetry (on | off | status) — opt-in, command names only",
  log:       "Append to session memory (decisions, gotchas, failed attempts, theme changes) — what AI can't infer from code",
  theme:     "Scan fonts, colors, and CSS variables — write inferno/theme.json so AI always matches the design system",
  switch:    "Generate a handoff summary when switching AI agents — paste into the next session so nothing is lost",
  upgrade:   "Upgrade a lite infernoflow setup to the full structure (scenarios, changelog, scripts)",
  stats:     "Value dashboard — session memory, tokens injected per session, coverage %, estimated savings",
  ask:       "Query session memory — search gotchas, decisions, and failed attempts by keyword or type",
  recap:     "End-of-session summary — what was captured, what git changes weren't logged, session health score",
  uninstall: "Remove infernoflow from a project — inferno/, CLAUDE.md, MCP server, git hooks (--dry-run to preview)",

  // ── Namespace dispatchers (route to legacy verbs) ──────────────────────────
  contract: "Capability contracts — scan, freeze, impact, graph, scaffold, etc. (run: infernoflow contract)",
  dev:      "Maintenance & integration — publish, changelog, dashboard, ai, ci, sync, etc. (run: infernoflow dev)",
  amp:      "AI Memory Protocol — status, migrate from legacy, validate (run: infernoflow amp)",
};

const COMMAND_HANDLERS = {
  publish: async (args) => (await import("../lib/commands/publish.mjs")).publishCommand(args),
  diff: async (args) => (await import("../lib/commands/diff.mjs")).diffCommand(args),
  changelog: async (args) => (await import("../lib/commands/changelog.mjs")).changelogCommand(args),
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
  // dashboard / login / logout / whoami / cloud — moved to legacy/ (v0.43.6 focus pivot, see legacy/README.md)
  watch:    async (args) => (await import("../lib/commands/watch.mjs")).watchCommand(args),
  ci:       async (args) => (await import("../lib/commands/ci.mjs")).ciCommand(args),
  notify:   async (args) => (await import("../lib/commands/notify.mjs")).notifyCommand(args),
  monorepo: async (args) => (await import("../lib/commands/monorepo.mjs")).monorepoCommand(args),
  doctor:   async (args) => (await import("../lib/commands/doctor.mjs")).doctorCommand(args),
  coverage: async (args) => (await import("../lib/commands/coverage.mjs")).coverageCommand(args),
  review:   async (args) => (await import("../lib/commands/review.mjs")).reviewCommand(args),
  scan:      async (args) => (await import("../lib/commands/scan.mjs")).scanCommand(args),
  graph:     async (args) => (await import("../lib/commands/graph.mjs")).graphCommand(args),
  stability: async (args) => (await import("../lib/commands/stability.mjs")).stabilityCommand(args),
  freeze:    async (args) => (await import("../lib/commands/stability.mjs")).freezeCommand(args),
  thaw:      async (args) => (await import("../lib/commands/stability.mjs")).thawCommand(args),
  why:       async (args) => (await import("../lib/commands/why.mjs")).whyCommand(args),
  impact:    async (args) => (await import("../lib/commands/impact.mjs")).impactCommand(args),
  scaffold:  async (args) => (await import("../lib/commands/scaffold.mjs")).scaffoldCommand(args),
  explain:   async (args) => (await import("../lib/commands/explain.mjs")).explainCommand(args),
  test:      async (args) => (await import("../lib/commands/test.mjs")).testCommand(args),
  ai:        async (args) => (await import("../lib/commands/ai.mjs")).aiCommand(args),
  demo:      async (args) => (await import("../lib/commands/demo.mjs")).demoCommand(args),
  log:       async (args) => (await import("../lib/commands/log.mjs")).logCommand(args),
  theme:     async (args) => (await import("../lib/commands/theme.mjs")).themeCommand(args),
  switch:    async (args) => (await import("../lib/commands/switch.mjs")).switchCommand(args),
  upgrade:   async (args) => (await import("../lib/commands/upgrade.mjs")).upgradeCommand(args),
  stats:     async (args) => (await import("../lib/commands/stats.mjs")).statsCommand(args),
  ask:       async (args) => (await import("../lib/commands/ask.mjs")).askCommand(args),
  recap:     async (args) => (await import("../lib/commands/recap.mjs")).recapCommand(args),
  uninstall: async (args) => (await import("../lib/commands/uninstall.mjs")).uninstallCommand(args),
  feedback:  async (args) => (await import("../lib/commands/feedback.mjs")).feedbackCommand(args),
  telemetry: async (args) => (await import("../lib/telemetry.mjs")).telemetryCommand(args),

  // ── Namespace dispatchers ──────────────────────────────────────────────────
  // Route `infernoflow <namespace> <verb> [args]` to the underlying verb. The
  // legacy top-level names above still work, so `infernoflow scan` ===
  // `infernoflow contract scan`.
  contract: async (args) => routeNamespace("contract", CONTRACT_VERBS, args),
  dev:      async (args) => routeNamespace("dev",      DEV_VERBS,      args),
  amp:      async (args) => (await import("../lib/commands/amp.mjs")).ampCommand(args),
};

async function routeNamespace(name, verbs, rawArgs) {
  // rawArgs[0] is the namespace name itself (set by the main dispatcher),
  // rawArgs[1] is the verb the user typed.
  const verb = rawArgs[1];
  if (!verb || verb === "--help" || verb === "-h") {
    console.log();
    console.log(`  ${bold("🔥 infernoflow " + name)} ${gray("— available verbs:")}`);
    console.log();
    const w = Math.max(...Object.keys(verbs).map(v => v.length)) + 2;
    for (const v of Object.keys(verbs)) {
      const desc = COMMAND_DESCRIPTIONS[verbs[v]] || "";
      console.log(`    ${cyan(v.padEnd(w))} ${gray(desc)}`);
    }
    console.log();
    console.log(`  ${gray("Run")} ${cyan(`infernoflow ${name} <verb> --help`)} ${gray("for verb-specific options.")}`);
    console.log();
    return;
  }
  const target = verbs[verb];
  if (!target || !COMMAND_HANDLERS[target]) {
    console.error(red(`\n  Unknown ${name} verb: ${verb}`));
    console.error(gray(`  Run: infernoflow ${name}   (see all verbs)\n`));
    process.exit(1);
  }
  // Hand off to the underlying handler with args reshaped to look like a
  // direct top-level invocation: [verb, ...rest]
  return COMMAND_HANDLERS[target]([target, ...rawArgs.slice(2)]);
}

function formatCommandsHelp() {
  const names = Object.keys(COMMAND_DESCRIPTIONS);
  const w = Math.max(...names.map((n) => n.length), 8) + 1;
  return Object.entries(COMMAND_DESCRIPTIONS)
    .map(([name, desc]) => `    ${name.padEnd(w, " ")}${desc}`)
    .join("\n");
}

// ── Verb maps for the namespaced dispatchers ──────────────────────────────────
// `infernoflow contract scan` routes to the same handler as `infernoflow scan`.
// All legacy top-level names remain callable for backward compatibility.
const CONTRACT_VERBS = {
  scan:        "scan",
  check:       "check",
  status:      "status",
  freeze:      "freeze",
  thaw:        "thaw",
  why:         "why",
  impact:      "impact",
  graph:       "graph",
  stability:   "stability",
  scaffold:    "scaffold",
  explain:     "explain",
  test:        "test",
  coverage:    "coverage",
  suggest:     "suggest",
  run:         "run",
  implement:   "implement",
  "doc-gate":  "doc-gate",
  "pr-impact": "pr-impact",
  review:      "review",
  demo:        "demo",
  upgrade:     "upgrade",
  context:     "context",
  sync:        "sync",
};

const DEV_VERBS = {
  publish:                         "publish",
  changelog:                       "changelog",
  diff:                            "diff",
  monorepo:                        "monorepo",
  ci:                              "ci",
  ai:                              "ai",
  theme:                           "theme",
  stats:                           "stats",
  feedback:                        "feedback",
  telemetry:                       "telemetry",
  uninstall:                       "uninstall",
  "generate-skills":               "generate-skills",
  "install-cursor-hooks":          "install-cursor-hooks",
  "install-vscode-copilot-hooks":  "install-vscode-copilot-hooks",
  setup:                           "setup",
};

// ── Full grouped command list (infernoflow commands) ──────────────────────────
// Top-level surface advertised in --help is just 12 commands. Everything else
// stays callable as a top-level alias (back-compat) — the grouping below is
// what `infernoflow commands` shows for discoverability.
const COMMAND_GROUPS = {
  "Memory  (top-level)":          ["log", "ask", "switch", "recap", "status"],
  "Watch   (top-level)":          ["watch"],
  "Setup   (top-level)":          ["init", "doctor"],
  "AMP       (use: infernoflow amp <verb>)":
    ["status", "migrate", "validate", "version"],
  "Contract  (use: infernoflow contract <verb>)":
    Object.keys(CONTRACT_VERBS),
  "Dev       (use: infernoflow dev <verb>)":
    Object.keys(DEV_VERBS),
};

function formatCommandGroups() {
  const w = 18;
  return Object.entries(COMMAND_GROUPS).map(([group, cmds]) =>
    `  ${bold(group + ":")}\n    ${cmds.join("  ")}`
  ).join("\n\n");
}

const TOTAL_COMMANDS = Object.keys(COMMAND_HANDLERS).length;

const HELP = `
  ${bold("🔥 infernoflow")} ${gray("v" + VERSION)}
  ${gray("Persistent memory for AI coding sessions")}

  ${bold("Usage:")}
    infernoflow [command] [options]

  ${bold("Memory")} ${gray("— the 5-command core")}
    ${cyan("log")} ${gray('"..."')}         Add to session memory ${gray("(--type gotcha|decision|attempt)")}
    ${cyan("ask")} ${gray('"..."')}         Search your memory by keyword ${gray("(gotchas surface first)")}
    ${cyan("switch")}            Generate handoff for next AI agent
    ${cyan("recap")}             End-of-session health score + unlogged changes
    ${cyan("status")}            Quick health check

  ${bold("Setup")}
    ${cyan("init")}              60-second setup ${gray("(memory mode by default)")}
    ${cyan("watch")}             Auto-capture mode ${gray("(stuck-loops, dep changes, test removals)")}
    ${cyan("doctor")}            Diagnose your setup

  ${bold("Subsystems")} ${gray("— grouped, run for verbs:")}
    ${cyan("amp")}                AI Memory Protocol ${gray("(status, migrate, validate)")}
    ${cyan("contract")}          Capability contracts ${gray("(scan, freeze, impact, scaffold, …)")}
    ${cyan("dev")}                Publishing, AI providers, hooks ${gray("(publish, ai, ci, …)")}

  ${gray("Run")} ${cyan("infernoflow commands")} ${gray("to see all " + TOTAL_COMMANDS + " commands grouped.")}
  ${gray("Run")} ${cyan("infernoflow <command> --help")} ${gray("for command-specific options.")}
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
if (cmd === "commands") {
  console.log(`\n  ${bold("🔥 infernoflow")} ${gray("v" + VERSION)} ${gray("— all " + TOTAL_COMMANDS + " commands")}\n`);
  console.log(formatCommandGroups());
  console.log(`\n  ${gray("Run")} ${cyan("infernoflow <command> --help")} ${gray("for options.")}\n`);
  process.exit(0);
}

const commands = Object.keys(COMMAND_HANDLERS);

if (!commands.includes(cmd)) {
  console.error(red(`\nUnknown command: ${cmd}`));
  console.error(gray(`Run: infernoflow commands  (see all commands)`));
  console.error(gray("Run: infernoflow --help    (quick start)\n"));
  process.exit(1);
}

const args = [cmd, ...rest];

// ── Silent version-skew backfill ──────────────────────────────────────────
// If the CLI was upgraded since the last time it ran in this project,
// re-run the bits of init that need to be refreshed (rule files, MCP
// server registration, .gitignore block). Idempotent + non-fatal — runs
// before the command's own handler so a freshly-upgraded user gets a
// fully-wired environment on the very next command, without having to
// know to run `infernoflow setup` themselves.
//
// Skips for help/version/init/setup/doctor/uninstall — those either don't
// need it or do their own setup. Also skips when there's no infernoflow
// project in cwd at all (we don't scaffold into random folders).
try {
  const { runUpgradeBackfillIfNeeded } = await import("../lib/upgradeCheck.mjs");
  await runUpgradeBackfillIfNeeded(VERSION, cmd);
} catch { /* never block the user's command on the upgrade check */ }

COMMAND_HANDLERS[cmd](args).catch((err) => {
  console.error(red("\nError: ") + err.message);
  process.exit(1);
});
