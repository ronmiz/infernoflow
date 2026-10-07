/**
 * `infernoflow move` — move misfiled entries to another project's memory (D11, 0.46.0).
 *
 *   infernoflow move <id-prefix> [<id-prefix> …] --to <project-dir> [--apply]
 *   infernoflow move --query "<text>" --to <project-dir> [--apply]
 *
 * Dry run by default: prints what would move. With --apply, each entry is
 * written to the target project (same id, timestamp, author and detail body —
 * local-only bodies stay local) and then removed from this project, including
 * its mirror copies and detail body. Entries already in the target are only
 * removed from here.
 */
import * as fs   from "node:fs";
import * as path from "node:path";
import { readEntries, readDetail, appendEntry, deleteEntry } from "../amp/io.mjs";
import { findProjectRoot } from "../projectRoot.mjs";
import { bold, cyan, gray, green, red, yellow } from "../ui/output.mjs";

export async function moveCommand(args = []) {
  const cwd = process.cwd();
  const flag = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const toArg = flag("--to");
  const query = flag("--query");
  const apply = args.includes("--apply");
  const consumed = new Set([toArg, query].filter(Boolean));
  const prefixes = args.slice(1).filter(a => !a.startsWith("--") && !consumed.has(a));

  if (!toArg || (!query && !prefixes.length)) {
    console.error(red("\n  ✘ usage: infernoflow move <id-prefix…> | --query \"text\"  --to <project-dir> [--apply]\n"));
    process.exitCode = 1; return;
  }
  let target;
  try { target = findProjectRoot(path.resolve(toArg)); } catch { target = path.resolve(toArg); }
  const source = findProjectRoot(cwd);
  if (!fs.existsSync(path.join(target, ".ai-memory"))) {
    console.error(red(`\n  ✘ ${target} has no .ai-memory/ — run infernoflow init there first\n`)); process.exitCode = 1; return;
  }
  if (path.resolve(target) === path.resolve(source)) {
    console.error(red("\n  ✘ --to is this project\n")); process.exitCode = 1; return;
  }

  const all = readEntries(cwd);
  const q = query ? query.toLowerCase() : null;
  const picked = all.filter(e => e.id && (
    prefixes.some(p => p.length >= 6 && e.id.startsWith(p)) ||
    (q && `${e.summary || ""} ${e.file || ""} ${(e.tags || []).join(" ")}`.toLowerCase().includes(q))
  ));
  if (!picked.length) { console.log(gray("\n  Nothing matched.\n")); return; }

  const targetIds = new Set(readEntries(target).map(e => e.id));
  console.log("\n  " + bold(`${apply ? "Moving" : "Would move"} ${picked.length} entr${picked.length === 1 ? "y" : "ies"}`) + gray(` → ${target}`));
  for (const e of picked) console.log("  " + cyan(e.id.slice(0, 14)) + " " + (e.type || "note").padEnd(9) + " " + String(e.summary || "").slice(0, 80) + (targetIds.has(e.id) ? gray("  (already there)") : ""));

  if (!apply) { console.log("\n  " + yellow("Dry run.") + gray(" Add --apply to move them.\n")); return; }

  let moved = 0;
  for (const e of picked) {
    if (!targetIds.has(e.id)) {
      let detail = null;
      try { detail = readDetail(cwd, e); } catch { /* none */ }
      const local = e.detailRef === "details.local.jsonl";
      const { detailRef, ...rest } = e;      // the body is re-stored in the target
      appendEntry(target, {
        ...rest,
        id: e.id,
        ts: e.ts,
        // The source repo's commit means nothing in the target — drop it so the
        // staleness check doesn't misfire there.
        meta: (({ commit, ...m }) => ({ ...m, movedFrom: path.basename(source) }))(e.meta || {}),
        ...(detail ? { detail, detailLocal: local } : {}),
      });
    }
    deleteEntry(cwd, e.id);
    moved++;
  }
  console.log("\n  " + green(`✔ moved ${moved}`) + gray(` — commit both repos' .ai-memory/ changes.\n`));
}
