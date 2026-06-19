/**
 * infernoflow forget <id> — delete a single memory entry by id (or unique prefix).
 *
 * Closes the reviewer gap: the only way to remove a bad entry used to be
 * hand-editing .ai-memory/*.jsonl. `forget` resolves a full AMP id or a unique
 * prefix, confirms the match, and hard-deletes it from every memory file
 * (entries are mirrored across branch + legacy sessions.jsonl).
 *
 * Usage:
 *   infernoflow forget amp_01KS2R30FWZWFM9BXJKHZWVP7S   full id
 *   infernoflow forget 01KS2R30                          unique prefix
 *   infernoflow forget --last                            the most recent entry
 */

import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import { readEntries as ampRead, deleteEntry } from "../amp/io.mjs";

export async function forgetCommand(args = []) {
  const cwd = process.cwd();
  // bin invokes handlers as `forgetCommand(["forget", ...rest])` — drop the
  // leading command token so it isn't mistaken for the id to forget.
  const rest = args[0] === "forget" ? args.slice(1) : args;
  const wantLast = rest.includes("--last");
  const token = rest.find(a => a && !a.startsWith("-"));

  if (!wantLast && !token) {
    console.error(gray("\n  Usage: ") + cyan("infernoflow forget <id|prefix>") + gray("  or  ") + cyan("infernoflow forget --last") + "\n");
    process.exit(1);
  }

  const entries = ampRead(cwd);
  if (entries.length === 0) {
    console.error(yellow("\n  No memory entries to forget.\n"));
    process.exit(1);
  }

  let target;
  if (wantLast) {
    // ampRead returns ascending by ts, so the last element is most recent.
    target = entries[entries.length - 1];
  } else {
    const matches = entries.filter(e => e.id && (e.id === token || e.id.startsWith(token)));
    if (matches.length === 0) {
      console.error(red(`\n  No entry matches id/prefix: ${token}\n`));
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(yellow(`\n  Ambiguous — ${matches.length} entries match "${token}". Be more specific:`));
      for (const m of matches.slice(0, 8)) {
        console.error(gray(`    ${m.id}  `) + (m.msg || m.summary || "").slice(0, 60));
      }
      console.error("");
      process.exit(1);
    }
    target = matches[0];
  }

  if (!target || !target.id) {
    console.error(red("\n  That entry has no id (very old format) — edit .ai-memory/sessions.jsonl by hand.\n"));
    process.exit(1);
  }

  const { removed, files } = deleteEntry(cwd, target.id);
  console.log();
  if (removed > 0) {
    console.log("  " + green("✔") + " Forgot " + bold(target.type || "entry") + gray(` ${target.id}`));
    console.log("  " + gray((target.msg || target.summary || "").slice(0, 80)));
    console.log("  " + gray(`Removed from ${files.length} file${files.length === 1 ? "" : "s"}.`));
  } else {
    console.log("  " + yellow("Nothing removed — the id wasn't found on disk."));
  }
  console.log();
}
