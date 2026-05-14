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
function upsertRuleFile(absPath, section) {
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(absPath)) {
    fs.writeFileSync(absPath, section + "\n", "utf8");
    return { created: true, updated: false };
  }

  const existing = fs.readFileSync(absPath, "utf8");
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
