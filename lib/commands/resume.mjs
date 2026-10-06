/**
 * `infernoflow resume` — "where were we?" in one call (D8, 0.46.0).
 * Store + branch, the latest resume point with its note, open dead ends,
 * recent decisions/notes (ranked by --file when given), uncommitted changes,
 * and how many entries may be stale.
 *
 *   infernoflow resume [--file <path>] [--json]
 */
import { buildResume, renderResume } from "../memoryView.mjs";

export async function resumeCommand(args = []) {
  const fi   = args.indexOf("--file");
  const file = fi !== -1 ? args[fi + 1] : null;
  const r = buildResume(process.cwd(), { file });
  if (args.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log("\n" + renderResume(r) + "\n");
}
