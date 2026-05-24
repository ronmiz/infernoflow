/**
 * Branch detection for branch-aware memory.
 *
 * Why this matters: branch memory (`.ai-memory/branches/<branch>.jsonl`)
 * is git-tracked so a teammate who checks out the branch inherits the
 * decisions/gotchas captured while it was being worked on. To route
 * writes and merge reads correctly we need three things:
 *
 *   1. What branch is HEAD on right now?
 *   2. What's the "default" / "main" branch — main, master, trunk,
 *      whatever the project uses? Memory written there is project-wide
 *      truth that should surface on every other branch.
 *   3. Is HEAD detached / is there no git at all? Both are fine —
 *      memory still works, it just falls into a synthetic "no-branch"
 *      bucket so writes don't get lost.
 *
 * Everything here is cheap and synchronous: one `git` invocation per
 * call, capped at 5 s, errors swallowed. No fancy state. Tests can
 * point at fixture repos via the `cwd` arg.
 */
import { execSync }  from "node:child_process";
import * as fs       from "node:fs";
import * as path     from "node:path";

/**
 * Slug-safe a branch name so it survives as a filename on every OS.
 * `feature/foo bar` → `feature__foo-bar`.
 */
export function slugifyBranch(name) {
  if (!name) return "no-branch";
  return name
    .replace(/\//g, "__")
    .replace(/[^A-Za-z0-9_.\-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "no-branch";
}

function runGit(cwd, args) {
  try {
    const out = execSync(`git ${args}`, {
      cwd,
      encoding: "utf8",
      timeout: 1_500,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch { return null; }
}

// Memo: getBranchInfo() runs two git subprocesses; ampPaths() is called
// from every read/write, so without caching this becomes the dominant
// cost. Keyed by the resolved project root — branch state doesn't change
// within a single process unless the user actively checks out a different
// branch, and any such caller can call _resetBranchCache() to invalidate.
const BRANCH_CACHE = new Map();
export function _resetBranchCache() { BRANCH_CACHE.clear(); }

/**
 * Is there a usable .git directory at or above `cwd`?
 * We don't run `git rev-parse --is-inside-work-tree` because that costs a
 * subprocess; checking for `.git` is faster and good enough — branch
 * detection callers will fall back gracefully if the actual `git` command
 * fails afterwards.
 */
export function hasGit(cwd) {
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Returns the current branch name, or:
 *   - "no-branch" if HEAD is detached
 *   - "no-git"    if the project isn't a git repo at all
 *
 * The synthetic names are deliberately filename-safe so the resulting
 * `branches/<branch>.jsonl` always points at *some* file — writes never
 * get lost because of a missing branch concept.
 */
/** Find the `.git` directory (or .git file for worktrees) at or above cwd. */
function findGitDir(cwd) {
  let dir = path.resolve(cwd);
  while (true) {
    const candidate = path.join(dir, ".git");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function getCurrentBranch(cwd = process.cwd()) {
  // Read .git/HEAD directly — orders of magnitude faster than spawning git
  // and works on every machine without git installed. Tests with an empty
  // .git/ folder now return "no-branch" in microseconds instead of seconds.
  const gitDir = findGitDir(cwd);
  if (!gitDir) return "no-git";

  // .git can be either a directory (normal) or a file (worktree: contains
  // `gitdir: /path/to/real/.git`). Resolve to the directory containing HEAD.
  let resolvedGitDir = gitDir;
  try {
    const stat = fs.statSync(gitDir);
    if (stat.isFile()) {
      const ref = fs.readFileSync(gitDir, "utf8").trim();
      const m = ref.match(/^gitdir:\s*(.+)$/);
      if (m) resolvedGitDir = path.resolve(path.dirname(gitDir), m[1].trim());
    }
  } catch { /* fall through */ }

  let head;
  try { head = fs.readFileSync(path.join(resolvedGitDir, "HEAD"), "utf8").trim(); }
  catch { return "no-branch"; }

  // HEAD is either "ref: refs/heads/<branch>" (on a branch)
  // or a bare commit SHA (detached HEAD).
  const m = head.match(/^ref:\s+refs\/heads\/(.+)$/);
  return m ? m[1] : "no-branch";
}

/**
 * Returns the project's default branch:
 *   1. origin's HEAD pointer if the remote is configured
 *      (e.g. `origin/main` → `main`)
 *   2. The first existing local branch among the conventional names
 *   3. null if nothing matches (caller decides what to do)
 */
export function getDefaultBranch(cwd = process.cwd()) {
  // Direct file reads instead of git subprocesses — same logic, ~100x faster.
  const gitDir = findGitDir(cwd);
  if (!gitDir) return null;

  let resolvedGitDir = gitDir;
  try {
    const stat = fs.statSync(gitDir);
    if (stat.isFile()) {
      const ref = fs.readFileSync(gitDir, "utf8").trim();
      const m = ref.match(/^gitdir:\s*(.+)$/);
      if (m) resolvedGitDir = path.resolve(path.dirname(gitDir), m[1].trim());
    }
  } catch { /* */ }

  // 1. Cloned repos: read .git/refs/remotes/origin/HEAD
  try {
    const head = fs.readFileSync(
      path.join(resolvedGitDir, "refs", "remotes", "origin", "HEAD"),
      "utf8",
    ).trim();
    const m = head.match(/^ref:\s+refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  } catch { /* */ }

  // 2. Look for known branch refs (loose refs or packed-refs)
  let packedRefs = "";
  try { packedRefs = fs.readFileSync(path.join(resolvedGitDir, "packed-refs"), "utf8"); }
  catch { /* */ }
  for (const name of ["main", "master", "trunk", "develop", "dev"]) {
    if (fs.existsSync(path.join(resolvedGitDir, "refs", "heads", name))) return name;
    if (packedRefs.includes(`refs/heads/${name}\n`)) return name;
  }
  return null;
}

/**
 * Convenience bundle for callers that want everything in one read.
 * Designed to be invoked at the start of any operation that touches
 * branch-scoped storage, so they share a single `git` round-trip if
 * possible (we don't memoise — that's the caller's choice).
 */
export function getBranchInfo(cwd = process.cwd()) {
  const key = path.resolve(cwd);
  const cached = BRANCH_CACHE.get(key);
  if (cached) return cached;
  const current = getCurrentBranch(cwd);
  const dflt    = getDefaultBranch(cwd);
  const info = {
    current,
    currentSlug: slugifyBranch(current),
    default:     dflt,
    defaultSlug: dflt ? slugifyBranch(dflt) : null,
    isSynthetic: current === "no-git" || current === "no-branch",
  };
  BRANCH_CACHE.set(key, info);
  return info;
}
