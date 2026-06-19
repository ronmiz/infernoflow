/**
 * contextSync — close the injection loop.
 *
 * Memory is captured beautifully, but the AI only benefits if it actually
 * reads the right gotchas at the right time. After 50+ entries, dumping
 * everything into CLAUDE.md / .cursorrules makes the AI ignore most of it.
 *
 * This module:
 *   1. Ranks memory entries by relevance to the file the user is currently
 *      editing.
 *   2. Pulls the last N git commits (with file lists for the most recent 5).
 *   3. Stitches both into the infernoflow-managed sections of
 *      .cursorrules / CLAUDE.md / .github/copilot-instructions.md so the
 *      next AI session sees: recent commits → relevant memory → older context.
 *
 * Public API:
 *
 *   - rankedForFile(activeFile)
 *       Returns memory entries sorted by relevance score (newest as tiebreaker).
 *
 *   - rebuildAiRuleFiles(activeFile?)
 *       Rebuilds all three rule files. Idempotent — uses delimiter comments
 *       to find and replace its own section, preserves the rest.
 *
 * Relevance scoring (for memory entries):
 *   - Same file               +100
 *   - Same directory          + 40
 *   - Same file extension     + 10
 *   - Logged in last 7 days   + 20 bonus
 *   - Type-weighted: gotcha 1.5x, attempt 1.2x, decision 1.0x, note 0.6x
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ampIO } from "./amp";
import type { AMPEntry } from "infernoflow-amp";

const RULE_FILES = [
  ".cursorrules",
  "CLAUDE.md",
  path.join(".github", "copilot-instructions.md"),
];

const SECTION_START = "<!-- infernoflow:start -->";
const SECTION_END   = "<!-- infernoflow:end -->";

// ── Ranking ──────────────────────────────────────────────────────────────────

interface ScoredEntry {
  entry: AMPEntry;
  score: number;
}

export function rankedForFile(activeFile: string | undefined): ScoredEntry[] {
  const all = ampIO.readEntries();
  if (all.length === 0) return [];

  const norm = (p: string) => p.replace(/\\/g, "/");
  const activeRel = activeFile ? norm(activeFile) : "";
  const activeDir = activeRel ? path.posix.dirname(activeRel) : "";
  const activeExt = activeRel ? path.posix.extname(activeRel) : "";

  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  const scored: ScoredEntry[] = all.map(e => {
    let score = 0;

    if (activeRel && e.file) {
      const ef = norm(e.file);
      if (ef === activeRel || ef.endsWith("/" + activeRel) || activeRel.endsWith("/" + ef)) {
        score += 100;
      } else if (activeDir && path.posix.dirname(ef) === activeDir) {
        score += 40;
      } else if (activeExt && path.posix.extname(ef) === activeExt) {
        score += 10;
      }
    }

    if (now - e.ts < SEVEN_DAYS) score += 20;

    const typeWeight: Record<string, number> = {
      gotcha: 1.5, attempt: 1.2, decision: 1.0, note: 0.6, detection: 0.8, pattern: 0.8,
    };
    score *= (typeWeight[e.type] ?? 1.0);

    return { entry: e, score };
  });

  // Newest first as tiebreaker — desc by score, then desc by ts
  scored.sort((a, b) => (b.score - a.score) || (b.entry.ts - a.entry.ts));
  return scored;
}

// ── Recent git commits (cheap snapshot for AI context) ──────────────────────

interface GitCommit {
  hash:    string;
  date:    string;     // ISO short, e.g. "2026-05-06 22:15"
  author:  string;
  subject: string;
  files:   string[];   // empty for older commits to keep this fast
}

/**
 * Read the last N git commits with their changed files. Returns an empty
 * array if the workspace isn't a git repo, git isn't on PATH, or anything
 * else goes wrong — this is informational, never blocking.
 *
 * Format used:
 *   --pretty=format:"%H|%ad|%an|%s" --date=short
 * Then a second call per commit for the file list (cap at 5 commits to keep
 * cheap — older commits get just the subject line).
 */
function getRecentCommits(root: string, limit = 10): GitCommit[] {
  try {
    const log = execSync(
      `git log -n ${limit} --pretty=format:"%H|%ad|%an|%s" --date=format:"%Y-%m-%d %H:%M"`,
      { cwd: root, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!log) return [];

    const commits: GitCommit[] = log.split("\n").map((line, i) => {
      const [hash, date, author, ...subjectParts] = line.split("|");
      const subject = subjectParts.join("|").trim();
      let files: string[] = [];
      // Pull file list for the 5 most recent commits only (cost-bounded)
      if (i < 5 && hash) {
        try {
          const f = execSync(
            `git show --pretty="" --name-only ${hash}`,
            { cwd: root, encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] },
          ).trim();
          files = f.split("\n").filter(Boolean).slice(0, 5);
        } catch { /* ignore — fall through with empty files */ }
      }
      return {
        hash:    (hash || "").slice(0, 7),
        date:    date || "",
        author:  author || "",
        subject: subject || "",
        files,
      };
    }).filter(c => c.subject); // drop empty rows

    return commits;
  } catch {
    return [];
  }
}

// ── Rule-file rebuilder ──────────────────────────────────────────────────────

/**
 * Build the markdown block infernoflow injects into rule files.
 * Top 5 entries are listed in full; everything else is collapsed under a
 * "Older context" detail block so AI tools don't get noisy after 50+ entries.
 */
// ── Skill: "Memory protocol" ───────────────────────────────────────────────
// This block teaches whatever AI is reading the rule file to PROACTIVELY call
// the amp_write MCP tool when it detects worth-remembering moments. It is
// auto-capture LINK 1 ("the AI knows WHEN to log") and must be present even on
// a brand-new project with zero entries — otherwise the AI never learns the
// protocol and never logs. Works across Cursor, Claude Code, Copilot, Windsurf.
// Kept byte-identical to the CLI's lib/ruleFiles.mjs block so whichever writer
// runs last produces the same managed section (no churn, no duplicates).
function memoryProtocolLines(): string[] {
  return [
    "### Memory protocol — capture as you go",
    "",
    "You have the `amp_write` MCP tool. **Use it proactively** (without the user asking) whenever you detect any of these moments. Capture the lesson in one sentence so the next AI session inherits it.",
    "",
    "| When you see… | Call `amp_write` with… |",
    "|---|---|",
    "| User types `!!!`, `not working`, `still broken`, `no change`, `same error`, repeated frustration | `{type: 'attempt', msg: '<one-line: what was tried and how it failed>', file: '<active file>'}` |",
    "| You generate a plan, numbered steps, or `Plan:` / `Approach:` block | `{type: 'note', msg: 'Plan: <one-line summary>', file: '<focus file>'}` |",
    "| User picks X over Y, decides an architectural approach, or you both agree on a direction | `{type: 'decision', msg: '<X> chosen over <Y> because <reason>', file: '<file>'}` |",
    "| Discovered non-obvious behavior, API quirk, or `aha — turns out…` moment | `{type: 'gotcha', msg: '<one-line>', file: '<file>', line: <line if known>}` |",
    "| User says `switching` / `back to X`, or ~30 min passed without logging | `{type: 'note', msg: 'Session snapshot — worked on: <X>. Open threads: <Y>.'}` |",
    "",
    "**Do NOT log:** typos, syntax errors, obvious bugs visible in the code, anything the next AI can infer by re-reading the file.",
    "**Do log:** anything that taught you something non-derivable from code.",
    "**Be concise:** entries should be one sentence. Future-you will skim them.",
  ];
}

function buildSection(scored: ScoredEntry[], activeFile: string | undefined, commits: GitCommit[]): string {
  const haveMemory  = scored.length > 0;
  const haveCommits = commits.length > 0;

  // Empty project: STILL emit the protocol block. It's auto-capture link 1 —
  // the AI must learn the protocol on day one, before any entry exists.
  if (!haveMemory && !haveCommits) {
    return [
      SECTION_START,
      "<!-- Auto-managed by infernoflow. Don't edit between these markers. -->",
      "## Project memory (infernoflow)",
      "",
      ...memoryProtocolLines(),
      "",
      "_No entries yet. They'll appear here as you and your AI tools log them — run `infernoflow log` or use `Ctrl+Alt+G` in VS Code._",
      SECTION_END,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(SECTION_START);
  lines.push("<!-- Auto-managed by infernoflow. Don't edit between these markers. -->");
  lines.push("## Project memory (infernoflow)");
  lines.push("");
  lines.push(...memoryProtocolLines());
  lines.push("");

  if (haveMemory) {
    lines.push("_Memory entries below are sorted by relevance to the file you're currently editing._");
  }
  if (activeFile) lines.push(`_Active file: \`${activeFile}\`._`);
  lines.push("");

  // Recent commits FIRST — they're the highest-signal "what just happened" context
  if (haveCommits) {
    lines.push("### Recent commits");
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      const filesNote = c.files.length > 0
        ? `\n  &nbsp;&nbsp;changed: ${c.files.map(f => `\`${f}\``).join(", ")}`
        : "";
      lines.push(`- \`${c.hash}\` _${c.date}_ ${c.subject}${filesNote}`);
    }
    lines.push("");
  }

  if (haveMemory) {
    const ICON: Record<string, string> = {
      gotcha:    "⚠",
      decision:  "✓",
      attempt:   "✗",
      note:      "·",
      detection: "○",
      pattern:   "◇",
    };

    // Top 5 in full
    const top = scored.slice(0, 5);
    if (top.length > 0) {
      lines.push("### Most relevant memory");
      for (const { entry: e } of top) {
        const fileRef = e.file ? ` (\`${e.file}${e.line ? ":" + e.line : ""}\`)` : "";
        lines.push(`- ${ICON[e.type] || "·"} **${e.type}**${fileRef}: ${e.msg.replace(/\n/g, " ")}`);
      }
      lines.push("");
    }

    // Rest collapsed in <details>
    const rest = scored.slice(5);
    if (rest.length > 0) {
      lines.push(`<details>`);
      lines.push(`<summary>Older context (${rest.length} more)</summary>`);
      lines.push("");
      for (const { entry: e } of rest) {
        const fileRef = e.file ? ` (\`${e.file}${e.line ? ":" + e.line : ""}\`)` : "";
        lines.push(`- ${ICON[e.type] || "·"} **${e.type}**${fileRef}: ${e.msg.replace(/\n/g, " ").slice(0, 140)}${e.msg.length > 140 ? "…" : ""}`);
      }
      lines.push("");
      lines.push(`</details>`);
      lines.push("");
    }
  }

  lines.push(SECTION_END);
  return lines.join("\n");
}

/**
 * Replace the infernoflow section of a single rule file (or append if none
 * exists). Creates the file if it doesn't exist. Idempotent — running this
 * 100 times produces the same output as running it once.
 */
function updateRuleFile(absPath: string, sectionMd: string): void {
  let content = "";
  if (fs.existsSync(absPath)) {
    content = fs.readFileSync(absPath, "utf8");
  } else {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
  }

  const startIdx = content.indexOf(SECTION_START);
  const endIdx   = content.indexOf(SECTION_END);

  let updated: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    updated = content.slice(0, startIdx) + sectionMd + content.slice(endIdx + SECTION_END.length);
  } else {
    // Append a separator + the section
    updated = (content ? content.replace(/\s+$/, "") + "\n\n" : "") + sectionMd + "\n";
  }

  // Avoid useless writes (preserves file mtime + git noise)
  if (updated !== content) {
    fs.writeFileSync(absPath, updated, "utf8");
  }
}

/**
 * Rewrite all three rule files with the file-prioritized memory section.
 * Returns the count of files actually changed (0 if everything was already up to date).
 */
export function rebuildAiRuleFiles(activeFile?: string): { updated: number; total: number } {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return { updated: 0, total: 0 };

  const scored    = rankedForFile(activeFile);
  const commits   = getRecentCommits(root, 10);
  const sectionMd = buildSection(scored, activeFile, commits);

  let updated = 0;
  for (const rel of RULE_FILES) {
    const abs = path.join(root, rel);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    updateRuleFile(abs, sectionMd);
    const after = fs.readFileSync(abs, "utf8");
    if (after !== before) updated++;
  }
  return { updated, total: RULE_FILES.length };
}
