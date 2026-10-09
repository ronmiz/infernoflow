/**
 * `infernoflow curate [--apply]` — clear out noise (D14, 0.46.0).
 *
 * Finds, and with --apply removes:
 *   - commit-subject notes written by the old git post-commit hook (git has them)
 *   - exact duplicates (same type + message; the oldest copy is kept)
 *   - raw "User frustration:" prompts from the prompt hook older than 14 days
 *   - (0.46.3) prompt-hook entries logged from text the user didn't type —
 *     subagent hand-backs, pasted logs, "No changed files…" — at any age
 * Removed entries are archived to ~/.infernoflow/backups/ first.
 * Dry run by default.
 */
import * as fs   from "node:fs";
import * as path from "node:path";
import { readEntries, deleteEntry, toAmp, projectSlug } from "../amp/io.mjs";
import { isNoise } from "../memoryView.mjs";
import { humanText } from "../frustration.mjs";
import { findProjectRoot } from "../projectRoot.mjs";
import { infernoflowHome } from "../personalConfig.mjs";
import { bold, gray, green, yellow } from "../ui/output.mjs";

const tsOf = (e) => (typeof e.ts === "number" ? e.ts : Date.parse(e.ts || 0)) || 0;

const HOOK_PREFIX = /^(?:User frustration:|Auto-trigger — user signalled trouble:)\s*/;

/** A prompt-hook entry whose stored text isn't a person signalling trouble (e.g. "<agent-message …"). */
export function isMisfiredHookEntry(e) {
  const msg = String(e.summary || e.msg || "");
  if (!HOOK_PREFIX.test(msg)) return false;
  if (!(e.source === "hook" || e.source === "cursor-trigger")) return false;
  const rest = msg.replace(HOOK_PREFIX, "");
  // Only flag what certainly wasn't typed: machine text ("<agent-message …",
  // "[Subagent hand-back …") or infernoflow's own tool output. The old hooks
  // matched more phrases than today's (e.g. "this is broken", "why!!"), so
  // "doesn't look like frustration now" is not evidence — those stay.
  // Machine text = the prefixes humanText() rejects outright, never what its
  // line filters strip (a typed "Error: it's not working" stays).
  if (/^\s*(?:<[a-z]|\[(?:Subagent hand-back|Request interrupted)|Caveat: The messages below were generated)/i.test(rest) && !humanText(rest)) return true;
  return /^No changed files detected\b/i.test(rest.trim());
}

export function curateCandidates(cwd) {
  const all = readEntries(cwd).sort((a, b) => tsOf(a) - tsOf(b));
  const out = { commitNotes: [], duplicates: [], misfiredHook: [], oldFrustration: [] };
  const seen = new Map();
  const cutoff = Date.now() - 14 * 86400_000;
  for (const e of all) {
    if (Array.isArray(e.tags) && e.tags.includes("bookmark")) continue;   // bookmarks are never curated
    if (isNoise(e)) { out.commitNotes.push(e); continue; }
    if (isMisfiredHookEntry(e)) { out.misfiredHook.push(e); continue; }
    if (e.source === "hook" && /^User frustration:/.test(e.summary || "") && tsOf(e) < cutoff) { out.oldFrustration.push(e); continue; }
    const key = `${e.type}\u0000${e.file || ""}\u0000${String(e.summary || "").trim().toLowerCase()}`;
    if (seen.has(key)) out.duplicates.push(e); else seen.set(key, e);
  }
  return out;
}

export async function curateCommand(args = []) {
  const cwd = process.cwd();
  const apply = args.includes("--apply");
  const c = curateCandidates(cwd);
  const groups = [["commit notes (duplicate git history)", c.commitNotes], ["duplicates", c.duplicates], ["prompt-hook entries from text the user didn't type", c.misfiredHook], ["raw frustration prompts > 14 days", c.oldFrustration]];
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  console.log("\n  " + bold("🔥 infernoflow curate"));
  for (const [label, list] of groups) {
    console.log("  " + `${String(list.length).padStart(4)}  ${label}`);
    for (const e of list.slice(0, 3)) console.log(gray("        " + String(e.summary || "").slice(0, 90)));
  }
  if (!total) { console.log(gray("\n  Nothing to curate.\n")); return; }
  if (!apply) { console.log("\n  " + yellow("Dry run.") + gray(" Add --apply to remove them (archived first).\n")); return; }

  const root = findProjectRoot(cwd);
  const dir = path.join(infernoflowHome(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, `${projectSlug(root)}-curated-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const all = groups.flatMap(([, l]) => l);
  fs.writeFileSync(archive, all.map(e => JSON.stringify(toAmp(e))).join("\n") + "\n", "utf8");
  for (const e of all) deleteEntry(cwd, e.id);
  console.log("\n  " + green(`✔ removed ${all.length}`) + gray(` — archived to ${archive}\n`));
}
