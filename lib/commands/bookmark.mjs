/**
 * infernoflow bookmark — drop, list, recall, and remove named session bookmarks.
 *
 * A bookmark is a normal `note` entry tagged `bookmark`: the label is the `msg`
 * and any captured context is the Tier-2 `detail` sidecar (details/<id>.md).
 * It's the named, listable form of a session checkpoint — drop several in a
 * session ("before the SP refactor", "auth flow works") and jump back to any
 * of them, this session or the next (they surface in `infernoflow switch`).
 *
 * Bookmarks are never auto-pruned (see PROTECTED handling in amp/io.mjs).
 *
 * Usage:
 *   infernoflow bookmark "before the SP refactor"                    drop a marker
 *   infernoflow bookmark "auth works" --note "JWT in httpOnly cookie" with inline context
 *   infernoflow bookmark "big session" --detail-file snapshot.md      context from a file (or - for stdin)
 *   infernoflow bookmark list [--json]                               list all bookmarks
 *   infernoflow bookmark show <id|label> [--json]                    recall a bookmark's context
 *   infernoflow bookmark rm <id|label>                               delete a bookmark
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import { readEntries as ampRead, appendEntry as ampAppend, deleteEntry, readDetail } from "../amp/io.mjs";
import { harvestSnapshot } from "../transcript.mjs";

export const BOOKMARK_TAG = "bookmark";

const isBookmark = (e) => Array.isArray(e.tags) && e.tags.includes(BOOKMARK_TAG);

/** All bookmarks, ascending by ts (ampRead order). */
function listBookmarks(cwd) { return ampRead(cwd).filter(isBookmark); }

function fmtWhen(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function detectAgent() {
  if (process.env.CURSOR_SESSION)      return "cursor";
  if (process.env.COPILOT_SESSION)     return "copilot";
  if (process.env.CLAUDE_CODE_SESSION) return "claude";
  if (process.env.WINDSURF_SESSION)    return "windsurf";
  if (process.env.INFERNOFLOW_AGENT)   return process.env.INFERNOFLOW_AGENT;
  return "human";
}

const flagVal = (args, name) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : null; };

/**
 * Resolve a token to one bookmark: exact id, id prefix, then case-insensitive
 * label substring. On multiple label matches the newest wins (and we flag it).
 */
function resolveBookmark(bookmarks, token) {
  if (!token) return { error: "no-token" };
  const byId = bookmarks.filter(b => b.id && (b.id === token || b.id.startsWith(token)));
  if (byId.length === 1) return { bookmark: byId[0] };
  if (byId.length > 1)   return { error: "ambiguous", matches: byId };
  const t = token.toLowerCase();
  const byLabel = bookmarks.filter(b => (b.msg || b.summary || "").toLowerCase().includes(t));
  if (byLabel.length === 0) return { error: "none" };
  if (byLabel.length === 1) return { bookmark: byLabel[0] };
  return { bookmark: byLabel[byLabel.length - 1], ambiguousLabel: byLabel }; // newest wins
}

function printUsage() {
  console.log("\n  " + bold("🔖 infernoflow bookmark") + gray(" — named session resume points\n"));
  console.log(gray("  Drop:   ") + cyan('infernoflow bookmark "<label>"') + gray("   auto-captures the session transcript as context"));
  console.log(gray("          ") + gray('add --note "..." / --detail-file <path|->  for explicit context · --marker for label only'));
  console.log(gray("  List:   ") + cyan("infernoflow bookmark list"));
  console.log(gray("  Recall: ") + cyan("infernoflow bookmark show <id|label>"));
  console.log(gray("  Remove: ") + cyan("infernoflow bookmark rm <id|label>"));
  console.log();
}

export async function bookmarkCommand(args = []) {
  const cwd = process.cwd();
  // bin dispatches handlers as `bookmarkCommand(["bookmark", ...rest])` — drop
  // the leading command token so it isn't mistaken for a label / subcommand.
  const rest = args[0] === "bookmark" ? args.slice(1) : args;
  if (rest.length === 0) { printUsage(); return; }

  const sub = rest[0];
  if (sub === "list" || sub === "ls")                        return listCmd(cwd, rest.slice(1));
  if (sub === "show" || sub === "jump" || sub === "recall")  return showCmd(cwd, rest.slice(1));
  if (sub === "rm"   || sub === "remove" || sub === "delete") return rmCmd(cwd, rest.slice(1));
  return createCmd(cwd, rest); // default: create
}

function createCmd(cwd, args) {
  const noteArg    = flagVal(args, "--note");
  const detailFile = flagVal(args, "--detail-file");
  const tagsArg    = flagVal(args, "--tags");
  const consumed   = new Set([noteArg, detailFile, tagsArg].filter(Boolean));
  const label      = args.filter(a => !a.startsWith("--") && !consumed.has(a)).join(" ").trim();

  if (!label) { printUsage(); process.exit(1); }

  // Context resolution, in priority order:
  //   1. --detail-file <path|->   explicit body from a file / stdin
  //   2. --note "<text>"          explicit inline body
  //   3. (default) auto-capture   harvest the current session transcript
  //   4. --marker                 skip capture — just a labeled marker
  const markerOnly = args.includes("--marker");
  let detail = null;
  let captured = null; // "file" | "note" | "transcript"
  if (detailFile) {
    try { detail = detailFile === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(detailFile, "utf8"); captured = "file"; }
    catch (err) { console.error(red(`\n  ✘ Could not read --detail-file ${detailFile}: ${err.message}\n`)); process.exit(1); }
  } else if (noteArg) {
    detail = noteArg; captured = "note";
  } else if (!markerOnly) {
    // The "save everything here" path: the session is already on disk — grab it.
    try { detail = harvestSnapshot(cwd); if (detail) captured = "transcript"; } catch { /* best-effort */ }
  }

  const ampDir = path.join(cwd, ".ai-memory"), legacyDir = path.join(cwd, "inferno");
  if (!fs.existsSync(ampDir) && !fs.existsSync(legacyDir)) {
    console.error(red("\n  ✘ no .ai-memory/ or inferno/ — run: infernoflow init\n"));
    process.exit(1);
  }

  const extra = tagsArg ? tagsArg.split(",").map(t => t.trim()).filter(Boolean) : [];
  const tags  = [BOOKMARK_TAG, ...extra.filter(t => t !== BOOKMARK_TAG)];

  const written = ampAppend(cwd, {
    ts: new Date().toISOString(),
    agent: detectAgent(),
    type: "note",
    summary: label,
    tags,
    ...(detail && detail.trim() ? { detail } : {}),
  });

  console.log();
  console.log("  " + green("🔖 Bookmark saved: ") + bold(label) + gray(`  ${written.id}`));
  if (detail && detail.trim()) {
    const how = captured === "transcript" ? "auto-captured session transcript" : "captured context";
    console.log("  " + gray(`${how} (${detail.length} chars) — recall with `) + cyan(`infernoflow bookmark show ${written.id.slice(0, 12)}`));
  } else {
    const why = markerOnly ? "marker only (--marker)" : "marker only — no session transcript found here";
    console.log("  " + gray(`${why} — recall by label, or add context with --note / --detail-file`));
  }
  console.log();
}

function listCmd(cwd, args) {
  const bms = listBookmarks(cwd);
  if (args.includes("--json")) {
    console.log(JSON.stringify(bms.map(b => ({ id: b.id, label: b.msg || b.summary, ts: b.ts, hasContext: !!b.detailRef })), null, 2));
    return;
  }
  console.log("\n  " + bold("🔖 infernoflow bookmarks"));
  console.log("  " + "─".repeat(50));
  if (bms.length === 0) {
    console.log(gray("\n  No bookmarks yet. Drop one: ") + cyan('infernoflow bookmark "<label>"') + "\n");
    return;
  }
  [...bms].reverse().forEach((b, i) => {  // newest first for display
    const ctx = b.detailRef ? green(" ●") : gray(" ○");
    console.log(`  ${gray(String(i + 1).padStart(3))}${ctx}  ${gray(fmtWhen(b.ts))}  ${b.msg || b.summary}  ${gray(b.id.slice(0, 12))}`);
  });
  console.log(gray("\n  ● has saved context · ○ marker only — recall with: ") + cyan("infernoflow bookmark show <id|label>") + "\n");
}

function showCmd(cwd, args) {
  const json  = args.includes("--json");
  const token = args.find(a => a && !a.startsWith("-"));
  const bms   = listBookmarks(cwd);
  if (bms.length === 0) { console.error(yellow("\n  No bookmarks yet.\n")); process.exit(1); }

  const res = resolveBookmark(bms, token);
  if (res.error === "no-token")  { console.error(gray("\n  Usage: ") + cyan("infernoflow bookmark show <id|label>") + "\n"); process.exit(1); }
  if (res.error === "none")      { console.error(red(`\n  No bookmark matches: ${token}\n`)); process.exit(1); }
  if (res.error === "ambiguous") {
    console.error(yellow(`\n  Ambiguous — ${res.matches.length} bookmarks match "${token}":`));
    for (const m of res.matches.slice(0, 8)) console.error(gray(`    ${m.id.slice(0, 14)}  `) + (m.msg || m.summary || ""));
    console.error(""); process.exit(1);
  }

  const b = res.bookmark;
  const detail = readDetail(cwd, b);
  if (json) { console.log(JSON.stringify({ id: b.id, label: b.msg || b.summary, ts: b.ts, detail: detail || null }, null, 2)); return; }
  console.log();
  console.log("  " + bold("🔖 " + (b.msg || b.summary)));
  console.log("  " + gray(`${fmtWhen(b.ts)} · ${b.id}`));
  if (res.ambiguousLabel) console.log("  " + gray(`(newest of ${res.ambiguousLabel.length} matching "${token}")`));
  console.log("  " + "─".repeat(50));
  if (detail && detail.trim()) { console.log(); console.log(detail.trim()); console.log(); }
  else console.log(gray("\n  (marker only — no context was captured for this bookmark)\n"));
}

function rmCmd(cwd, args) {
  const token = args.find(a => a && !a.startsWith("-"));
  const bms   = listBookmarks(cwd);
  if (bms.length === 0) { console.error(yellow("\n  No bookmarks to remove.\n")); process.exit(1); }

  const res = resolveBookmark(bms, token);
  if (res.error) {
    if (res.error === "ambiguous") {
      console.error(yellow("\n  Ambiguous — be specific:"));
      for (const m of res.matches.slice(0, 8)) console.error(gray(`    ${m.id.slice(0, 14)}  `) + (m.msg || m.summary || ""));
      console.error("");
    } else if (res.error === "none") { console.error(red(`\n  No bookmark matches: ${token}\n`)); }
    else { console.error(gray("\n  Usage: ") + cyan("infernoflow bookmark rm <id|label>") + "\n"); }
    process.exit(1);
  }

  const b = res.bookmark;
  const { removed } = deleteEntry(cwd, b.id);
  console.log();
  console.log(removed > 0
    ? "  " + green("✔") + " Removed bookmark " + bold(b.msg || b.summary) + gray(`  ${b.id}`)
    : "  " + yellow("Nothing removed."));
  console.log();
}
