/**
 * Per-command `--help` (0.46.5).
 *
 * Before this, most commands ignored --help and simply ran — `refresh --help`
 * rewrote rule files, `setup --help` wired MCP configs, `install-*-hooks --help`
 * installed hooks. bin/infernoflow.mjs now answers `<command> --help` / `-h`
 * from this table and exits before the command (and before the upgrade
 * backfill) runs. Commands listed in OWN_HELP print their own, richer help.
 */

/** Commands whose own --help output is kept (they print usage without side effects). */
import { ENTRY_TYPES } from "./schema.mjs";

export const OWN_HELP = new Set(["init"]);

/** Called by AI-tool configs and hooks, not by people. Shown last in `commands`. */
export const INTERNAL = new Set(["mcp", "hook", "transcript"]);

export const COMMAND_HELP = {
  log: {
    usage: 'infernoflow log "<one specific sentence>" [--type <type>] [options]',
    about: "Remember something the code can't tell the next session.",
    options: [
      ["--type <type>", "gotcha, decision, attempt, note, pattern, preference (default note)"],
      ["--result <r>", "for attempts: worked, failed, partial, unknown"],
      ["--file <path>", "the file it's about (ranks it, marks it stale when the file changes)"],
      ["--line <N>", "line in that file"],
      ["--tags <a,b>", "tags"],
      ["--detail <text>", "longer context, loaded only on demand"],
      ["--detail-file <path|->", "longer context from a file or stdin"],
      ["--show [N]", "print the last N entries instead (default 20)"],
      ["--json", "with --show: machine-readable output"],
      ["--auto, --quiet, --source <name>", "for hooks and scripts: silent, and skipped when there's no memory"],
    ],
    notes: ["Types:", ...ENTRY_TYPES.map(t => `  ${t.name.padEnd(11)}${t.desc}`)],
  },
  bookmark: {
    usage: 'infernoflow bookmark "<label>" [--note "<where we stopped, next step>"]',
    about: "Drop a named resume point. Without --note, the current Claude Code transcript is saved as its context (on this machine only).",
    options: [
      ["--note <text>", "explicit context instead of the transcript"],
      ["--detail-file <path|->", "context from a file or stdin"],
      ["--marker", "label only, no context"],
      ["--tags <a,b>", "tags"],
      ["--json", "machine-readable output"],
    ],
    notes: ["Also:", "  infernoflow bookmark list", "  infernoflow bookmark show <id|label>", "  infernoflow bookmark rm <id|label>"],
  },
  ask: {
    usage: 'infernoflow ask "<words>" [options]',
    about: "Search project memory. Gotchas come first.",
    options: [
      ["--file <path>", "rank entries about this file first"],
      ["--type <type>", "only this entry type (gotcha, decision, attempt, …)"],
      ["--limit, -n <N>", "number of results (default 15)"],
      ["--recent, -r", "newest entries instead of a search"],
      ["--json", "machine-readable output"],
    ],
  },
  resume: {
    usage: "infernoflow resume [--file <path>] [--json]",
    about: '"Where were we?" Last resume point, open dead ends, recent decisions, uncommitted work, and memory that arrived through git.',
    options: [
      ["--file <path>", "rank entries about this file first"],
      ["--json", "machine-readable output"],
    ],
  },
  status: {
    usage: "infernoflow status [--json]",
    about: "Quick health check: entries, gotchas, decisions, last activity.",
    options: [["--json", "machine-readable output"]],
  },
  switch: {
    usage: "infernoflow switch [options]",
    about: "Write a handoff for the next session to .ai-memory/handoff.md.",
    options: [
      ["--copy, -c", "also copy it to the clipboard"],
      ["--show, -s", "print the existing handoff without writing a new one"],
      ["--since <12h|3d|date>", "start the session window here"],
      ["--all", "include all memory, not just the current session"],
      ["--to <agent>", "name the agent the handoff is for"],
      ["--json", "machine-readable output"],
    ],
  },
  recap: {
    usage: "infernoflow recap [--brief] [--since <date>] [--json]",
    about: "End-of-session summary with a health score and changes that were never logged. Lists memory that arrived through git and marks it reviewed.",
    options: [
      ["--brief", "short version"],
      ["--since <date>", "summarize from this date"],
      ["--mark-reviewed", "mark arrived memory as reviewed even when not in a terminal"],
      ["--json", "machine-readable output"],
    ],
  },
  resolve: {
    usage: 'infernoflow resolve <id> [--note "fixed in <commit>"] [--undo]',
    about: "Mark an entry fixed or outdated. It stays searchable but is no longer injected into AI context.",
    options: [
      ["--note <text>", "why it's resolved"],
      ["--undo", "un-resolve it"],
    ],
  },
  forget: {
    usage: "infernoflow forget <id|prefix> | --last",
    about: "Delete one memory entry.",
    options: [["--last", "delete the newest entry"]],
  },
  prune: {
    usage: "infernoflow prune [--apply] [options]",
    about: "Archive old notes and attempts. Gotchas, decisions, patterns and bookmarks are never pruned. Dry run unless --apply.",
    options: [
      ["--apply", "do it (archived, not deleted)"],
      ["--max-age-days <N>", "age threshold (default from amp.json, 30)"],
      ["--types <a,b>", "which types to prune"],
      ["--no-archive", "delete instead of archiving (needs --yes)"],
      ["--json", "machine-readable output"],
    ],
  },
  curate: {
    usage: "infernoflow curate [--apply]",
    about: "Remove noise: old commit notes, duplicates, raw frustration prompts and machine text the old prompt hooks logged. Dry run unless --apply; removed entries are archived first.",
    options: [["--apply", "do it"]],
  },
  move: {
    usage: 'infernoflow move <id-prefix…> | --query "<text>" --to <project-dir> [--apply]',
    about: "Move misfiled entries to another project's memory. Dry run unless --apply.",
    options: [
      ["--query <text>", "select entries by text instead of id"],
      ["--to <dir>", "destination project"],
      ["--apply", "do it"],
    ],
  },
  refresh: {
    usage: "infernoflow refresh [options]",
    about: "Rebuild the managed memory block in CLAUDE.md, .cursorrules and .github/copilot-instructions.md.",
    options: [
      ["--targets <files|auto>", "which rule files get the block; others are stripped"],
      ["--max-memory <N>", "entries injected"],
      ["--max-commits <N>", "commits injected"],
      ["--max-entry-chars <N>", "per-entry length"],
      ["--protocol-style <compact|full|off>", "how much protocol text to inject"],
      ["--dry-run", "show what would change"],
    ],
  },
  setup: {
    usage: "infernoflow setup [--yes]",
    about: "Wire MCP and hooks for Claude Code, Cursor, VS Code Copilot and Claude Desktop in this project. Safe to re-run.",
    options: [["--yes, -y", "no prompts"]],
  },
  doctor: {
    usage: "infernoflow doctor [--e2e] [--fix] [--json]",
    about: "Diagnose the setup: Node, git, MCP configs and versions, hooks, secrets in memory.",
    options: [
      ["--e2e", "full self-test in a throw-away sandbox (your project is not touched)"],
      ["--fix", "apply the suggested fixes where possible"],
      ["--json", "machine-readable output"],
    ],
  },
  context: {
    usage: "infernoflow context",
    about: "AI-ready context for a task. Full mode (capability contracts); in memory mode it shows the resume view.",
    options: [],
  },
  check: {
    usage: "infernoflow check [--strict] [--json]",
    about: "Validate the capability contract (full mode). In memory mode it reports that and exits 0.",
    options: [
      ["--strict", "fail when there is no contract (for CI and git hooks)"],
      ["--json", "machine-readable output"],
    ],
  },
  "generate-skills": {
    usage: "infernoflow generate-skills [--force]",
    about: "Generate Cursor rules and skill files from the capability contract (full mode).",
    options: [["--force", "overwrite existing files"]],
  },
  "install-cursor-hooks": {
    usage: "infernoflow install-cursor-hooks [--force]",
    about: "Install the Cursor hooks (setup and init already do this).",
    options: [["--force", "overwrite existing hook files"]],
  },
  "install-vscode-copilot-hooks": {
    usage: "infernoflow install-vscode-copilot-hooks [--force]",
    about: "Install the VS Code Copilot agent hooks (preview).",
    options: [["--force", "overwrite existing hook files"]],
  },
  ai: {
    usage: "infernoflow ai [setup | status | test | clear]",
    about: "Optional AI provider (Anthropic, OpenAI, Google, Ollama) for a few enrichment features. Off by default.",
    options: [],
  },
  telemetry: {
    usage: "infernoflow telemetry [on | off | status]",
    about: "Opt-in anonymous usage telemetry. Off unless you turn it on; never sends code, paths or memory.",
    options: [],
  },
  sync: {
    usage: "infernoflow sync [status | set <folder> | clear | migrate]",
    about: "Keep your personal preferences in a synced folder (Dropbox, OneDrive…) so they follow you between machines.",
    options: [],
  },
  uninstall: {
    usage: "infernoflow uninstall [--dry-run] [--keep-memory] [--yes]",
    about: "Remove infernoflow's wiring from this project.",
    options: [
      ["--dry-run", "show what would be removed"],
      ["--keep-memory", "keep the memory files"],
      ["--yes, -y", "no confirmation prompt"],
      ["--json", "machine-readable output"],
    ],
  },
  amp: {
    usage: "infernoflow amp [status | migrate | validate | version]",
    about: "AI Memory Protocol utilities. The same read/write verbs as the MCP tools are available too (amp read | write | search | bookmark | handoff | health).",
    options: [],
  },
  mcp: {
    usage: "infernoflow mcp",
    about: "Run the MCP server over stdio. Your AI tool's MCP config starts this; you don't run it by hand.",
    options: [],
  },
  hook: {
    usage: "infernoflow hook session-start | session-end",
    about: "Entry point for Claude Code session hooks. Called by the hooks that setup installs, not by hand.",
    options: [],
  },
  transcript: {
    usage: "infernoflow transcript [--last <N>]",
    about: "Print this project's current Claude Code session transcript as plain text (secrets redacted). Used for bookmarks.",
    options: [["--last <N>", "number of transcript lines to read (default 400)"]],
  },
};

/** Render help for one command, or null when there is none. */
export function formatCommandHelp(name, { bold = (s) => s, gray = (s) => s, cyan = (s) => s } = {}) {
  const h = COMMAND_HELP[name];
  if (!h) return null;
  const lines = ["", `  ${bold("🔥 infernoflow " + name)}`, `  ${h.about}`, "", `  ${bold("Usage:")}`, `    ${cyan(h.usage)}`];
  if (h.options.length) {
    const w = Math.max(...h.options.map(([f]) => f.length)) + 2;
    lines.push("", `  ${bold("Options:")}`);
    for (const [flag, desc] of h.options) lines.push(`    ${flag.padEnd(w)}${gray(desc)}`);
  }
  lines.push(`    ${"--project <dir>".padEnd(Math.max(17, ...h.options.map(([f]) => f.length + 2)))}${gray("run against another project's memory")}`);
  if (h.notes && h.notes.length) lines.push("", ...h.notes.map(n => /^\S/.test(n) ? `  ${bold(n)}` : `  ${gray(n)}`));
  lines.push("");
  return lines.join("\n");
}
