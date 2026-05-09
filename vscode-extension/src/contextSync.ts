/**
 * contextSync — close the injection loop.
 *
 * Memory is captured beautifully, but the AI only benefits if it actually
 * reads the right gotchas at the right time. After 50+ entries, dumping
 * everything into CLAUDE.md / .cursorrules makes the AI ignore most of it.
 *
 * This module ranks entries by relevance to the file the user is currently
 * editing, and exposes:
 *
 *   - rankedForFile(activeFile)
 *       Returns entries sorted by relevance score, newest as tiebreaker.
 *
 *   - rebuildAiRuleFiles(activeFile?)
 *       Rewrites the infernoflow-managed sections of CLAUDE.md /
 *       .cursorrules / .github/copilot-instructions.md with the most
 *       relevant gotchas at the top, less relevant collapsed below. Idempotent
 *       — uses delimiter comments to find and replace its own section.
 *
 * Relevance scoring:
 *   - Same file               +100
 *   - Same directory          + 40
 *   - Same file extension     + 10
 *   - Logged in last 7 days   + 20 bonus
 *   - Type-weighted: gotcha 1.5x, attempt 1.2x, decision 1.0x, note 0.6x
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
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

// ── Rule-file rebuilder ──────────────────────────────────────────────────────

/**
 * Build the markdown block infernoflow injects into rule files.
 * Top 5 entries are listed in full; everything else is collapsed under a
 * "Older context" detail block so AI tools don't get noisy after 50+ entries.
 */
function buildSection(scored: ScoredEntry[], activeFile: string | undefined): string {
  if (scored.length === 0) {
    return [
      SECTION_START,
      "<!-- Auto-managed by infernoflow. Don't edit between these markers. -->",
      "## Project memory (infernoflow)",
      "_No entries yet. Run `infernoflow log` or use `Ctrl+Alt+G` in VS Code._",
      SECTION_END,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(SECTION_START);
  lines.push("<!-- Auto-managed by infernoflow. Don't edit between these markers. -->");
  lines.push("## Project memory (infernoflow)");
  lines.push("");
  lines.push("_Sorted by relevance to the file you're currently editing._");
  if (activeFile) lines.push(`_Active file: \`${activeFile}\`._`);
  lines.push("");

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
    lines.push("### Most relevant");
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
  const sectionMd = buildSection(scored, activeFile);

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
