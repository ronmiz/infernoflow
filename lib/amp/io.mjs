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
import * as path from "node:path";

// ── Constants ────────────────────────────────────────────────────────────────

export const AMP_VERSION = "1.0";

export const AMP_MARKERS = {
  start: "<!-- AMP:START -->",
  end:   "<!-- AMP:END -->",
};

const AMP_TYPES = new Set(["gotcha", "decision", "attempt", "note", "detection", "pattern"]);
const AMP_TOOLS = new Set(["copilot", "cursor", "claude", "windsurf", "other"]);

// ── Paths ────────────────────────────────────────────────────────────────────

/**
 * Returns the canonical AMP paths for a given workspace.
 * Prefers .ai-memory/ if it exists; falls back to inferno/ for legacy reads.
 * For writes, always use {forWrite: true} so we target the new layout.
 */
export function ampPaths(cwd, opts = {}) {
  const ampDir   = path.join(cwd, ".ai-memory");
  const legacyDir = path.join(cwd, "inferno");

  const useAmp = opts.forWrite || fs.existsSync(ampDir) || !fs.existsSync(legacyDir);
  const root   = useAmp ? ampDir : legacyDir;
  const isAmp  = useAmp;

  return {
    root,
    isAmp,
    sessions: path.join(root, "sessions.jsonl"),
    config:   path.join(root, isAmp ? "amp.json"    : "config.json"),
    handoff:  path.join(root, isAmp ? "handoff.md"  : "HANDOFF.md"),
  };
}

export function ensureAmpDir(cwd) {
  const dir = path.join(cwd, ".ai-memory");
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

export function readEntries(cwd) {
  const { sessions } = ampPaths(cwd);
  if (!fs.existsSync(sessions)) return [];
  return fs.readFileSync(sessions, "utf8")
    .split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .map(fromAmp);  // normalize to internal shape
}

/**
 * Append an entry. Accepts either an AMP-shape or internal-shape object.
 * Always writes AMP shape to disk. Returns the AMP-shape entry that was written.
 */
export function appendEntry(cwd, entry) {
  ensureAmpDir(cwd);
  const { sessions } = ampPaths(cwd, { forWrite: true });
  const amp = toAmp(entry);
  fs.appendFileSync(sessions, JSON.stringify(amp) + "\n", "utf8");
  return amp;
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
