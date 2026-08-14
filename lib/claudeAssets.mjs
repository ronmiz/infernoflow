/**
 * Idempotently ensure the infernoflow Claude Code assets (the `infernoflow-memory`
 * skill + the `memory-keeper` agent) exist in a project's `.claude/` directory.
 *
 * This runs opportunistically from the rule-file refresh path (i.e. on every
 * `log` / `refresh` / MCP write), so a user who UPGRADES the CLI picks up assets
 * that a newer release added WITHOUT having to re-run `infernoflow init`. Fresh
 * `init` still installs them explicitly (with visible output); this is the silent
 * self-heal for already-initialized projects. Transparent, zero user action.
 *
 * Contract: silent, cheap, and safe.
 *   - Returns immediately if both assets already exist.
 *   - Never overwrites an existing file (respects user edits / deletions within a run).
 *   - Only writes inside an initialized project (`.ai-memory/` or `inferno/`).
 *   - Caches per-cwd within the process so repeated `log`s don't re-stat.
 *   - Never throws — any failure is swallowed; memory capture must never break
 *     because of an asset copy.
 */
import * as fs   from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// lib/claudeAssets.mjs -> templates live at ../templates
// (dist/templates when built and shipped; repo/templates when run from source).
function templatesRoot() { return path.resolve(__dirname, "../templates"); }

const _ensured = new Set();

function hasMemoryStore(cwd) {
  return fs.existsSync(path.join(cwd, ".ai-memory")) ||
         fs.existsSync(path.join(cwd, "inferno"));
}

/** Copy every file under srcDir into dstDir, creating dirs, never overwriting. */
function copyTree(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return 0;
  let created = 0;
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const sp = path.join(srcDir, e.name);
    const dp = path.join(dstDir, e.name);
    if (e.isDirectory()) { created += copyTree(sp, dp); continue; }
    if (fs.existsSync(dp)) continue;                 // never clobber
    fs.mkdirSync(path.dirname(dp), { recursive: true });
    fs.copyFileSync(sp, dp);
    created++;
  }
  return created;
}

/**
 * Ensure `.claude/skills` and `.claude/agents` carry the shipped assets.
 * @param {string} cwd project root
 * @returns {number} count of files newly created (0 if already present / n/a)
 */
export function ensureClaudeAssets(cwd) {
  try {
    if (!cwd || _ensured.has(cwd)) return 0;
    _ensured.add(cwd);
    if (!hasMemoryStore(cwd)) return 0;              // only in initialized projects
    const tmpl = templatesRoot();
    let created = 0;
    created += copyTree(path.join(tmpl, "skills"), path.join(cwd, ".claude", "skills"));
    created += copyTree(path.join(tmpl, "agents"), path.join(cwd, ".claude", "agents"));
    return created;
  } catch { return 0; }
}
