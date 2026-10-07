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

  // Box-drawing + status glyphs above get readable ASCII. Emoji have no
  // sensible ASCII equivalent and render as mojibake (🔥 → "ΓöÉ") in legacy
  // PowerShell, so strip whatever the MAP didn't already convert. MAP runs
  // FIRST so glyphs we DO want to keep (✔ → [OK], ⚠ → [!]) are converted
  // before this catch-all removes the rest. The emoji and ONE trailing space
  // are removed together so "  🔥 infernoflow" → "  infernoflow" keeps its
  // 2-space indent (a bare strip would leave a stray leading space).
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{200D}]\u{FE0F}? ?/gu;
  const scrub = (s) => s.replace(RE, c => MAP[c]).replace(EMOJI_RE, "");

  function patch(stream) {
    const orig = stream.write.bind(stream);
    stream.write = function(chunk, ...args) {
      if (typeof chunk === "string") chunk = scrub(chunk);
      else if (Buffer.isBuffer(chunk)) {
        chunk = Buffer.from(scrub(chunk.toString("utf8")), "utf8");
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
function findPackageJson(start) {
  for (const candidate of [join(start, "..", "..", "package.json"), join(start, "..", "package.json")]) {
    try { return JSON.parse(readFileSync(candidate, "utf8")); } catch {}
  }
  return { version: "0.0.0-source" };
}
const pkg = findPackageJson(__dirname);
const VERSION = pkg.version || "0.0.0";

// ── Surface kept after the Phase 2 truth audit ────────────────────────────
// Mission: persistent memory for AI coding sessions. Every command below
// either captures memory, queries memory, hands off between sessions, or
// wires up the IDE so memory can flow. Off-mission commands (publish, ci,
// monorepo, scaffold, scan, graph, theme, suggest, run, etc. — ~30 verbs)
// were removed in Phase 4 of the v0.44 refactor. See docs/CHANGELOG.md.

const COMMAND_DESCRIPTIONS = {
  // ── Memory core (the five that ARE the product) ────────────────────────
  log:    "Append to session memory (decisions, gotchas, failed attempts)",
  ask:    "Query memory by keyword (gotchas surface first)",
  switch: "Generate a handoff doc for the next AI agent / session",
  recap:  "End-of-session summary + health score + unlogged-change surfacing",
  status: "Quick health check — entries, gotchas, decisions, last activity",
  refresh: "Rebuild CLAUDE.md / .cursorrules / copilot-instructions.md from memory",
  forget: "Delete a memory entry by id or unique prefix (--last for the newest)",
  prune:  "Archive stale notes/attempts (gotchas/decisions never touched) — see --apply",
  bookmark: "Drop / list / recall named session resume points (bookmarks with context)",

  // ── Setup / scaffolding ────────────────────────────────────────────────
  init:    "Scaffold .ai-memory/ and wire the current IDE in one command",
  setup:   "Re-run wiring (idempotent) — detects IDE, installs MCP + hooks",
  doctor:  "Diagnose your setup — Node, git, contract, AI provider, MCP, hooks",
  context: "Generate AI-ready context for new sessions",

  // ── IDE-side wiring ────────────────────────────────────────────────────
  "install-cursor-hooks":         "Install Cursor hooks (afterAgentResponse + stop)",
  "install-vscode-copilot-hooks": "Install VS Code + Copilot agent hooks (Preview)",
  "generate-skills":              "Generate Cursor rules + skill files from your developer profile",

  // ── Configuration / housekeeping ───────────────────────────────────────
  ai:        "Manage AI providers — setup, status, test, clear",
  telemetry: "Opt-in anonymous telemetry (on | off | status)",
  uninstall: "Remove infernoflow from a project (--dry-run to preview)",

  // ── Contract validation (kept for users who use capability contracts) ──
  check:     "Validate contract, capabilities, scenarios, changelog",

  // ── Cross-machine sync (personal layer) ────────────────────────────────
  sync:    "Cross-machine sync for personal memory — status/set/clear/migrate",

  // ── Namespace ──────────────────────────────────────────────────────────
  amp: "AI Memory Protocol — status, migrate, validate (run: infernoflow amp)",
};

const COMMAND_HANDLERS = {
  // memory core
  log:    async (args) => (await import("../lib/commands/log.mjs")).logCommand(args),
  ask:    async (args) => (await import("../lib/commands/ask.mjs")).askCommand(args),
  switch: async (args) => (await import("../lib/commands/switch.mjs")).switchCommand(args),
  recap:   async (args) => (await import("../lib/commands/recap.mjs")).recapCommand(args),
  status:  async (args) => (await import("../lib/commands/status.mjs")).statusCommand(args),
  refresh: async (args) => (await import("../lib/commands/refresh.mjs")).refreshCommand(args),
  forget:  async (args) => (await import("../lib/commands/forget.mjs")).forgetCommand(args),
  prune:   async (args) => (await import("../lib/commands/prune.mjs")).pruneCommand(args),
  bookmark: async (args) => (await import("../lib/commands/bookmark.mjs")).bookmarkCommand(args),

  // setup
  init:    async (args) => (await import("../lib/commands/init.mjs")).initCommand(args),
  setup:   async (args) => (await import("../lib/commands/setup.mjs")).setupCommand(args),
  doctor:  async (args) => (await import("../lib/commands/doctor.mjs")).doctorCommand(args),
  context: async (args) => (await import("../lib/commands/context.mjs")).contextCommand(args),

  // ide wiring
  "install-cursor-hooks":         async (args) => (await import("../lib/commands/installCursorHooks.mjs")).installCursorHooksCommand(args),
  "install-vscode-copilot-hooks": async (args) => (await import("../lib/commands/installVsCodeCopilotHooks.mjs")).installVsCodeCopilotHooksCommand(args),
  "generate-skills":              async (args) => (await import("../lib/commands/generateSkills.mjs")).generateSkillsCommand(args),

  // configuration / housekeeping
  ai:        async (args) => (await import("../lib/commands/ai.mjs")).aiCommand(args),
  telemetry: async (args) => (await import("../lib/telemetry.mjs")).telemetryCommand(args),
  uninstall: async (args) => (await import("../lib/commands/uninstall.mjs")).uninstallCommand(args),

  // contract validation (kept; `check` uses lib/commands/docGate.mjs internally)
  check:     async (args) => (await import("../lib/commands/check.mjs")).checkCommand(args),

  // cross-machine sync
  sync:      async (args) => (await import("../lib/commands/sync.mjs")).syncCommand(args),

  // namespace
  amp: async (args) => (await import("../lib/commands/amp.mjs")).ampCommand(args),
};

function formatCommandsHelp() {
  const names = Object.keys(COMMAND_DESCRIPTIONS);
  const w = Math.max(...names.map((n) => n.length), 8) + 1;
  return Object.entries(COMMAND_DESCRIPTIONS)
    .map(([name, desc]) => `    ${name.padEnd(w, " ")}${desc}`)
    .join("\n");
}

const COMMAND_GROUPS = {
  "Memory (the 5-command core)":  ["log", "ask", "switch", "recap", "status", "refresh", "forget", "prune", "bookmark"],
  "Setup":                        ["init", "setup", "doctor", "context"],
  "IDE wiring":                   ["install-cursor-hooks", "install-vscode-copilot-hooks", "generate-skills"],
  "Configuration":                ["ai", "telemetry", "sync", "uninstall"],
  "Contract":                     ["check"],
  "AMP (use: infernoflow amp <verb>)": ["status", "migrate", "validate", "version"],
};

function formatCommandGroups() {
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
    ${cyan("setup")}             Re-run IDE wiring ${gray("(idempotent — MCP + hooks)")}
    ${cyan("doctor")}            Diagnose your setup
    ${cyan("context")}           Generate AI-ready context for new sessions

  ${bold("Subsystems")} ${gray("— grouped, run for verbs:")}
    ${cyan("amp")}               AI Memory Protocol ${gray("(status, migrate, validate)")}

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
try {
  const { runUpgradeBackfillIfNeeded } = await import("../lib/upgradeCheck.mjs");
  await runUpgradeBackfillIfNeeded(VERSION, cmd);
} catch { /* never block the user's command on the upgrade check */ }

COMMAND_HANDLERS[cmd](args).catch((err) => {
  console.error(red("\nError: ") + err.message);
  process.exit(1);
});
