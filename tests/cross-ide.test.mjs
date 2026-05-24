/**
 * Cross-IDE rule-file coverage — pins down the contract that
 * `refreshRuleFilesFromMemory` writes the SAME canonical managed block to
 * EVERY supported IDE's file. If any IDE gets forgotten in a future refactor,
 * these tests fail.
 *
 * Targets:
 *   .cursorrules                          → Cursor
 *   CLAUDE.md                             → Claude Code
 *   .github/copilot-instructions.md       → GitHub Copilot (VS Code, JetBrains)
 *
 * (Windsurf reads .windsurfrules in some versions and .cursorrules in others;
 *  if we add explicit Windsurf support, this file is where the test lives.)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import { refreshRuleFilesFromMemory } from "../lib/ruleFiles.mjs";
import { appendEntry } from "../lib/amp/io.mjs";
import { _resetProjectRootCache } from "../lib/projectRoot.mjs";

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-ide-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"),       { recursive: true }); // mark as project root
  return dir;
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

beforeEach(() => _resetProjectRootCache());

const IDE_FILES = [
  { ide: "Cursor",        rel: ".cursorrules" },
  { ide: "Claude Code",   rel: "CLAUDE.md" },
  { ide: "GitHub Copilot",rel: ".github/copilot-instructions.md" },
];

describe("refreshRuleFilesFromMemory — all supported IDE files get written", () => {
  let project;
  beforeEach(() => {
    project = mkProject();
    // Seed three entries that should surface in every IDE's rule file.
    appendEntry(project, { type: "gotcha",   summary: "g1 — cross-ide-test gotcha", agent: "claude" });
    appendEntry(project, { type: "decision", summary: "d1 — cross-ide-test decision", agent: "claude" });
    appendEntry(project, { type: "note",     summary: "n1 — cross-ide-test note", agent: "claude" });
  });
  afterEach(() => rmrf(project));

  it.each(IDE_FILES)("writes the canonical managed block to $ide ($rel)", ({ rel }) => {
    refreshRuleFilesFromMemory(project);
    const filePath = path.join(project, rel);
    expect(fs.existsSync(filePath), `missing: ${rel}`).toBe(true);
    const text = fs.readFileSync(filePath, "utf8");
    // Single-writer marker (the old AMP:START block was removed in v0.44).
    expect(text).toMatch(/<!--\s*infernoflow:start\s*-->/);
    expect(text).toMatch(/<!--\s*infernoflow:end\s*-->/);
    // Old marker must NOT appear — regression: dead writer resurrected.
    expect(text).not.toMatch(/<!--\s*AMP:START\s*-->/);
  });

  it("surfaces recent gotchas to every IDE", () => {
    refreshRuleFilesFromMemory(project);
    for (const { ide, rel } of IDE_FILES) {
      const text = fs.readFileSync(path.join(project, rel), "utf8");
      expect(text, `gotcha missing in ${ide}/${rel}`).toContain("cross-ide-test gotcha");
    }
  });

  it("surfaces recent decisions to every IDE", () => {
    refreshRuleFilesFromMemory(project);
    for (const { ide, rel } of IDE_FILES) {
      const text = fs.readFileSync(path.join(project, rel), "utf8");
      expect(text, `decision missing in ${ide}/${rel}`).toContain("cross-ide-test decision");
    }
  });

  it("teaches the agent the capture protocol in every IDE", () => {
    refreshRuleFilesFromMemory(project);
    for (const { ide, rel } of IDE_FILES) {
      const text = fs.readFileSync(path.join(project, rel), "utf8");
      // The "amp_write" instruction is what makes capture transparent.
      // Without it, agents don't know they should log proactively.
      expect(text, `amp_write protocol missing in ${ide}/${rel}`).toContain("amp_write");
    }
  });
});

describe("refreshRuleFilesFromMemory — single-writer policy", () => {
  let project;
  beforeEach(() => { project = mkProject(); });
  afterEach(() => rmrf(project));

  it("produces exactly ONE managed block per file (no duplicate AMP block)", () => {
    appendEntry(project, { type: "gotcha", summary: "x", agent: "claude" });
    refreshRuleFilesFromMemory(project);
    refreshRuleFilesFromMemory(project); // second call mustn't double the block
    refreshRuleFilesFromMemory(project); // third call either

    for (const { rel } of IDE_FILES) {
      const text = fs.readFileSync(path.join(project, rel), "utf8");
      const startCount = (text.match(/<!--\s*infernoflow:start\s*-->/g) || []).length;
      const endCount   = (text.match(/<!--\s*infernoflow:end\s*-->/g)   || []).length;
      expect(startCount, `${rel} has ${startCount} start markers`).toBe(1);
      expect(endCount,   `${rel} has ${endCount} end markers`).toBe(1);
    }
  });

  it("preserves user-curated content surrounding the managed block", () => {
    appendEntry(project, { type: "note", summary: "x", agent: "claude" });
    // User has hand-curated content in CLAUDE.md before we ever touched it.
    const claudeMd = path.join(project, "CLAUDE.md");
    fs.writeFileSync(claudeMd, "# My project — read this first\n\nUser's hand-written rules.\n");

    refreshRuleFilesFromMemory(project);
    const text = fs.readFileSync(claudeMd, "utf8");
    expect(text).toContain("# My project — read this first");
    expect(text).toContain("User's hand-written rules.");
    expect(text).toMatch(/<!--\s*infernoflow:start\s*-->/);
  });
});
