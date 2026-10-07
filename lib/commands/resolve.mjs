/**
 * `infernoflow resolve <id> [--note "fixed in abc123"] [--undo]` (D13, 0.46.0)
 *
 * Marks an entry as resolved: it stays searchable (`ask`) but is no longer
 * injected into AI context or listed by `resume`. Use it when a gotcha has
 * been fixed, or when a "may be stale" entry turned out to be outdated.
 */
import { readEntries, updateEntry } from "../amp/io.mjs";
import { gray, green, red, cyan } from "../ui/output.mjs";

export function findByIdPrefix(cwd, prefix) {
  if (!prefix || prefix.length < 6) return { error: "give at least 6 characters of the entry id (see: infernoflow ask)" };
  const hits = readEntries(cwd).filter(e => e.id && e.id.startsWith(prefix));
  if (!hits.length) return { error: `no entry with id starting ${prefix}` };
  if (hits.length > 1) return { error: `${hits.length} entries match ${prefix} — use more characters` };
  return { entry: hits[0] };
}

export async function resolveCommand(args = []) {
  const cwd = process.cwd();
  const prefix = args.slice(1).find(a => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--note");
  const ni = args.indexOf("--note");
  const note = ni !== -1 ? String(args[ni + 1] || "").slice(0, 500) : null;
  const undo = args.includes("--undo");
  const { entry, error } = findByIdPrefix(cwd, prefix);
  if (error) { console.error(red("\n  ✘ " + error + "\n")); process.exitCode = 1; return; }
  const r = updateEntry(cwd, entry.id, (o) => {
    if (undo) { delete o.meta.resolved; }
    else o.meta.resolved = { ts: Date.now(), ...(note ? { note } : {}) };
    if (!Object.keys(o.meta).length) delete o.meta;
    return o;
  });
  console.log("\n  " + green("✔ ") + (undo ? "Re-opened " : "Resolved ") + cyan(entry.id) + gray(` (${r.updated} cop${r.updated === 1 ? "y" : "ies"})`));
  console.log("  " + gray(entry.summary || entry.msg || "") + "\n");
}
