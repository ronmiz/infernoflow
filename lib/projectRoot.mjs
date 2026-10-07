/**
 * Project-root resolution — one canonical place per project, regardless of
 * which subfolder the CLI / MCP server happened to be invoked from.
 *
 * Why this exists: infernoflow keys off `process.cwd()` historically. That
 * means running `infernoflow log "..."` from `src/Server/` creates a stray
 * `.ai-memory/` at that path. Multi-folder projects (.NET full-stack with
 * separate publish dirs, monorepos, etc.) end up with several scattered
 * memory folders that don't merge. This module finds *the* project root
 * so reads and writes always land in one place.
 *
 * Resolution order (first hit wins, walking upward from a start dir):
 *   1. an existing `.ai-memory/` directory                — strongest signal
 *   2. an existing legacy `inferno/` directory            — back-compat
 *   3. a `.git/` directory                                — most projects
 *   4. a known project manifest:
 *        package.json, *.sln, *.csproj, Cargo.toml,
 *        pyproject.toml, go.mod, Gemfile, composer.json,
 *        deno.json, build.gradle, pom.xml, mix.exs
 *   5. fall back to the starting directory
 *
 * The result is memoised per starting directory because the walk is on
 * the hot path of every amp_read / amp_write.
 */
import * as fs   from "node:fs";
import * as path from "node:path";

const MANIFESTS = [
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "Gemfile",
  "composer.json",
  "deno.json",
  "deno.jsonc",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "mix.exs",
];

// Glob-ish manifest detectors — fileExists won't help, must list dir.
const MANIFEST_PATTERNS = [
  /\.sln$/i,
  /\.csproj$/i,
  /\.fsproj$/i,
  /\.vbproj$/i,
];

const CACHE = new Map();

function hasExactManifest(dir) {
  for (const name of MANIFESTS) {
    if (fs.existsSync(path.join(dir, name))) return true;
  }
  return false;
}

function hasPatternManifest(dir) {
  try {
    for (const name of fs.readdirSync(dir)) {
      for (const re of MANIFEST_PATTERNS) {
        if (re.test(name)) return true;
      }
    }
  } catch { /* unreadable dir */ }
  return false;
}

/**
 * Find the project root for the given start directory (defaults to cwd).
 * Memoised — repeated calls in the same process are O(1).
 *
 * @param {string} [start=process.cwd()]
 * @returns {string} absolute path to the project root
 */
export function findProjectRoot(start = process.cwd()) {
  const startAbs = path.resolve(start);
  if (CACHE.has(startAbs)) return CACHE.get(startAbs);

  // Never treat a filesystem root (C:\, D:\, /) as a project root during an
  // upward walk. A stray `.ai-memory`/`inferno`/manifest dumped at the drive
  // root would otherwise hijack EVERY marker-less project on the whole volume
  // — one bad write at C:\ silently reroutes all reads/writes there. A real
  // project is never the bare drive root; invoking from there falls to Pass 3.
  const atFsRoot = (d) => path.dirname(d) === d;

  // Pass 1: prefer an existing memory dir at any depth — strongest signal.
  let dir = startAbs;
  while (true) {
    if (!atFsRoot(dir)) {
      if (fs.existsSync(path.join(dir, ".ai-memory"))) return memo(startAbs, dir);
      if (fs.existsSync(path.join(dir, "inferno")))    return memo(startAbs, dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Pass 2: fall back to project markers.
  dir = startAbs;
  while (true) {
    if (!atFsRoot(dir)) {
      if (fs.existsSync(path.join(dir, ".git")))   return memo(startAbs, dir);
      if (hasExactManifest(dir))                    return memo(startAbs, dir);
      if (hasPatternManifest(dir))                  return memo(startAbs, dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Pass 3: no markers found — use the start directory itself. This is
  // intentional: a brand-new repo doesn't have any of the above yet, but
  // `infernoflow init` from cwd should still scaffold there rather than
  // somewhere up the tree.
  return memo(startAbs, startAbs);
}

function memo(start, root) {
  CACHE.set(start, root);
  return root;
}

/**
 * Clear the memo. Tests use this between cases that share a process.
 */
export function _resetProjectRootCache() {
  CACHE.clear();
}

/**
 * Diagnostic: list every `.ai-memory/` and legacy `inferno/` folder under a
 * starting directory (depth-limited). `doctor` uses this to flag multi-folder
 * pollution — e.g. an .ai-memory/ in your project root AND another in
 * publish/ from a misconfigured build.
 *
 * @param {string} start
 * @param {number} [maxDepth=6]
 * @returns {{ kind: "amp" | "legacy", path: string }[]}
 */
export function findAllMemoryDirs(start, maxDepth = 6) {
  const out = [];
  const seen = new Set();
  const SKIP = new Set([
    "node_modules", ".git", "dist", "build", "out", "bin", "obj",
    ".next", ".nuxt", ".angular", ".svelte-kit", "coverage", "vendor",
    "target", ".venv", "venv", "__pycache__", ".pytest_cache",
  ]);

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    if (seen.has(dir)) return;
    seen.add(dir);

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP.has(e.name)) continue;
      if (e.name === ".ai-memory") out.push({ kind: "amp",    path: path.join(dir, e.name) });
      if (e.name === "inferno")    out.push({ kind: "legacy", path: path.join(dir, e.name) });
      walk(path.join(dir, e.name), depth + 1);
    }
  }
  walk(path.resolve(start), 0);
  return out;
}
