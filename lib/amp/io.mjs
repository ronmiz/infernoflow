/**
 * AMP I/O — AI Memory Protocol bindings for infernoflow.
 *
 * One source of truth for: where memory lives, what shape it has on disk,
 * and how to translate between AMP's wire format and infernoflow's internal
 * shape so the rest of the codebase can keep working with familiar fields.
 *
 * ── Folder layout ────────────────────────────────────────────────────────────
 *   .ai-memory/sessions.jsonl   — required, append-only AMP entries
 *   .ai-memory/amp.json         — optional, project metadata
 *   .ai-memory/handoff.md       — optional, generated handoff
 *
 * Backward compat: if `.ai-memory/` doesn't exist but `inferno/sessions.jsonl`
 * does (the pre-v0.41 layout), we read from there. Writes always target the
 * new layout — they create `.ai-memory/` if missing. `infernoflow amp migrate`
 * will move legacy data over explicitly.
 *
 * ── Entry shape ──────────────────────────────────────────────────────────────
 * AMP wire format (per docs/protocol/PROTOCOL.md §3):
 *   { type, msg, ts, id?, file?, line?, function?, tags?, source?,
 *     tool?, session?, confidence?, related?, meta? }
 *
 * infernoflow internal shape (legacy):
 *   { ts, agent, type, summary, result?, source?, auto?, file?, line? }
 *
 * Translation rules:
 *   internal.summary   ↔  amp.msg
 *   internal.ts (ISO)  ↔  amp.ts (Unix ms integer)
 *   internal.agent     ↔  amp.tool (when in enum) or amp.meta.agent
 *   internal.auto:true ↔  amp.confidence:0.7
 *   internal.result    ↔  amp.meta.result    (AMP schema is strict)
 *   non-AMP type       ↔  amp.type:"note" + amp.meta.subtype:<original>
 *
 * Round-trip is lossless: everything infernoflow knows about an entry survives
 * a write→read cycle, even though the wire format is strictly AMP-compliant.
 */

import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { findProjectRoot } from "../projectRoot.mjs";
import { getBranchInfo, slugifyBranch } from "../git/branch.mjs";

// ── Constants ────────────────────────────────────────────────────────────────

export const AMP_VERSION = "1.0";

// NOTE: AMP_MARKERS (the `<!-- AMP:START -->` / `<!-- AMP:END -->` sentinel
// pair) was removed in v0.44. The single canonical rule-file block now uses
// `<!-- infernoflow:start -->` / `<!-- infernoflow:end -->` (see
// lib/ruleFiles.mjs). The old AMP_MARKERS writer in log.mjs produced
// duplicate managed blocks in CLAUDE.md and was deleted alongside this
// constant. If you need to import them for a third-party tool, copy the
// strings inline — they are not part of the public AMP wire spec.

const AMP_TYPES = new Set(["gotcha", "decision", "attempt", "note", "detection", "pattern"]);
const AMP_TOOLS = new Set(["copilot", "cursor", "claude", "windsurf", "other"]);

// ── Paths ────────────────────────────────────────────────────────────────────

/**
 * Returns the canonical AMP paths for a given workspace.
 *
 * Resolution: the input `cwd` is treated as a starting point; the actual
 * memory location is the project root discovered by `findProjectRoot()` —
 * walking up until we hit an existing memory dir, .git/, or a manifest
 * file. This stops `.ai-memory/` from getting created inside random
 * subdirectories when the CLI is invoked from src/ / publish/ / etc.
 *
 * Callers that want the OLD literal-cwd behavior (mostly tests) can pass
 * `{ literal: true }`.
 *
 * Prefers .ai-memory/ if it exists; falls back to inferno/ for legacy reads.
 * For writes, always use {forWrite: true} so we target the new layout.
 */
/**
 * Slug-safe project identity. Used to namespace personal memory inside a
 * shared sync folder so two projects on the same dev machine don't collide.
 * Source priority: `amp.json` `project` field → basename of project root.
 */
export function projectSlug(projectRoot) {
  let raw = path.basename(path.resolve(projectRoot));
  try {
    const cfgPath = path.join(projectRoot, ".ai-memory", "amp.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (cfg && typeof cfg.project === "string" && cfg.project.trim()) {
        raw = cfg.project.trim();
      }
    }
  } catch { /* fall through */ }
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_.\-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unnamed-project";
}

/**
 * Resolve where `global.jsonl` lives — the personal-prefs memory layer that
 * doesn't belong in git but DOES belong in the user's cross-machine memory.
 *
 * Resolution order:
 *   1. `INFERNOFLOW_GLOBAL_DIR` env var → `<env>/<project-slug>/global.jsonl`
 *   2. `globalDir` in `.ai-memory/amp.json` → same shape as #1
 *   3. Default: `<project>/.ai-memory/global.jsonl` (no cross-machine sync)
 *
 * For #1 and #2: a relative path is resolved against the project root, so
 * users can write `~/Dropbox/infernoflow-memory` and expect tilde-expansion;
 * we also expand `~` to `os.homedir()` for ergonomics.
 *
 * Returns the absolute path to the file (creates the parent dir on demand).
 */
export function resolveGlobalFile(projectRoot, ampDir) {
  let configured = process.env.INFERNOFLOW_GLOBAL_DIR;
  if (!configured) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(ampDir, "amp.json"), "utf8"));
      if (cfg && typeof cfg.globalDir === "string" && cfg.globalDir.trim()) {
        configured = cfg.globalDir.trim();
      }
    } catch { /* */ }
  }
  if (!configured) {
    // Default: co-located with the project's memory dir.
    return path.join(ampDir, "global.jsonl");
  }
  // Expand ~ and resolve relative to project root.
  let dir = configured;
  if (dir.startsWith("~")) {
    dir = path.join(os.homedir(), dir.slice(1).replace(/^[\/\\]/, ""));
  }
  if (!path.isAbsolute(dir)) dir = path.resolve(projectRoot, dir);
  const slug = projectSlug(projectRoot);
  return path.join(dir, slug, "global.jsonl");
}

export function ampPaths(cwd, opts = {}) {
  const root      = opts.literal ? path.resolve(cwd) : findProjectRoot(cwd);
  const ampDir    = path.join(root, ".ai-memory");
  const legacyDir = path.join(root, "inferno");

  const useAmp     = opts.forWrite || fs.existsSync(ampDir) || !fs.existsSync(legacyDir);
  const memRoot    = useAmp ? ampDir : legacyDir;
  const isAmp      = useAmp;

  // Branch-aware layout (v0.44+). The legacy flat `sessions.jsonl` is still
  // returned for read-merge back-compat; new writes route per the type-based
  // policy in `appendEntry()`.
  const branchesDir       = path.join(memRoot, "branches");
  const branchInfo        = getBranchInfo(root);
  const currentBranchFile = path.join(branchesDir, `${branchInfo.currentSlug}.jsonl`);
  const defaultBranchFile = branchInfo.defaultSlug
    ? path.join(branchesDir, `${branchInfo.defaultSlug}.jsonl`)
    : null;

  // Cross-machine sync: global.jsonl can live in a synced folder so personal
  // preferences follow the dev between machines. Defaults to in-project.
  const globalFile        = resolveGlobalFileSafe(root, memRoot);

  return {
    root:        memRoot,
    projectRoot: root,
    isAmp,
    sessions:    path.join(memRoot, "sessions.jsonl"),  // legacy flat file
    config:      path.join(memRoot, isAmp ? "amp.json"   : "config.json"),
    handoff:     path.join(memRoot, isAmp ? "handoff.md" : "HANDOFF.md"),
    // Branch-aware
    globalFile,
    branchesDir,
    currentBranchFile,
    defaultBranchFile,
    branch:      branchInfo,
  };
}

// Wrapper that swallows resolution errors and falls back to the in-project
// default — never let a sync misconfiguration break basic memory ops.
function resolveGlobalFileSafe(projectRoot, ampDir) {
  try { return resolveGlobalFile(projectRoot, ampDir); }
  catch { return path.join(ampDir, "global.jsonl"); }
}

export function ensureAmpDir(cwd) {
  const root = findProjectRoot(cwd);
  const dir = path.join(root, ".ai-memory");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── ULID (minimal, no deps) ──────────────────────────────────────────────────

const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function generateULID() {
  let t = Date.now();
  let s = "";
  for (let i = 0; i < 10; i++) { s = ENC[t % 32] + s; t = Math.floor(t / 32); }
  let r = "";
  for (let i = 0; i < 16; i++) r += ENC[Math.floor(Math.random() * 32)];
  return s + r;
}

// ── Translation: internal ⇄ AMP ──────────────────────────────────────────────

export function toAmp(internal) {
  const meta = { ...(internal.meta || {}) };

  // Type fall-back: if not in AMP enum, store original under meta.subtype
  let type = internal.type || "note";
  if (!AMP_TYPES.has(type)) {
    meta.subtype = type;
    type = "note";
  }

  // result is infernoflow-specific — stash in meta
  if (internal.result) meta.result = internal.result;

  // tool / agent mapping
  let tool;
  const agent = internal.agent;
  if (agent && AMP_TOOLS.has(agent)) {
    tool = agent;
  } else if (agent) {
    meta.agent = agent; // "human" or any other non-AMP value
  }

  // ts: ISO string → Unix ms integer
  const ts = typeof internal.ts === "number"
    ? internal.ts
    : (internal.ts ? Date.parse(internal.ts) : Date.now());

  // confidence: derive from auto flag if no explicit value
  const confidence =
    internal.confidence != null ? internal.confidence
    : internal.auto             ? 0.7
    : undefined;

  const amp = {
    type,
    msg: internal.summary || internal.msg || "",
    ts,
    id: internal.id || `amp_${generateULID()}`,
  };
  if (internal.file)     amp.file     = internal.file;
  if (internal.line)     amp.line     = internal.line;
  if (internal.function) amp.function = internal.function;
  if (internal.tags && internal.tags.length) amp.tags = internal.tags;
  if (internal.source)   amp.source   = internal.source;
  if (tool)              amp.tool     = tool;
  if (internal.session)  amp.session  = internal.session;
  if (confidence != null) amp.confidence = confidence;
  if (Object.keys(meta).length) amp.meta = meta;

  return amp;
}

export function fromAmp(amp) {
  // If this looks like a legacy entry (already has summary/agent), pass through
  if (amp.summary && !amp.msg) return amp;

  const meta = amp.meta || {};
  const internalType = meta.subtype || amp.type || "note";

  const internal = {
    ts:      amp.ts,                    // numeric is fine for infernoflow consumers
    type:    internalType,
    summary: amp.msg || "",
  };
  if (amp.id)        internal.id        = amp.id;
  if (amp.file)      internal.file      = amp.file;
  if (amp.line)      internal.line      = amp.line;
  if (amp.function)  internal.function  = amp.function;
  if (amp.tags)      internal.tags      = amp.tags;
  if (amp.source)    internal.source    = amp.source;
  if (amp.tool)      internal.agent     = amp.tool;
  if (meta.agent)    internal.agent     = meta.agent;          // "human" round-trip
  if (meta.result)   internal.result    = meta.result;
  if (amp.confidence != null) {
    internal.confidence = amp.confidence;
    if (amp.confidence < 1) internal.auto = true;              // legacy compatibility
  }
  // Carry remaining meta keys minus the ones we already pulled out
  const { subtype, agent, result, ...restMeta } = meta;
  if (Object.keys(restMeta).length) internal.meta = restMeta;

  return internal;
}

// ── Read / write ─────────────────────────────────────────────────────────────

/**
 * Read one JSONL file and return its entries normalized to internal shape.
 * Returns [] if the file doesn't exist or is unreadable.
 */
function readJsonlFile(file) {
  if (!file || !fs.existsSync(file)) return [];
  try {
    return fs.readFileSync(file, "utf8")
      .split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .map(fromAmp);
  } catch { return []; }
}

/**
 * Merged read across the branch-aware layout:
 *   1. legacy `sessions.jsonl`        (back-compat for pre-v0.44 projects)
 *   2. `global.jsonl`                 (personal, gitignored)
 *   3. `branches/<default>.jsonl`     (project-wide truth from main/master)
 *   4. `branches/<current>.jsonl`     (in-progress work on this branch)
 *
 * Entries are deduplicated by `id` — if the same entry somehow appears in
 * multiple files (e.g. after a migration), the first occurrence wins.
 * Sorted ascending by `ts` so consumers can rely on chronological order.
 */
export function readEntries(cwd) {
  const p = ampPaths(cwd);
  const seen = new Set();
  const out = [];
  const sources = [
    p.sessions,           // legacy flat
    p.globalFile,         // personal
    p.defaultBranchFile,  // project-wide truth
    p.currentBranchFile,  // in-progress
  ];
  // De-dupe same-file paths (current == default on main, etc.)
  const unique = [...new Set(sources.filter(Boolean))];
  for (const file of unique) {
    for (const e of readJsonlFile(file)) {
      const key = e.id || `${e.ts}|${e.summary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out.sort((a, b) => {
    const ta = typeof a.ts === "number" ? a.ts : Date.parse(a.ts || 0);
    const tb = typeof b.ts === "number" ? b.ts : Date.parse(b.ts || 0);
    return ta - tb;
  });
}

/**
 * Routing policy: which file does an entry of `type` belong in?
 *   - `preference` → global   (personal, gitignored, doesn't travel with branch)
 *   - everything else → current branch  (travels via git so teammates inherit)
 *
 * Callers can override via `target` in the entry: "global" | "branch" | "legacy".
 * Useful for migration tools and for explicit "this is project-wide" writes.
 */
function destinationFile(p, entry) {
  if (entry.target === "global")  return p.globalFile;
  if (entry.target === "legacy")  return p.sessions;
  if (entry.target === "branch")  return p.currentBranchFile;
  if (entry.type === "preference") return p.globalFile;
  return p.currentBranchFile;
}

/**
 * Append an entry. Accepts either an AMP-shape or internal-shape object.
 * Always writes AMP shape to disk. Returns the AMP-shape entry that was written.
 *
 * As of v0.44 the destination depends on the entry's `type` (and optional
 * `target` override) — see `destinationFile()` for the routing rule.
 *
 * Mirroring policy: every entry is also appended to the legacy
 * `sessions.jsonl` (when its destination differs). The current marketplace
 * extension's file watcher only listens to sessions.jsonl, so without
 * this mirror, branch-routed writes are invisible in its sidebar. Reads
 * dedupe by AMP id, so the same entry appearing in both files is a no-op
 * at the consumer layer. Will be removed once the extension watches the
 * branch-aware layout natively.
 */
export function appendEntry(cwd, entry) {
  ensureAmpDir(cwd);
  const p   = ampPaths(cwd, { forWrite: true });
  const dest = destinationFile(p, entry);
  const amp  = toAmp(entry);
  const line = JSON.stringify(amp) + "\n";
  // Primary write — the routed destination (branch / global / legacy).
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.appendFileSync(dest, line, "utf8");
  // Mirror to legacy sessions.jsonl for live-watcher visibility.
  if (dest !== p.sessions) {
    try {
      fs.mkdirSync(path.dirname(p.sessions), { recursive: true });
      fs.appendFileSync(p.sessions, line, "utf8");
    } catch { /* mirror is best-effort; primary write is the source of truth */ }
  }
  return amp;
}

/**
 * Forget (hard-delete) an entry by exact AMP id across EVERY memory file.
 * Writes are mirrored (routed branch/global file + legacy sessions.jsonl), so
 * an id can live in more than one file; we strip it from all of them so the
 * entry is truly gone — otherwise the merged reader would resurrect it from a
 * mirror. Returns { removed, files } (files = which paths were rewritten).
 */
export function deleteEntry(cwd, id) {
  if (!id) return { removed: 0, files: [] };
  const p = ampPaths(cwd);
  const candidates = [p.sessions, p.globalFile, p.currentBranchFile, p.defaultBranchFile].filter(Boolean);
  try {
    if (fs.existsSync(p.branchesDir)) {
      for (const name of fs.readdirSync(p.branchesDir)) {
        if (name.endsWith(".jsonl")) candidates.push(path.join(p.branchesDir, name));
      }
    }
  } catch { /* unreadable dir is fine */ }

  const files = [...new Set(candidates)];
  let removed = 0;
  const touched = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let lines;
    try { lines = fs.readFileSync(file, "utf8").split("\n"); } catch { continue; }
    const kept = [];
    let fileRemoved = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsedId;
      try { parsedId = JSON.parse(line).id; } catch { kept.push(line); continue; }
      if (parsedId === id) { fileRemoved++; removed++; continue; }
      kept.push(line);
    }
    if (fileRemoved > 0) {
      fs.writeFileSync(file, kept.length ? kept.join("\n") + "\n" : "", "utf8");
      touched.push(file);
    }
  }
  return { removed, files: touched };
}

// ── amp.json config ──────────────────────────────────────────────────────────

export function readConfig(cwd) {
  const { config } = ampPaths(cwd);
  try { return JSON.parse(fs.readFileSync(config, "utf8")); } catch { return null; }
}

export function writeDefaultConfig(cwd, overrides = {}) {
  ensureAmpDir(cwd);
  const { config } = ampPaths(cwd, { forWrite: true });
  if (fs.existsSync(config)) return false; // don't clobber
  const data = {
    amp: AMP_VERSION,
    project: overrides.project || path.basename(cwd),
    stack: overrides.stack || {},
    config: {
      autoCapture: true,
      maxEntries: 1000,
      rotationStrategy: "archive",
      inject: ["all"],
      ...(overrides.config || {}),
    },
  };
  fs.writeFileSync(config, JSON.stringify(data, null, 2) + "\n", "utf8");
  return true;
}

// ── Migration ────────────────────────────────────────────────────────────────

/**
 * Idempotent migration of a legacy `inferno/sessions.jsonl` to
 * `.ai-memory/sessions.jsonl` in AMP shape. Leaves the original alone so
 * nothing breaks if the user rolls back. Returns a small summary object.
 */
export function migrateLegacy(cwd) {
  const legacyDir  = path.join(cwd, "inferno");
  const legacySess = path.join(legacyDir, "sessions.jsonl");
  if (!fs.existsSync(legacySess)) return { migrated: 0, reason: "no legacy sessions.jsonl" };

  const ampDir  = path.join(cwd, ".ai-memory");
  const ampSess = path.join(ampDir, "sessions.jsonl");
  if (fs.existsSync(ampSess)) return { migrated: 0, reason: ".ai-memory/sessions.jsonl already exists" };

  ensureAmpDir(cwd);
  const lines = fs.readFileSync(legacySess, "utf8").split("\n").filter(Boolean);
  let count = 0;
  for (const line of lines) {
    try {
      const internal = JSON.parse(line);
      const amp = toAmp(internal);
      fs.appendFileSync(ampSess, JSON.stringify(amp) + "\n", "utf8");
      count++;
    } catch { /* skip unparseable */ }
  }
  // Drop a marker so users see what happened
  fs.writeFileSync(
    path.join(ampDir, "MIGRATED.md"),
    `# Migrated from inferno/\n\nCopied ${count} entries from inferno/sessions.jsonl on ${new Date().toISOString()}.\n` +
    `\nThe original inferno/sessions.jsonl is untouched. You can delete it once you're confident the new layout works.\n`,
    "utf8",
  );
  return { migrated: count, reason: "ok" };
}
