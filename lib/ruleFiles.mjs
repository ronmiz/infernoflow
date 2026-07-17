/**
 * lib/ruleFiles.mjs — write `.cursorrules` / `CLAUDE.md` / `.github/copilot-instructions.md`
 * with the "Memory protocol" skill block injected.
 *
 * Used by:
 *   - `infernoflow init` (writes minimal stub — protocol block + empty memory note)
 *   - VS Code extension auto-sync (writes the richer ranked-memory version)
 *
 * Both writers use the same delimiter markers so the extension can overwrite
 * the init stub without leaving duplicate sections behind.
 *
 * Why this exists:
 *   Before, rule files were only written by the VS Code extension. CLI-only
 *   users (Cursor / Claude Code without our extension) got `.ai-memory/` but
 *   no rule files → AIs had no Memory protocol skill in their context → never
 *   called amp_write proactively. This file closes that gap.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { readEntries as ampReadMerged, readConfig } from "./amp/io.mjs";

const SECTION_START = "<!-- infernoflow:start -->";
const SECTION_END   = "<!-- infernoflow:end -->";

const RULE_FILES = [
  ".cursorrules",
  "CLAUDE.md",
  path.join(".github", "copilot-instructions.md"),
];

// ── Injection token budget ──────────────────────────────────────────────────
// The memory block is paid for on every AI turn (and twice when a tool loads
// both CLAUDE.md and copilot-instructions.md). Defaults are deliberately lean;
// users override per-project via `.ai-memory/amp.json` → config.injection, or
// `infernoflow setup --max-memory N`. NOTE: keep these in sync with the
// extension's copy in vscode-extension/src/contextSync.ts (separate codebase,
// can't share an import).
const DEFAULT_ENTRY_CAP   = 4;
const DEFAULT_COMMIT_CAP  = 5;
const DEFAULT_ENTRY_CHARS = 200;

/**
 * Map amp.json config → effective injection settings (pure; no I/O). Each key
 * independently defaulted so a partial `injection: { maxEntries: 3 }` works.
 * Backward compat: a legacy non-["all"] `config.inject` array is honored as a
 * target subset when `injection.targets` is absent.
 */
export function resolveInjectionSettings(cfg) {
  const c   = (cfg && cfg.config) || {};
  const inj = (c.injection && typeof c.injection === "object") ? c.injection : {};
  const legacyTargets = Array.isArray(c.inject) && !c.inject.includes("all") ? c.inject : null;
  // protocolStyle: "compact" (default) emits a ~3-line summary — the full
  // trigger table is redundant with the amp_* tool descriptions the model
  // already sees, so we don't pay for it on every turn. "full" restores the
  // table; "off" (or the legacy includeProtocol:false) omits it entirely.
  const styleRaw = ["full", "compact", "off"].includes(inj.protocolStyle) ? inj.protocolStyle : "compact";
  const protocolStyle = inj.includeProtocol === false ? "off" : styleRaw;
  return {
    maxEntries:    Number.isInteger(inj.maxEntries)    && inj.maxEntries    >= 0 ? inj.maxEntries    : DEFAULT_ENTRY_CAP,
    maxCommits:    Number.isInteger(inj.maxCommits)    && inj.maxCommits    >= 0 ? inj.maxCommits    : DEFAULT_COMMIT_CAP,
    maxEntryChars: Number.isInteger(inj.maxEntryChars) && inj.maxEntryChars  > 0 ? inj.maxEntryChars : DEFAULT_ENTRY_CHARS,
    targets:       Array.isArray(inj.targets) && inj.targets.length ? inj.targets : (legacyTargets || RULE_FILES),
    protocolStyle,
    includeProtocol: protocolStyle !== "off",
  };
}

/** Remove the infernoflow-managed block from a file (used when a target is
 *  de-selected, so it doesn't go stale). Returns { stripped }. */
function stripManagedBlock(absPath) {
  if (!fs.existsSync(absPath)) return { stripped: false };
  const text = fs.readFileSync(absPath, "utf8");
  const startIdx = text.indexOf(SECTION_START);
  const endIdx   = text.indexOf(SECTION_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return { stripped: false };
  const before = text.slice(0, startIdx).replace(/\s+$/, "");
  const after  = text.slice(endIdx + SECTION_END.length).replace(/^\s+/, "");
  const next   = before && after ? before + "\n\n" + after : (before || after);
  fs.writeFileSync(absPath, next ? next.replace(/\s*$/, "") + "\n" : "", "utf8");
  return { stripped: true };
}

/**
 * The "Memory protocol" skill block. Two styles:
 *   - "compact" (default): a ~3-line summary. The full per-trigger table is
 *     redundant with the amp_write / amp_bookmark tool `modelDescription`s the
 *     model already sees, so we don't re-pay for it on every turn.
 *   - "full": the complete trigger table (for non-MCP / cold-start setups).
 * Kept byte-identical with the extension's copy in contextSync.ts.
 */
function memoryProtocolBlock(style = "compact") {
  if (style === "off") return "";
  return style === "full" ? memoryProtocolBlockFull() : memoryProtocolBlockCompact();
}

function memoryProtocolBlockCompact() {
  return [
    "### Memory protocol",
    "",
    "Use the `amp_write` and `amp_bookmark` MCP tools **proactively** (without being asked): log a one-sentence entry when the user hits frustration (`!!` / \"not working\" / \"retry\" → `attempt`), a `decision` is made, or you learn a non-obvious `gotcha`; drop a bookmark on \"bookmark this\". Don't log what's re-derivable from the code. The full trigger list and field shapes are in the tool descriptions — if the `amp_*` tools aren't visible, load them first (Claude Code: `ToolSearch` with query `infernoflow`).",
  ].join("\n");
}

function memoryProtocolBlockFull() {
  const lines = [];
  lines.push("### Memory protocol — capture as you go");
  lines.push("");
  lines.push("You have the `amp_write` MCP tool. **Use it proactively** (without the user asking) whenever you detect any of these moments. Capture the lesson in one sentence so the next AI session inherits it.");
  lines.push("");
  lines.push("**If `amp_write` is not in your visible tools**, your client uses deferred MCP loading — call your tool-discovery mechanism (Claude Code: `ToolSearch` with query `infernoflow`) to load the `amp_*` tools BEFORE proceeding. Don't silently skip the protocol because the tool isn't visible yet.");
  lines.push("");
  lines.push("| When you see… | Call `amp_write` with… |");
  lines.push("|---|---|");
  lines.push("| User types `!!`, `!!!`, `not working`, `still broken`, `no change`, `same error`, `retry` / `retrying`, repeated frustration | `{type: 'attempt', msg: '<one-line: what was tried and how it failed>', file: '<active file>'}` |");
  lines.push("| You generate a plan, numbered steps, or `Plan:` / `Approach:` block | `{type: 'note', msg: 'Plan: <one-line summary>', file: '<focus file>'}` |");
  lines.push("| User picks X over Y, decides an architectural approach, or you both agree on a direction | `{type: 'decision', msg: '<X> chosen over <Y> because <reason>', file: '<file>'}` |");
  lines.push("| Discovered non-obvious behavior, API quirk, or `aha — turns out…` moment | `{type: 'gotcha', msg: '<one-line>', file: '<file>', line: <line if known>}` |");
  lines.push("| User says `switching` / `back to X`, or ~30 min passed without logging | `{type: 'note', msg: 'Session snapshot — worked on: <X>. Open threads: <Y>.'}` |");
  lines.push("");
  lines.push("**Do NOT log:** typos, syntax errors, obvious bugs visible in the code, anything the next AI can infer by re-reading the file.");
  lines.push("**Do log:** anything that taught you something non-derivable from code.");
  lines.push("**Be concise:** entries should be one sentence. Future-you will skim them.");
  lines.push("**Bookmark resume points:** when the user says `bookmark this` / `mark this point`, or the context window is filling up while work is mid-flight, call `amp_bookmark` with a short `label` (omit `note` to auto-capture the session transcript) — so they can jump back to that exact point in the next session.");
  lines.push("**When you use a 🔥 memory entry in your reply, briefly cite it** — e.g. `🔥 (from infernoflow memory) gotcha at src/api.js:42: ...` — so the user can see which guidance came from project memory vs. your own inference.");
  return lines.join("\n");
}

/**
 * Build the full infernoflow-managed section as a string. No memory entries
 * are read here — the extension's ranking pass adds those later. This is the
 * stub that ships at `init` time, before any gotchas have been logged.
 */
function buildInitSection(protocolStyle = "compact") {
  const protocol = memoryProtocolBlock(protocolStyle);
  return [
    SECTION_START,
    "<!-- Auto-managed by infernoflow. Don't edit between these markers. -->",
    "## Project memory (infernoflow)",
    "",
    ...(protocol ? [protocol, ""] : []),
    "_No entries yet. They'll appear here as you and your AI tools log them — run `infernoflow log \"...\"` or call `amp_write` from any MCP-aware AI._",
    SECTION_END,
  ].join("\n");
}

/**
 * Write/refresh a single rule file. Idempotent — if the file exists and already
 * has an infernoflow-managed section, that section is replaced; everything
 * outside the markers is preserved. New files get just the managed section.
 */
// v0.43 wrote a second managed block `<!-- AMP:START --> ... <!-- AMP:END -->`
// in parallel with `<!-- infernoflow:start -->`. The v0.44 single-writer
// policy retired AMP:START, but projects upgrading from 0.43.x still have
// the orphan block in their CLAUDE.md / .cursorrules / copilot-instructions.md.
// upsertRuleFile strips it as part of the regular write so the orphan
// clears on the first refresh after upgrade.
function stripLegacyAmpBlock(text) {
  const startIdx = text.indexOf("<!-- AMP:START -->");
  const endIdx   = text.indexOf("<!-- AMP:END -->");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return text;
  const before = text.slice(0, startIdx).replace(/\s+$/, "");
  const after  = text.slice(endIdx + "<!-- AMP:END -->".length).replace(/^\s+/, "");
  return (before ? before + (after ? "\n\n" : "") : "") + after;
}

function upsertRuleFile(absPath, section) {
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(absPath)) {
    fs.writeFileSync(absPath, section + "\n", "utf8");
    return { created: true, updated: false };
  }

  let existing = fs.readFileSync(absPath, "utf8");
  // Strip the legacy AMP:START block first so any subsequent index math is
  // computed against the post-cleanup text.
  existing = stripLegacyAmpBlock(existing);
  const startIdx = existing.indexOf(SECTION_START);
  const endIdx   = existing.indexOf(SECTION_END);

  // No managed section yet — append at the top with a blank line separator
  if (startIdx === -1 || endIdx === -1) {
    const next = section + "\n\n" + existing;
    fs.writeFileSync(absPath, next, "utf8");
    return { created: false, updated: true };
  }

  // Replace the existing managed section in place
  const before = existing.slice(0, startIdx);
  const after  = existing.slice(endIdx + SECTION_END.length);
  const next   = before + section + after;
  if (next === existing) return { created: false, updated: false };
  fs.writeFileSync(absPath, next, "utf8");
  return { created: false, updated: true };
}

/**
 * Write all three rule files at `cwd`. Returns a list of what changed so the
 * caller can print a summary.
 */
export function writeInitRuleFiles(cwd) {
  const { protocolStyle } = resolveInjectionSettings(readConfig(cwd));
  const section = buildInitSection(protocolStyle);
  const results = [];
  for (const rel of RULE_FILES) {
    const abs = path.join(cwd, rel);
    try {
      const r = upsertRuleFile(abs, section);
      results.push({ rel, ...r });
    } catch (err) {
      results.push({ rel, error: err.message });
    }
  }
  return results;
}

// ── Memory-aware rule-file rebuild (CLI-side; mirrors extension behavior) ────
// Why this exists:
//   Up to now the CLI wrote the rule-file stub once at init/upgrade time, and
//   we relied on the VS Code extension to auto-refresh the file whenever new
//   memory was logged. That made the extension a hard dependency for "AI sees
//   the latest gotchas." Cursor / Claude Code / Copilot users without our
//   extension got a rule file frozen at init time — every new `infernoflow log`
//   was invisible to their AI. This function closes that gap from the CLI,
//   so any tool that reads the rule file at chat start gets fresh memory
//   regardless of whether our extension is installed.
//
// Scope:
//   The CLI doesn't have an "active file" concept (no editor state), so it
//   can't do the per-file relevance ranking the extension does. Instead it
//   shows the most recent N entries (newest first) plus the most recent N
//   git commits. Good enough for "what's been happening lately" — which is
//   the new-chat handoff use case.

function readSessionsJsonl(cwd) {
  // Branch-aware merged read (v0.44+): the lib's readEntries unions across
  // legacy sessions.jsonl + global.jsonl + branches/<current>.jsonl +
  // branches/<default>.jsonl, dedupes by id, and sorts by ts. Single source
  // of truth so any future storage change here is centralised in amp/io.mjs.
  return ampReadMerged(cwd);
}

function readRecentCommits(cwd, limit = 10) {
  // Cheap git log read. Failure modes: no git, not in a repo, git not on
  // PATH. All are silently OK — the function returns []. Never throws.
  try {
    // Use child_process synchronously — we're already on the CLI cold path,
    // an extra ~50ms is invisible.
    const out = execSync(
      `git log --pretty=format:"%h%x09%ad%x09%s" --date=short -n ${limit}`,
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.split("\n").filter(Boolean).map(line => {
      const [hash, date, subject] = line.split("\t");
      return { hash: (hash || "").slice(0, 7), date: date || "", subject: subject || "" };
    });
  } catch {
    return [];
  }
}

function buildMemoryAwareSection(cwd, opts = {}) {
  const {
    maxEntries      = DEFAULT_ENTRY_CAP,
    maxCommits      = DEFAULT_COMMIT_CAP,
    maxEntryChars   = DEFAULT_ENTRY_CHARS,
    protocolStyle   = "compact",
    includeProtocol = true,
  } = opts;
  const entries = readSessionsJsonl(cwd);
  const commits = readRecentCommits(cwd, maxCommits);

  // Sort entries newest-first; the CLI has no "active file" to rank against,
  // so recency is the best ordering. Extension users get the smart ranking;
  // this is the no-extension fallback.
  entries.sort((a, b) => {
    const ta = typeof a.ts === "number" ? a.ts : Date.parse(a.ts || 0);
    const tb = typeof b.ts === "number" ? b.ts : Date.parse(b.ts || 0);
    return tb - ta;
  });
  const recent = entries.slice(0, maxEntries);

  const ICON = {
    gotcha: "⚠", decision: "✓", attempt: "✗", note: "·",
    detection: "○", pattern: "◇",
  };

  const lines = [];
  lines.push(SECTION_START);
  lines.push("<!-- Auto-managed by infernoflow. Don't edit between these markers. -->");
  lines.push("## Project memory (infernoflow)");
  lines.push("");
  if (includeProtocol && protocolStyle !== "off") {
    lines.push(memoryProtocolBlock(protocolStyle));
    lines.push("");
  }

  if (commits.length > 0) {
    lines.push("### Recent commits");
    for (const c of commits) {
      lines.push(`- \`${c.hash}\` _${c.date}_ ${c.subject}`);
    }
    lines.push("");
  }

  if (recent.length > 0) {
    lines.push("### Recent memory");
    for (const e of recent) {
      const fileRef = e.file ? ` (\`${e.file}${e.line ? ":" + e.line : ""}\`)` : "";
      const rawMsg = (e.msg || e.summary || "").replace(/\n/g, " ");
      const msg = maxEntryChars && rawMsg.length > maxEntryChars
        ? rawMsg.slice(0, maxEntryChars).trimEnd() + "…"
        : rawMsg;
      lines.push(`- 🔥 ${ICON[e.type] || "·"} **${e.type || "note"}**${fileRef}: ${msg}`);
    }
    lines.push("");
  }

  if (entries.length === 0 && commits.length === 0) {
    lines.push("_No entries yet. They'll appear here as you and your AI tools log them — run `infernoflow log \"...\"` or call `amp_write` from any MCP-aware AI._");
  }

  lines.push(SECTION_END);
  return lines.join("\n");
}

/**
 * Refresh rule files using actual memory + recent commits. Designed to be
 * called every time memory changes (e.g. inside `infernoflow log`) so the
 * AI's view of the project stays current without needing our extension.
 * Idempotent and non-fatal.
 */
export function refreshRuleFilesFromMemory(cwd) {
  const settings  = resolveInjectionSettings(readConfig(cwd));
  const section   = buildMemoryAwareSection(cwd, settings);
  const norm      = (s) => String(s).replace(/\\/g, "/");
  const targetSet = new Set(settings.targets.map(norm));
  const results = [];
  for (const rel of RULE_FILES) {
    const abs = path.join(cwd, rel);
    try {
      if (targetSet.has(norm(rel))) {
        const r = upsertRuleFile(abs, section);
        results.push({ rel, ...r });
      } else {
        // De-selected target — strip any managed block we wrote on a prior run
        // so it doesn't sit there stale forever.
        const r = stripManagedBlock(abs);
        if (r.stripped) results.push({ rel, stripped: true });
      }
    } catch (err) {
      results.push({ rel, error: err.message });
    }
  }
  return results;
}
