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
// When installed globally: __dirname = .../infernoflow/dist/bin
// Root package.json lives two levels up at .../infernoflow/package.json
// npm always includes the root package.json, so this path is always reliable.
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
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
  synthesize: "Auto-detect workflow patterns and synthesize reusable skills + agents",
  agent: "Manage and run auto-synthesized agents (list | run | show | delete)",
  version: "Smart semver bump recommendation based on capability changes (--apply to write)",
  "pr-comment": "Post capability drift analysis as a GitHub PR comment (works in CI automatically)",
  dashboard: "Launch local web dashboard on localhost:7337 — live contract health, capabilities, agents",
  "team-sync": "Sync capability contract across a team via a shared git branch (push | pull | status | init)",
  onboard: "Interactive onboarding wizard for new developers — explains infernoflow in 5 minutes",
  cloud:   "Sync capability contracts via infernoflow cloud (init | push | pull | status | dashboard)",
  share:   "Generate a public read-only HTML snapshot of your capability contract",
  watch:   "Watch source files and run suggest automatically on save",
  ci:      "CI-native check: GitHub Actions annotations, GitLab code quality, exit codes",
  notify:  "Post capability drift summary to Slack or Discord",
  report:  "Generate a weekly/monthly HTML or Markdown report of capability activity",
  monorepo: "Manage infernoflow across monorepo packages (init | list | status | diff | sync)",
  link:    "Link capabilities to Jira, Linear, or GitHub Issues tickets",
  audit:   "Classify capabilities by sensitivity (auth, payment, PII, admin) and generate security surface map",
  scout:   "Scan source files for undocumented capabilities not yet in the contract",
  export:  "Export contract to OpenAPI, Backstage catalog-info.yaml, CSV, or Markdown",
  snapshot: "Save/diff/restore named snapshots of the capability contract",
  health:  "Compute a 0–100 health score across coverage, docs, freshness, completeness, drift",
  vibe:    "Vibe coding mode — watches files, auto-syncs contract, regenerates context on every save",
  adopt:   "Interactive wizard to adopt infernoflow in an existing project (detect → review → wire up)",
  doctor:  "Diagnose your infernoflow setup — checks Node, git, contract, AI providers, MCP, hooks",
  coverage: "Map test files to capabilities — show which caps have test coverage and which don't",
  review:  "AI-powered capability impact review for staged or recent git changes",
  scan:       "Deep AST scan — route discovery, entry point detection, HTTP URL extraction, capability suggestions",
  graph:      "Build capability dependency graph — shows which caps call which, detects breaking changes",
  stability:  "Show solid/liquid stability level for every capability (frozen/stable/experimental)",
  freeze:     "Mark a capability as frozen (solid) — AI will not modify it without explicit instruction",
  thaw:       "Reset a capability to experimental (liquid) — free to evolve",
  why:        "Given a file or function name — show which capability it serves, scenarios, stability, and git history",
  impact:     "Blast radius analysis — see every cap, scenario, and risk level affected before you change anything",
  scaffold:   "Generate a new capability — source skeleton, contract registration, and placeholder scenario in one command",
  explain:    "AI narrative about a capability — what it does, why it exists, what's risky, and what to test",
  test:       "Run registered scenarios for a capability — auto-generates a smoke harness if no test runner is configured",
  ai:         "Manage AI providers — setup, status, test connection (subcommands: setup | status | test | clear)",
  demo:       "Interactive walkthrough — scaffolds a sample project and runs the full capability chain end-to-end",
  log:        "Append to session memory (decisions, gotchas, failed attempts, theme changes) — what AI can't infer from code",
  theme:      "Scan fonts, colors, and CSS variables — write inferno/theme.json so AI always matches the design system",
  switch:     "Generate a handoff summary when switching AI agents — paste into the next session so nothing is lost",
  upgrade:    "Upgrade a lite infernoflow setup to the full structure (scenarios, changelog, scripts)",
  stats:      "Value dashboard — session memory, tokens injected per session, coverage %, estimated savings",
  ask:        "Query session memory — search gotchas, decisions, and failed attempts by keyword or type",
  recap:      "End-of-session summary — what was captured, what git changes weren't logged, session health score",
  uninstall:  "Remove infernoflow from a project — inferno/, CLAUDE.md, MCP server, git hooks (--dry-run to preview)",
  feedback:   "60-second CLI survey about how you use infernoflow (--form to open web form)",
  telemetry:  "Manage anonymous usage telemetry (on | off | status) — opt-in, command names only",
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
  synthesize: async (args) => (await import("../lib/commands/synthesize.mjs")).synthesizeCommand(args),
  agent: async (args) => (await import("../lib/commands/agent.mjs")).agentCommand(args),
  version: async (args) => (await import("../lib/commands/version.mjs")).versionCommand(args),
  "pr-comment": async (args) => (await import("../lib/commands/prComment.mjs")).prCommentCommand(args),
  dashboard: async (args) => (await import("../lib/commands/dashboard.mjs")).dashboardCommand(args),
  "team-sync": async (args) => (await import("../lib/commands/teamSync.mjs")).teamSyncCommand(args),
  onboard: async (args) => (await import("../lib/commands/onboard.mjs")).onboardCommand(args),
  cloud:   async (args) => (await import("../lib/commands/cloud.mjs")).cloudCommand(args),
  share:   async (args) => (await import("../lib/commands/share.mjs")).shareCommand(args),
  watch:   async (args) => (await import("../lib/commands/watch.mjs")).watchCommand(args),
  ci:      async (args) => (await import("../lib/commands/ci.mjs")).ciCommand(args),
  notify:  async (args) => (await import("../lib/commands/notify.mjs")).notifyCommand(args),
  report:  async (args) => (await import("../lib/commands/report.mjs")).reportCommand(args),
  monorepo: async (args) => (await import("../lib/commands/monorepo.mjs")).monorepoCommand(args),
  link:    async (args) => (await import("../lib/commands/link.mjs")).linkCommand(args),
  audit:    async (args) => (await import("../lib/commands/audit.mjs")).auditCommand(args),
  scout:    async (args) => (await import("../lib/commands/scout.mjs")).scoutCommand(args),
  export:   async (args) => (await import("../lib/commands/export.mjs")).exportCommand(args),
  snapshot: async (args) => (await import("../lib/commands/snapshot.mjs")).snapshotCommand(args),
  health:   async (args) => (await import("../lib/commands/health.mjs")).healthCommand(args),
  vibe:     async (args) => (await import("../lib/commands/vibe.mjs")).vibeCommand(args),
  adopt:    async (args) => (await import("../lib/commands/adoptWizard.mjs")).adoptWizardCommand(args),
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
};

function formatCommandsHelp() {
  const names = Object.keys(COMMAND_DESCRIPTIONS);
  const w = Math.max(...names.map((n) => n.length), 8) + 1;
  return Object.entries(COMMAND_DESCRIPTIONS)
    .map(([name, desc]) => `    ${name.padEnd(w, " ")}${desc}`)
    .join("\n");
}

// ── Full grouped command list (infernoflow commands) ──────────────────────────
const COMMAND_GROUPS = {
  "Session Memory":  ["log", "ask", "switch", "recap", "stats", "theme"],
  "Context":         ["context", "scan", "suggest", "check", "status"],
  "Code Analysis":   ["graph", "impact", "why", "coverage", "stability", "freeze", "thaw", "scout"],
  "Workflow":        ["run", "sync", "watch", "vibe", "implement", "doc-gate", "synthesize", "agent"],
  "Publishing":      ["publish", "version", "changelog", "diff"],
  "Team":            ["team-sync", "cloud", "share", "notify", "pr-comment", "pr-impact"],
  "Quality":         ["health", "audit", "review", "snapshot", "export", "link"],
  "Integration":     ["ai", "ci", "coverage"],
  "Setup":           ["init", "setup", "adopt", "demo", "doctor", "onboard", "generate-skills", "upgrade", "uninstall"],
  "Advanced":        ["scaffold", "explain", "test", "report", "monorepo", "feedback", "telemetry"],
};

function formatCommandGroups() {
  const w = 18;
  return Object.entries(COMMAND_GROUPS).map(([group, cmds]) =>
    `  ${bold(group + ":")}
    ${cmds.join("  ")}`
  ).join("\n\n");
}

const HELP = `
  ${bold("🔥 infernoflow")} ${gray("v" + VERSION)}
  ${gray("Persistent memory for AI coding sessions")}

  ${bold("Usage:")}
    infernoflow [command] [options]

  ${bold("Core Commands:")}
    ${cyan("log")} ${gray('"..."')}         Add to session memory ${gray("(--type gotcha|decision|attempt|preference)")}
    ${cyan("ask")} ${gray('"..."')}         Search your memory by keyword ${gray("(gotchas surface first)")}
    ${cyan("switch")}            Generate handoff for next AI agent
    ${cyan("recap")}             End-of-session health score + unlogged changes
    ${cyan("status")}            Contract health at a glance

  ${bold("Getting Started:")}
    ${cyan("setup")}             One command to get fully operational
    ${cyan("demo")}              Interactive walkthrough ${gray("(5 minutes)")}
    ${cyan("doctor")}            Diagnose your setup

  ${gray("Run")} ${cyan("infernoflow commands")} ${gray("to see all 50+ commands.")}
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
  console.log(`\n  ${bold("🔥 infernoflow")} ${gray("v" + VERSION)} ${gray("— all commands")}\n`);
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
COMMAND_HANDLERS[cmd](args).catch((err) => {
  console.error(red("\nError: ") + err.message);
  process.exit(1);
});
