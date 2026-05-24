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
import { readEntries as ampReadMerged } from "./amp/io.mjs";

const SECTION_START = "<!-- infernoflow:start -->";
const SECTION_END   = "<!-- infernoflow:end -->";

const RULE_FILES = [
  ".cursorrules",
  "CLAUDE.md",
  path.join(".github", "copilot-instructions.md"),
];

/**
 * The "Memory protocol" skill block — same wording the extension injects so the
 * AI sees the same instructions whether it's reading the init stub or the
 * extension's richer auto-synced version.
 */
function memoryProtocolBlock() {
  const lines = [];
  lines.push("### Memory protocol — capture as you go");
  lines.push("");
  lines.push("You have the `amp_write` MCP tool. **Use it proactively** (without the user asking) whenever you detect any of these moments. Capture the lesson in one sentence so the next AI session inherits it.");
  lines.push("");
  lines.push("| When you see… | Call `amp_write` with… |");
  lines.push("|---|---|");
  lines.push("| User types `!!!`, `not working`, `still broken`, `no change`, `same error`, repeated frustration | `{type: 'attempt', msg: '<one-line: what was tried and how it failed>', file: '<active file>'}` |");
  lines.push("| You generate a plan, numbered steps, or `Plan:` / `Approach:` block | `{type: 'note', msg: 'Plan: <one-line summary>', file: '<focus file>'}` |");
  lines.push("| User picks X over Y, decides an architectural approach, or you both agree on a direction | `{type: 'decision', msg: '<X> chosen over <Y> because <reason>', file: '<file>'}` |");
  lines.push("| Discovered non-obvious behavior, API quirk, or `aha — turns out…` moment | `{type: 'gotcha', msg: '<one-line>', file: '<file>', line: <line if known>}` |");
  lines.push("| User says `switching` / `back to X`, or ~30 min passed without logging | `{type: 'note', msg: 'Session snapshot — worked on: <X>. Open threads: <Y>.'}` |");
  lines.push("");
  lines.push("**Do NOT log:** typos, syntax errors, obvious bugs visible in the code, anything the next AI can infer by re-reading the file.");
  lines.push("**Do log:** anything that taught you something non-derivable from code.");
  lines.push("**Be concise:** entries should be one sentence. Future-you will skim them.");
  return lines.join("\n");
}

/**
 * Build the full infernoflow-managed section as a string. No memory entries
 * are read here — the extension's ranking pass adds those later. This is the
 * stub that ships at `init` time, before any gotchas have been logged.
 */
function buildInitSection() {
  return [
    SECTION_START,
    "<!-- Auto-managed by infernoflow. Don't edit between these markers. -->",
    "## Project memory (infernoflow)",
    "",
    memoryProtocolBlock(),
    "",
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
  const section = buildInitSection();
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

function buildMemoryAwareSection(cwd, entryCap = 10, commitCap = 10) {
  const entries = readSessionsJsonl(cwd);
  const commits = readRecentCommits(cwd, commitCap);

  // Sort entries newest-first; the CLI has no "active file" to rank against,
  // so recency is the best ordering. Extension users get the smart ranking;
  // this is the no-extension fallback.
  entries.sort((a, b) => {
    const ta = typeof a.ts === "number" ? a.ts : Date.parse(a.ts || 0);
    const tb = typeof b.ts === "number" ? b.ts : Date.parse(b.ts || 0);
    return tb - ta;
  });
  const recent = entries.slice(0, entryCap);

  const ICON = {
    gotcha: "⚠", decision: "✓", attempt: "✗", note: "·",
    detection: "○", pattern: "◇",
  };

  const lines = [];
  lines.push(SECTION_START);
  lines.push("<!-- Auto-managed by infernoflow. Don't edit between these markers. -->");
  lines.push("## Project memory (infernoflow)");
  lines.push("");
  lines.push(memoryProtocolBlock());
  lines.push("");

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
      const msg = (e.msg || e.summary || "").replace(/\n/g, " ");
      lines.push(`- ${ICON[e.type] || "·"} **${e.type || "note"}**${fileRef}: ${msg}`);
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
  const section = buildMemoryAwareSection(cwd);
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
