/**
 * Git pre-commit warning (0.48.0): when a commit touches a file that project
 * memory has a gotcha, failed attempt or decision about, print those entries
 * (stderr) before the commit goes through. It never blocks a commit, and it
 * only lives in this clone's .git/hooks (git doesn't share hooks).
 *
 * Our lines sit between two marker comments, at the top of an existing hook,
 * so a hook of the user's own keeps working and uninstall removes only ours.
 * Projects that point git at a shared hooks folder (core.hooksPath, e.g.
 * husky) are left alone: those folders are usually committed.
 */
import * as fs   from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export const PRECOMMIT_START = "# infernoflow:start (memory about the files in this commit; never blocks)";
export const PRECOMMIT_END   = "# infernoflow:end";
const BLOCK = [
  PRECOMMIT_START,
  "command -v infernoflow >/dev/null 2>&1 && infernoflow hook pre-commit </dev/null || true",
  PRECOMMIT_END,
];

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 5000 }).trim();
}

/** The hooks folder git uses here, or { skipped } when it is a custom core.hooksPath / not a repo. */
export function hooksDir(cwd) {
  try { if (git(cwd, ["config", "--get", "core.hooksPath"])) return { skipped: "hooksPath" }; } catch { /* not set */ }
  try {
    const p = git(cwd, ["rev-parse", "--git-path", "hooks"]);
    return { dir: path.resolve(cwd, p) };
  } catch { return { skipped: "not-a-repo" }; }
}

/** Remove our block from hook text; returns the text that is left. */
export function stripPreCommitBlock(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const s = lines.findIndex(l => l.trim() === PRECOMMIT_START);
  const e = lines.findIndex((l, i) => i > s && l.trim() === PRECOMMIT_END);
  if (s === -1 || e === -1) return String(text);
  lines.splice(s, e - s + 1);
  return lines.join("\n");
}

/** True when nothing but a shebang / blank lines / comments is left. */
export function onlyBoilerplate(text) {
  return String(text).split(/\r?\n/).every(l => !l.trim() || l.startsWith("#"));
}

/** Install (or keep) our block in .git/hooks/pre-commit. */
export function installPreCommitHook(cwd) {
  const where = hooksDir(cwd);
  if (where.skipped) return { installed: false, skipped: where.skipped };
  const file = path.join(where.dir, "pre-commit");
  let cur = null;
  try { cur = fs.readFileSync(file, "utf8"); } catch { /* none */ }
  if (cur && cur.includes(PRECOMMIT_START)) return { installed: false, present: true, path: file };
  let next;
  if (cur === null || !cur.trim()) {
    next = ["#!/bin/sh", ...BLOCK, ""].join("\n");
  } else {
    // Ours goes right after the shebang, so a user's `exit 0` further down can't skip it.
    const lines = cur.replace(/\r\n/g, "\n").split("\n");
    const at = lines[0].startsWith("#!") ? 1 : 0;
    lines.splice(at, 0, ...BLOCK);
    next = lines.join("\n");
  }
  fs.mkdirSync(where.dir, { recursive: true });
  fs.writeFileSync(file, next, "utf8");
  try { fs.chmodSync(file, 0o755); } catch { /* Windows */ }
  return { installed: true, created: cur === null, path: file };
}

/** Uninstall: remove our block; delete the hook when nothing else is left. */
export function removePreCommitHook(cwd) {
  const where = hooksDir(cwd);
  if (where.skipped) return { removed: false };
  const file = path.join(where.dir, "pre-commit");
  let cur;
  try { cur = fs.readFileSync(file, "utf8"); } catch { return { removed: false }; }
  if (!cur.includes(PRECOMMIT_START)) return { removed: false };
  const rest = stripPreCommitBlock(cur);
  if (onlyBoilerplate(rest)) { fs.unlinkSync(file); return { removed: true, deletedFile: true }; }
  fs.writeFileSync(file, rest, "utf8");
  return { removed: true };
}
