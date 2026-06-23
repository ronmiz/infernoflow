/**
 * infernoflow log
 *
 * Appends a human or agent entry to inferno/sessions.jsonl —
 * the append-only memory file that captures what AI can't infer from code:
 * failed attempts, decisions, gotchas, preferences, theme changes.
 *
 * Usage:
 *   infernoflow log "tried streaming upload, server rejected chunked transfer"
 *   infernoflow log "API expects multipart/form-data" --type gotcha
 *   infernoflow log "switched primary color to #f97316" --type theme
 *   infernoflow log "user prefers inline styles" --type preference
 *   infernoflow log "axios over fetch because of progress events" --type decision --result worked
 *   infernoflow log --show          Print last 20 entries
 *   infernoflow log --show 5        Print last 5 entries
 *   infernoflow log --clear         Archive and clear the log
 *   infernoflow log --json          Print entries as JSON array
 *
 * Auto-capture flags (for git hooks / automation):
 *   infernoflow log "..." --auto              Mark as auto-captured; silent exit if no inferno/
 *   infernoflow log "..." --quiet             Suppress all output
 *   infernoflow log "..." --source git-hook   Tag the origin of this log entry
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import * as os   from "node:os";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import { ampPaths, appendEntry as ampAppend, readEntries as ampRead, readConfig, resolveRotationSettings, pruneEntries } from "../amp/io.mjs";
import { refreshRuleFilesFromMemory } from "../ruleFiles.mjs";

// Resolved per-call so AMP layer picks the right folder (.ai-memory/ vs inferno/).
function resolvedPaths() { return ampPaths(process.cwd()); }

// NOTE: An older "autoUpdateContextFiles" function lived here through v0.43.x.
// It wrote a SECOND managed block (`<!-- AMP:START -->`) to CLAUDE.md /
// .cursorrules / copilot-instructions.md after every log call, in parallel
// with `refreshRuleFilesFromMemory` (which uses `<!-- infernoflow:start -->`).
// The two writers raced and produced duplicate blocks in user files. It was
// removed in v0.44 — `refreshRuleFilesFromMemory` is the single canonical
// writer, invoked at: (1) init, (2) MCP server boot, (3) `infernoflow log
// --refresh-rules` opt-in, (4) `infernoflow refresh`. See ruleFiles.mjs and
// templates/cursor/inferno-mcp-server.mjs for the boot-time refresh.

const VALID_TYPES   = [
  // AMP-spec types (docs/protocol/PROTOCOL.md §3) — must accept all of these
  // so the MCP amp_write tool can pass them through without rejection.
  "gotcha", "decision", "attempt", "note", "detection", "pattern",
  // Legacy infernoflow-specific types — kept for back-compat. The AMP io
  // layer round-trips these via meta.subtype, so on-disk shape stays AMP-valid.
  "preference", "theme", "handoff", "error",
];
const VALID_RESULTS = ["worked","failed","partial","unknown"];

function readEntries() {
  return ampRead(process.cwd());
}

function appendEntry(entry, { auto = false, quiet = false } = {}) {
  // AMP layer auto-creates .ai-memory/ on write; we still bail in --auto mode
  // when there's no project context yet (no .ai-memory and no inferno/).
  const cwd = process.cwd();
  const ampDir   = path.join(cwd, ".ai-memory");
  const legacyDir = path.join(cwd, "inferno");
  if (auto && !fs.existsSync(ampDir) && !fs.existsSync(legacyDir)) {
    return false; // hook running in non-infernoflow project
  }
  if (!fs.existsSync(ampDir) && !fs.existsSync(legacyDir)) {
    if (!quiet) console.error(red("  ✘ no .ai-memory/ or inferno/ — run: infernoflow init\n"));
    process.exit(1);
  }
  ampAppend(cwd, entry);
  // Auto-rotate (opt-in via config.rotation.auto). Silently archives stale
  // notes/attempts/detections older than the configured threshold so the
  // injected rule-file block stays high-signal. Runs BEFORE refresh so the
  // regenerated rule files reflect the post-prune state. Never fatal —
  // worst case the user runs `infernoflow prune` manually.
  try {
    const rotation = resolveRotationSettings(readConfig(cwd));
    if (rotation.auto) pruneEntries(cwd);
  } catch { /* swallow — log success must not depend on prune */ }
  // Refresh AI rule files so the new entry is visible to the next AI session
  // *without* needing our VS Code extension running. Cursor / Claude Code /
  // Copilot read .cursorrules / CLAUDE.md / .github/copilot-instructions.md
  // at chat start — if those files don't include this new entry, the AI
  // never sees it. Non-fatal: if the rebuild errors (e.g. permissions on a
  // CI box), the entry still got written to sessions.jsonl, and the user
  // can run `infernoflow context` to rebuild manually.
  try { refreshRuleFilesFromMemory(cwd); } catch { /* swallow */ }
  return true;
}

function detectAgent() {
  // Try to detect which AI agent is running this
  if (process.env.CURSOR_SESSION)        return "cursor";
  if (process.env.COPILOT_SESSION)       return "copilot";
  if (process.env.CLAUDE_CODE_SESSION)   return "claude";
  if (process.env.WINDSURF_SESSION)      return "windsurf";
  if (process.env.INFERNOFLOW_AGENT)     return process.env.INFERNOFLOW_AGENT;
  return "human";
}

function formatEntry(e, i) {
  const ts    = new Date(e.ts).toLocaleString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
  const type  = e.type || "note";
  const color = type === "gotcha"     ? "\x1b[33m" // yellow
              : type === "decision"   ? "\x1b[36m" // cyan
              : type === "theme"      ? "\x1b[35m" // magenta
              : type === "preference" ? "\x1b[34m" // blue
              : type === "attempt"    ? "\x1b[90m" // dark gray
              : type === "error"      ? "\x1b[31m" // red
              :                        "\x1b[0m";
  const reset  = "\x1b[0m";
  const result = e.result ? ` [${e.result}]` : "";
  const agent  = e.agent && e.agent !== "human" ? gray(` (${e.agent})`) : "";
  return `  ${gray(String(i+1).padStart(3))}  ${gray(ts)}  ${color}${type}${reset}${result}  ${e.summary}${agent}`;
}

export async function logCommand(args) {
  const has  = (f) => args.includes(f);
  const flag = (f, def) => { const i = args.indexOf(f); return i !== -1 && args[i+1] ? args[i+1] : def; };

  const showFlag  = has("--show");
  const clearFlag = has("--clear");
  const jsonFlag  = has("--json");
  const autoFlag  = has("--auto");   // auto-captured; silent exit if no inferno/
  const quietFlag = has("--quiet");  // suppress all console output
  const source    = flag("--source", null); // origin tag, e.g. "git-hook"

  // ── Show mode ───────────────────────────────────────────────────────────────
  if (showFlag || jsonFlag) {
    const entries = readEntries();
    const countArg = args[args.indexOf("--show") + 1];
    const count = countArg && /^\d+$/.test(countArg) ? parseInt(countArg) : 20;
    const recent = entries.slice(-count);

    if (jsonFlag) {
      console.log(JSON.stringify(recent, null, 2));
      return;
    }

    console.log("\n  " + bold("🔥 infernoflow — session memory"));
    console.log("  " + "─".repeat(50));
    if (!recent.length) {
      console.log(gray("\n  No entries yet. Start logging with: infernoflow log \"<what happened>\"\n"));
      return;
    }
    console.log(gray(`  Showing last ${recent.length} of ${entries.length} entries\n`));
    recent.forEach((e, i) => console.log(formatEntry(e, entries.length - recent.length + i)));
    console.log();
    return;
  }

  // ── Clear mode ──────────────────────────────────────────────────────────────
  if (clearFlag) {
    const { sessions } = resolvedPaths();
    if (!fs.existsSync(sessions)) {
      console.log(gray("  Nothing to clear.\n"));
      return;
    }
    const archive = sessions.replace(".jsonl", `-archive-${Date.now()}.jsonl`);
    fs.renameSync(sessions, archive);
    console.log(green(`  ✔ Session log archived → ${path.basename(archive)}\n`));
    return;
  }

  // ── Append mode ─────────────────────────────────────────────────────────────
  // Collect the message — everything that's not a flag or a flag value
  const flagValues = new Set([
    flag("--type",""), flag("--result",""), flag("--agent",""), flag("--source",""),
    flag("--file",""), flag("--line",""), flag("--tags",""),
  ].filter(Boolean));
  const messageTokens = args.slice(1).filter(a => !a.startsWith("--") && !flagValues.has(a));
  const summary = messageTokens.join(" ").trim();

  if (!summary) {
    console.log("\n  " + bold("🔥 infernoflow log") + " — append to session memory\n");
    console.log(gray("  Usage:"));
    console.log(gray('    infernoflow log "what happened"'));
    console.log(gray('    infernoflow log "tried X, failed because Y" --type attempt --result failed'));
    console.log(gray('    infernoflow log "always use multipart/form-data" --type gotcha'));
    console.log(gray('    infernoflow log "switched to dark mode" --type theme'));
    console.log(gray('    infernoflow log --show          Print last 20 entries'));
    console.log(gray('    infernoflow log --json          Print as JSON'));
    console.log();
    console.log(gray("  Types: note · attempt · decision · gotcha · preference · theme · handoff · error"));
    console.log(gray("  Results: worked · failed · partial · unknown"));
    console.log(gray("  Auto-capture: --auto (silent skip if no inferno/) · --quiet · --source <name>\n"));
    return;
  }

  const type    = flag("--type",   "note");
  const result  = flag("--result", null);
  const agent   = flag("--agent",  detectAgent());
  const fileArg = flag("--file",   null);
  const lineArg = flag("--line",   null);
  const tagsArg = flag("--tags",   null);

  if (!VALID_TYPES.includes(type)) {
    if (!quietFlag) console.error(red(`  ✘ Invalid type: ${type}. Valid: ${VALID_TYPES.join(", ")}\n`));
    process.exit(1);
  }
  if (result && !VALID_RESULTS.includes(result)) {
    if (!quietFlag) console.error(red(`  ✘ Invalid result: ${result}. Valid: ${VALID_RESULTS.join(", ")}\n`));
    process.exit(1);
  }

  const line = lineArg && /^\d+$/.test(lineArg) ? parseInt(lineArg, 10) : null;
  const tags = tagsArg ? tagsArg.split(",").map(t => t.trim()).filter(Boolean) : null;

  const entry = {
    ts:      new Date().toISOString(),
    agent,
    type,
    summary,
    ...(result   ? { result }       : {}),
    ...(source   ? { source }       : {}),
    ...(fileArg  ? { file: fileArg }: {}),
    ...(line     ? { line }         : {}),
    ...(tags && tags.length ? { tags } : {}),
    ...(autoFlag ? { auto: true }   : {}),
  };

  const written = appendEntry(entry, { auto: autoFlag, quiet: quietFlag });
  if (!written) return; // auto mode, no inferno/ — skip silently

  // Clean-tree policy: do NOT regenerate CLAUDE.md / .cursorrules on every
  // log entry. Doing so dirtied tracked files dozens of times per session
  // and blocked branch switching. Rule files now refresh only at MCP-server
  // startup (and via explicit `infernoflow refresh`). Pass --refresh-rules
  // to opt back in for one-off CLI use.
  if (args.includes("--refresh-rules")) {
    try { refreshRuleFilesFromMemory(process.cwd()); } catch { /* non-fatal */ }
  }

  // Cloud push removed in v0.43.6 — memory is local-only now.

  if (!quietFlag) {
    const typeLabel   = type !== "note" ? cyan(` [${type}]`) : "";
    const resultLabel = result ? gray(` → ${result}`) : "";
    const sourceLabel = source ? gray(` (via ${source})`) : "";
    console.log(green(`  ✔ Logged${typeLabel}${resultLabel}${sourceLabel}: `) + summary + "\n");
  }
}
