/**
 * Clean-tree policy helpers — `.gitignore` and `.gitattributes` wiring so
 * memory writes don't dirty the working tree.
 *
 * Default policy (one developer, multiple machines, optionally a team):
 *   - `.ai-memory/global.jsonl`      → gitignored (personal, per-machine)
 *   - `.ai-memory/sessions.jsonl`    → gitignored (legacy single-file flat)
 *   - `.ai-memory/branches/*.jsonl`  → tracked + merge=union for clean diffs
 *   - `.ai-memory/handoff.md`        → gitignored (regenerated on demand)
 *   - `.ai-memory/CONTEXT.draft.md`  → gitignored (per-IDE scratch)
 *
 * Markers wrap the managed block so users can edit around it without us
 * clobbering their hand-curated rules.
 */
import * as fs   from "node:fs";
import * as path from "node:path";

export const GITIGNORE_START = "# >>> infernoflow:start";
export const GITIGNORE_END   = "# <<< infernoflow:end";

const MANAGED_GITIGNORE_LINES = [
  "",
  GITIGNORE_START,
  "# Personal memory (per-developer, per-machine). Sync via cloud folder",
  "# or `infernoflow sync`, not git.",
  ".ai-memory/global.jsonl",
  ".ai-memory/sessions.jsonl",
  "# Regenerated artifacts — never commit these.",
  ".ai-memory/handoff.md",
  ".ai-memory/CONTEXT.draft.md",
  ".ai-memory/HANDOFF.md",
  ".ai-memory/.last-cli-version",
  "# Build/publish hygiene — don't ship memory in published .NET / monorepo bundles.",
  "**/publish/.ai-memory/",
  "**/publish/inferno/",
  "**/dist/.ai-memory/",
  "**/dist/inferno/",
  GITIGNORE_END,
  "",
].join("\n");

const MANAGED_GITATTRIBUTES_LINES = [
  "",
  GITIGNORE_START,
  "# Branch-local memory: append-only JSONL files. Auto-merge concurrent",
  "# additions from different machines/branches as union of lines so",
  "# `home → work → home` syncs don't produce conflicts.",
  ".ai-memory/branches/*.jsonl merge=union",
  GITIGNORE_END,
  "",
].join("\n");

/**
 * Insert or replace the managed `<infernoflow:start>...<infernoflow:end>`
 * block in `relativeFile` under `projectRoot`. Creates the file if missing.
 * Idempotent — calling twice produces the same result as calling once.
 *
 * @returns {"created" | "updated" | "unchanged"}
 */
// Legacy markers from the v0.43 init flow. v0.44 flipped the policy
// (rule files are tracked, only `global.jsonl` is gitignored), so any old
// block found here is stripped during ensureManagedBlock so users don't
// accumulate parallel infernoflow-managed sections in their .gitignore.
const LEGACY_MARK_START = "# --- infernoflow (developer-local AI memory; do not commit) ---";
const LEGACY_MARK_END   = "# --- /infernoflow ---";

function stripLegacyBlock(text) {
  const startIdx = text.indexOf(LEGACY_MARK_START);
  const endIdx   = text.indexOf(LEGACY_MARK_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return text;
  const before = text.slice(0, startIdx).replace(/\s+$/, "");
  const after  = text.slice(endIdx + LEGACY_MARK_END.length).replace(/^\s+/, "");
  return (before ? before + "\n" : "") + (after || "");
}

export function ensureManagedBlock(projectRoot, relativeFile, managedContent) {
  const filePath = path.join(projectRoot, relativeFile);
  let existing = "";
  try { existing = fs.readFileSync(filePath, "utf8"); } catch {}

  // Migrate: drop the legacy v0.43 block before we touch the file. Idempotent
  // — if it's not there, this is a no-op.
  existing = stripLegacyBlock(existing);

  const startIdx = existing.indexOf(GITIGNORE_START);
  const endIdx   = existing.indexOf(GITIGNORE_END);
  const middle   = managedContent.trim();

  let next;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx).replace(/\s+$/, "");
    const after  = existing.slice(endIdx + GITIGNORE_END.length).replace(/^\s+/, "");
    next = (before ? before + "\n\n" : "") + middle + "\n" + (after ? "\n" + after : "");
  } else if (existing) {
    next = existing.replace(/\s+$/, "") + "\n\n" + middle + "\n";
  } else {
    next = middle + "\n";
  }

  if (next === existing) return "unchanged";

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next, "utf8");
  return existing ? "updated" : "created";
}

/**
 * Write the default clean-tree policy into a project root. Called by `init`
 * (when the project is being scaffolded for the first time) and by `doctor`
 * (when the user runs --fix to repair drift). Returns a small report so
 * callers can show "what we touched".
 */
export function applyCleanTreePolicy(projectRoot) {
  return {
    gitignore:     ensureManagedBlock(projectRoot, ".gitignore",     MANAGED_GITIGNORE_LINES),
    gitattributes: ensureManagedBlock(projectRoot, ".gitattributes", MANAGED_GITATTRIBUTES_LINES),
  };
}
