/**
 * Memory maintenance (0.46.5) — notice when memory needs care, and either
 * suggest the command (default) or do the safe part automatically.
 *
 * Config (`.ai-memory/amp.json` → config.maintenance):
 *   "suggest"  (default) show a short hint in session-start, status and recap
 *   "auto"     clean noise and archive old notes by itself, at most once a day;
 *              stale entries are still only suggested (a person decides those)
 *   "off"      no hints, nothing automatic
 *   or { "mode": "suggest", "thresholds": { "curate": 3, "stale": 3, "prune": 20 } }
 *
 * Automatic maintenance never resolves entries and never touches gotchas,
 * decisions or patterns: curate only removes noise (commit-subject notes,
 * exact duplicates, misfired hook prompts) after archiving it, and prune only
 * moves old notes / attempts / detections to .ai-memory/archive/.
 */
import * as fs   from "node:fs";
import * as path from "node:path";
import { readConfig, readEntries, pruneEntries, ampPaths } from "./amp/io.mjs";
import { isNoise, isResolved, isStale } from "./memoryView.mjs";
import { findProjectRoot } from "./projectRoot.mjs";
import { curateCandidates, applyCurate } from "./commands/curate.mjs";

export const MAINTENANCE_MODES = ["suggest", "auto", "off"];
export const DEFAULT_THRESHOLDS = { curate: 3, stale: 3, prune: 20 };
export const STATE_FILE = ".maintenance-state.json";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalised { mode, thresholds } from amp.json (string or object form). */
export function maintenanceSettings(cfg) {
  const raw = cfg && cfg.config ? cfg.config.maintenance : undefined;
  const obj = typeof raw === "string" ? { mode: raw } : (raw && typeof raw === "object" ? raw : {});
  const mode = MAINTENANCE_MODES.includes(obj.mode) ? obj.mode : "suggest";
  const t = obj.thresholds && typeof obj.thresholds === "object" ? obj.thresholds : {};
  const num = (v, d) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : d);
  return {
    mode,
    thresholds: {
      curate: num(t.curate, DEFAULT_THRESHOLDS.curate),
      stale:  num(t.stale,  DEFAULT_THRESHOLDS.stale),
      prune:  num(t.prune,  DEFAULT_THRESHOLDS.prune),
    },
  };
}

/** Counts of what could be cleaned: { curate, stale, prune }. Never writes. */
export function maintenanceSignals(cwd) {
  const out = { curate: 0, stale: 0, prune: 0 };
  try {
    const c = curateCandidates(cwd);
    out.curate = c.commitNotes.length + c.duplicates.length + c.misfiredHook.length
               + c.oldFrustration.length + (c.autoSnapshots || []).length;
  } catch { /* unreadable store — no signal */ }
  try {
    const root = findProjectRoot(cwd);
    out.stale = readEntries(cwd).filter(e => e.file && !isNoise(e) && !isResolved(e) && isStale(root, e)).length;
  } catch { /* not a git repo etc. */ }
  try { out.prune = pruneEntries(cwd, { dryRun: true }).archived || 0; } catch { /* ignore */ }
  return out;
}

/**
 * What to suggest right now: [{ kind, count, command, text }].
 * In auto mode only "stale" is suggested — the rest is done automatically.
 * @param {string} cwd
 * @param {{ settings?: any, signals?: { curate: number, stale: number, prune: number } }} [opts]
 */
export function maintenanceSuggestions(cwd, { settings, signals } = {}) {
  const s = settings || maintenanceSettings(readConfig(cwd));
  if (s.mode === "off") return [];
  const sig = signals || maintenanceSignals(cwd);
  const out = [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (s.mode === "suggest" && sig.curate >= s.thresholds.curate) {
    out.push({ kind: "curate", count: sig.curate, command: "infernoflow curate --apply",
      text: `${plural(sig.curate, "noisy entry", "noisy entries")} (duplicates, commit notes, machine text)` });
  }
  if (sig.stale >= s.thresholds.stale) {
    out.push({ kind: "stale", count: sig.stale, command: "infernoflow resume",
      text: `${plural(sig.stale, "entry is", "entries are")} about files that changed since — review, then resolve the outdated ones` });
  }
  if (s.mode === "suggest" && sig.prune >= s.thresholds.prune) {
    out.push({ kind: "prune", count: sig.prune, command: "infernoflow prune --apply",
      text: `${plural(sig.prune, "old note", "old notes")} could move to the archive` });
  }
  return out;
}

// ── throttle state (.ai-memory/.maintenance-state.json, gitignored) ─────────

function statePath(cwd) {
  return path.join(ampPaths(cwd).root, STATE_FILE);
}
export function readMaintenanceState(cwd) {
  try { return JSON.parse(fs.readFileSync(statePath(cwd), "utf8")) || {}; } catch { return {}; }
}
function writeState(cwd, patch) {
  try {
    const next = { ...readMaintenanceState(cwd), ...patch };
    fs.writeFileSync(statePath(cwd), JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch { /* best effort */ }
}

/** Session-start hints are shown at most once a day. */
export function shouldShowHint(cwd, now = Date.now()) {
  const last = Number(readMaintenanceState(cwd).lastHintAt) || 0;
  return now - last >= DAY_MS;
}
export function markHintShown(cwd, now = Date.now()) {
  writeState(cwd, { lastHintAt: now });
}

/**
 * Auto mode: clean noise and archive old notes, at most once a day.
 * Returns null when nothing ran, else { removed, cleaned, archived }.
 * @param {string} cwd
 * @param {{ now?: number, settings?: any }} [opts]
 */
export function runAutoMaintenance(cwd, { now = Date.now(), settings } = {}) {
  const s = settings || maintenanceSettings(readConfig(cwd));
  if (s.mode !== "auto") return null;
  const last = Number(readMaintenanceState(cwd).lastAutoAt) || 0;
  if (now - last < DAY_MS) return null;
  writeState(cwd, { lastAutoAt: now });
  const sig = maintenanceSignals(cwd);
  const result = { removed: 0, cleaned: 0, archived: 0 };
  if (sig.curate >= s.thresholds.curate) {
    try { const r = applyCurate(cwd); result.removed = r.removed; result.cleaned = r.cleaned; } catch { /* best effort */ }
  }
  if (sig.prune >= s.thresholds.prune) {
    try { result.archived = pruneEntries(cwd).archived || 0; } catch { /* best effort */ }
  }
  return result.removed || result.cleaned || result.archived ? result : null;
}

/** One-line summary of what auto mode just did. */
export function describeAutoResult(r) {
  if (!r) return null;
  const parts = [];
  if (r.removed)  parts.push(`removed ${r.removed} noisy entr${r.removed === 1 ? "y" : "ies"} (archived)`);
  if (r.cleaned)  parts.push(`cleaned ${r.cleaned} resume point${r.cleaned === 1 ? "" : "s"}`);
  if (r.archived) parts.push(`moved ${r.archived} old note${r.archived === 1 ? "" : "s"} to the archive`);
  return parts.join(", ");
}

/** Markdown section for the SessionStart context, or "" when there's nothing to say. */
export function renderMaintenanceSection(suggestions, autoResult) {
  const lines = [];
  const done = describeAutoResult(autoResult);
  if (done) lines.push(`- Automatic maintenance ran: ${done}.`);
  for (const s of suggestions) lines.push(`- ${s.text}: \`${s.command}\``);
  if (!lines.length) return "";
  return [
    "## Memory maintenance",
    "",
    ...lines,
    "",
    suggestions.length
      ? "_Mention this to the user once, briefly. Don't run these commands without asking. Turn hints off with `\"maintenance\": \"off\"` in .ai-memory/amp.json._"
      : "",
  ].filter((l, i, a) => !(l === "" && i === a.length - 1)).join("\n");
}
