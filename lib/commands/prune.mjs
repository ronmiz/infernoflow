/**
 * infernoflow prune — archive stale memory entries out of the active store.
 *
 * Notes / attempts / detections older than the configured threshold (default
 * 30 days) get moved to `.ai-memory/archive/sessions-YYYY-MM.jsonl`, where:
 *   - They're invisible to readEntries (the merged-read sources don't include
 *     archive/) → invisible to rule-file injection and the sidebar.
 *   - They're still on disk — restorable by moving the line back, or by
 *     reading the archive manually with `cat`.
 *
 * Gotchas, decisions, and patterns are NEVER auto-pruned regardless of age.
 * They're the long-term knowledge you logged infernoflow FOR.
 *
 * Usage:
 *   infernoflow prune                          Dry-run — show what would archive
 *   infernoflow prune --apply                  Actually archive
 *   infernoflow prune --max-age-days 14        Override the age threshold
 *   infernoflow prune --types note,attempt     Override archivable types
 *   infernoflow prune --no-archive --apply     Hard delete (no archive) — DANGER
 *   infernoflow prune --json                   Machine-readable output
 */

import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import { findProjectRoot } from "../projectRoot.mjs";
import { pruneEntries, resolveRotationSettings, readConfig } from "../amp/io.mjs";

function getFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}
function getNumFlag(args, name) {
  const v = getFlag(args, name);
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function pruneCommand(rawArgs = []) {
  // bin always passes ["prune", ...rest]; strip the command token.
  const args = rawArgs[0] === "prune" ? rawArgs.slice(1) : rawArgs;
  const apply       = args.includes("--apply") || args.includes("-y");
  const jsonOut     = args.includes("--json");
  const noArchive   = args.includes("--no-archive");
  const yes         = args.includes("--yes");
  const maxAgeDays  = getNumFlag(args, "--max-age-days");
  const typesFlag   = getFlag(args, "--types");
  const types       = typesFlag ? typesFlag.split(",").map(s => s.trim()).filter(Boolean) : undefined;

  const cwd = findProjectRoot(process.cwd());

  // Hard-delete is a foot-gun — require explicit confirmation even with --apply.
  if (noArchive && apply && !yes) {
    if (jsonOut) console.log(JSON.stringify({ ok: false, error: "no-archive requires --yes" }, null, 2));
    else console.error(red("\n  ✘ --no-archive deletes entries permanently. Add --yes to confirm.\n"));
    process.exit(1);
  }

  const result = pruneEntries(cwd, {
    dryRun:     !apply,
    maxAgeDays,
    types,
    archive:    !noArchive,
  });

  if (jsonOut) {
    console.log(JSON.stringify({ ok: true, projectRoot: cwd, ...result }, null, 2));
    return;
  }

  const settings = resolveRotationSettings(readConfig(cwd));
  const effectiveAge = Number.isFinite(maxAgeDays) ? maxAgeDays : settings.archiveAfterDays;

  console.log("\n  " + bold("🔥 infernoflow prune") + (apply ? "" : gray("  — dry run")));
  console.log("  " + "─".repeat(50));
  console.log("  " + gray("threshold:    ") + cyan(`${effectiveAge} days`));
  console.log("  " + gray("archivable:   ") + cyan((types || settings.archivableTypes).join(", ")));
  console.log("  " + gray("protected:    ") + cyan("gotcha, decision, pattern") + gray(" (never auto-pruned)"));
  console.log("  " + gray("destination:  ") + cyan(noArchive ? "(deleted — no archive)" : ".ai-memory/archive/sessions-YYYY-MM.jsonl"));
  console.log();
  console.log("  " + gray("scanned:  ") + result.scanned);
  console.log("  " + gray("kept:     ") + green(result.kept));
  console.log("  " + gray(apply ? "archived: " : "would archive: ") + yellow(result.archived));
  const byTypeEntries = Object.entries(result.byType);
  if (byTypeEntries.length) {
    console.log("  " + gray("  by type:  ") + byTypeEntries.map(([t, n]) => `${t}=${n}`).join(", "));
  }
  if (result.files.length) {
    console.log("  " + gray(apply ? "rewrote files:" : "would rewrite:"));
    for (const f of result.files) console.log("    " + gray(f));
  }
  console.log();
  if (!apply) {
    if (result.archived === 0) {
      console.log("  " + green("nothing to prune — store is already clean."));
    } else {
      console.log("  " + bold("Run with ") + cyan("--apply") + bold(" to actually archive."));
    }
    console.log();
  } else {
    console.log("  " + green("✔ done") + gray(" — readEntries / sidebar / injection no longer see archived entries."));
    console.log();
  }
}
