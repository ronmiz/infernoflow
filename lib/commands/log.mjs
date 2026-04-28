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

const INFERNO_DIR   = "inferno";
const SESSIONS_FILE = path.join(INFERNO_DIR, "sessions.jsonl");

const VALID_TYPES   = ["note","attempt","decision","gotcha","preference","theme","handoff","error"];
const VALID_RESULTS = ["worked","failed","partial","unknown"];

function readEntries() {
  if (!fs.existsSync(SESSIONS_FILE)) return [];
  return fs.readFileSync(SESSIONS_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function appendEntry(entry, { auto = false, quiet = false } = {}) {
  if (!fs.existsSync(INFERNO_DIR)) {
    if (auto) return false; // silently skip — hook running in non-inferno project
    if (!quiet) console.error(red("  ✘ inferno/ not found — run: infernoflow init\n"));
    process.exit(1);
  }
  fs.appendFileSync(SESSIONS_FILE, JSON.stringify(entry) + "\n", "utf8");
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
    if (!fs.existsSync(SESSIONS_FILE)) {
      console.log(gray("  Nothing to clear.\n"));
      return;
    }
    const archive = SESSIONS_FILE.replace(".jsonl", `-archive-${Date.now()}.jsonl`);
    fs.renameSync(SESSIONS_FILE, archive);
    console.log(green(`  ✔ Session log archived → ${path.basename(archive)}\n`));
    return;
  }

  // ── Append mode ─────────────────────────────────────────────────────────────
  // Collect the message — everything that's not a flag or a flag value
  const flagValues = new Set([
    flag("--type",""), flag("--result",""), flag("--agent",""), flag("--source","")
  ].filter(Boolean));
  const messageTokens = args.filter(a => !a.startsWith("--") && !flagValues.has(a));
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

  const type   = flag("--type",   "note");
  const result = flag("--result", null);
  const agent  = flag("--agent",  detectAgent());

  if (!VALID_TYPES.includes(type)) {
    if (!quietFlag) console.error(red(`  ✘ Invalid type: ${type}. Valid: ${VALID_TYPES.join(", ")}\n`));
    process.exit(1);
  }
  if (result && !VALID_RESULTS.includes(result)) {
    if (!quietFlag) console.error(red(`  ✘ Invalid result: ${result}. Valid: ${VALID_RESULTS.join(", ")}\n`));
    process.exit(1);
  }

  const entry = {
    ts:      new Date().toISOString(),
    agent,
    type,
    summary,
    ...(result  ? { result }        : {}),
    ...(source  ? { source }        : {}),
    ...(autoFlag ? { auto: true }   : {}),
  };

  const written = appendEntry(entry, { auto: autoFlag, quiet: quietFlag });
  if (!written) return; // auto mode, no inferno/ — skip silently

  if (!quietFlag) {
    const typeLabel   = type !== "note" ? cyan(` [${type}]`) : "";
    const resultLabel = result ? gray(` → ${result}`) : "";
    const sourceLabel = source ? gray(` (via ${source})`) : "";
    console.log(green(`  ✔ Logged${typeLabel}${resultLabel}${sourceLabel}: `) + summary + "\n");
  }
}
