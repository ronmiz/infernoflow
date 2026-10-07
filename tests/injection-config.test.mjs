/**
 * Injection token-budget config — pins that `config.injection` in amp.json
 * controls the rule-file memory block: entry/commit caps, per-entry char cap,
 * which files are targeted (+ stale-block stripping when a target is dropped),
 * the protocol on/off switch, and backward-compat defaults.
 *
 * Companion to the downstream token-optimization report: these behaviors are
 * now first-class so nobody needs patch-package.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import { refreshRuleFilesFromMemory, resolveInjectionSettings } from "../lib/ruleFiles.mjs";
import { appendEntry, updateInjectionConfig } from "../lib/amp/io.mjs";
import { injectionPatchFromArgs } from "../lib/commands/refresh.mjs";
import { _resetProjectRootCache } from "../lib/projectRoot.mjs";

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-inj-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true }); // mark project root
  return dir;
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
function read(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }
function memoryBullets(text) { return (text.match(/^- 🔥/gm) || []).length; }

beforeEach(() => _resetProjectRootCache());

describe("resolveInjectionSettings (pure)", () => {
  it("returns lean defaults for null/empty config", () => {
    for (const cfg of [null, undefined, {}, { config: {} }]) {
      const s = resolveInjectionSettings(cfg);
      expect(s.maxEntries).toBe(4);
      expect(s.maxCommits).toBe(5);
      expect(s.maxEntryChars).toBe(200);
      expect(s.includeProtocol).toBe(true);
      expect(Array.isArray(s.targets)).toBe(true);
      expect(s.targets.length).toBe(3);
    }
  });

  it("honors a partial injection object, defaulting the rest", () => {
    const s = resolveInjectionSettings({ config: { injection: { maxEntries: 2 } } });
    expect(s.maxEntries).toBe(2);
    expect(s.maxCommits).toBe(5);       // default
    expect(s.maxEntryChars).toBe(200);  // default
  });

  it("reuses a legacy non-['all'] inject array as a target subset", () => {
    const s = resolveInjectionSettings({ config: { inject: ["CLAUDE.md"] } });
    expect(s.targets).toEqual(["CLAUDE.md"]);
  });

  it("treats inject:['all'] as no subset (all targets)", () => {
    const s = resolveInjectionSettings({ config: { inject: ["all"] } });
    expect(s.targets.length).toBe(3);
  });

  it("defaults protocolStyle to compact", () => {
    for (const cfg of [null, {}, { config: { injection: {} } }]) {
      expect(resolveInjectionSettings(cfg).protocolStyle).toBe("compact");
    }
  });

  it("honors protocolStyle full/off; includeProtocol:false maps to off", () => {
    expect(resolveInjectionSettings({ config: { injection: { protocolStyle: "full" } } }).protocolStyle).toBe("full");
    const off = resolveInjectionSettings({ config: { injection: { protocolStyle: "off" } } });
    expect(off.protocolStyle).toBe("off");
    expect(off.includeProtocol).toBe(false);
    const legacyOff = resolveInjectionSettings({ config: { injection: { includeProtocol: false } } });
    expect(legacyOff.protocolStyle).toBe("off");
    expect(legacyOff.includeProtocol).toBe(false);
  });

  it("falls back to compact for an unknown protocolStyle", () => {
    expect(resolveInjectionSettings({ config: { injection: { protocolStyle: "verbose" } } }).protocolStyle).toBe("compact");
  });
});

describe("refreshRuleFilesFromMemory honors injection config", () => {
  let project;
  beforeEach(() => { project = mkProject(); });
  afterEach(() => rmrf(project));

  it("caps the number of injected memory entries", () => {
    for (let i = 1; i <= 6; i++) appendEntry(project, { type: "note", summary: `inj-entry-${i}`, agent: "claude" });
    updateInjectionConfig(project, { maxEntries: 2 });
    refreshRuleFilesFromMemory(project);
    expect(memoryBullets(read(path.join(project, "CLAUDE.md")))).toBe(2);
  });

  it("emits the compact protocol by default (no full trigger table)", () => {
    appendEntry(project, { type: "note", summary: "x", agent: "claude" });
    refreshRuleFilesFromMemory(project);
    const md = read(path.join(project, "CLAUDE.md"));
    expect(md).toContain("### Memory protocol");
    expect(md).toContain("amp_bookmark");         // compact names both tools
    expect(md).not.toContain("| When you see");   // but NOT the full table
  });

  it("emits the full protocol table when protocolStyle=full", () => {
    appendEntry(project, { type: "note", summary: "x", agent: "claude" });
    updateInjectionConfig(project, { protocolStyle: "full" });
    refreshRuleFilesFromMemory(project);
    const md = read(path.join(project, "CLAUDE.md"));
    expect(md).toContain("| When you see");       // full table present
    expect(md).toContain("capture as you go");
  });

  it("omits the protocol entirely when protocolStyle=off (memory still injected)", () => {
    appendEntry(project, { type: "note", summary: "keep-me", agent: "claude" });
    updateInjectionConfig(project, { protocolStyle: "off" });
    refreshRuleFilesFromMemory(project);
    const md = read(path.join(project, "CLAUDE.md"));
    expect(md).not.toContain("Memory protocol");
    expect(md).toContain("keep-me");              // memory entry still there
  });

  it("truncates each injected entry to maxEntryChars with an ellipsis", () => {
    appendEntry(project, { type: "note", summary: "X".repeat(400), agent: "claude" });
    updateInjectionConfig(project, { maxEntryChars: 40 });
    refreshRuleFilesFromMemory(project);
    const line = read(path.join(project, "CLAUDE.md")).split("\n").find(l => l.startsWith("- 🔥"));
    expect(line).toContain("…");
    // bullet prefix + ~40 chars + ellipsis — comfortably under the 400 raw length
    expect(line.length).toBeLessThan(120);
  });

  it("writes only the configured target files and strips de-selected ones", () => {
    appendEntry(project, { type: "gotcha", summary: "targets-test", agent: "claude" });
    // First: default (all 3) — every file gets a block.
    refreshRuleFilesFromMemory(project);
    expect(read(path.join(project, ".cursorrules"))).toMatch(/infernoflow:start/);

    // Then: restrict to CLAUDE.md only — .cursorrules block must be stripped.
    updateInjectionConfig(project, { targets: ["CLAUDE.md"] });
    refreshRuleFilesFromMemory(project);
    expect(read(path.join(project, "CLAUDE.md"))).toMatch(/infernoflow:start/);
    expect(read(path.join(project, ".cursorrules"))).not.toMatch(/infernoflow:start/);
  });

  it("omits the protocol block when includeProtocol is false (entries still present)", () => {
    appendEntry(project, { type: "gotcha", summary: "no-protocol-test gotcha", agent: "claude" });
    updateInjectionConfig(project, { includeProtocol: false });
    refreshRuleFilesFromMemory(project);
    const text = read(path.join(project, "CLAUDE.md"));
    expect(text).not.toMatch(/Memory protocol/i);
    expect(text).not.toContain("amp_write");
    expect(text).toContain("no-protocol-test gotcha"); // entry still injected
  });

  it("backward-compat: no injection config → defaults, all 3 files, no throw", () => {
    appendEntry(project, { type: "note", summary: "bc-test", agent: "claude" });
    expect(() => refreshRuleFilesFromMemory(project)).not.toThrow();
    for (const rel of [".cursorrules", "CLAUDE.md", ".github/copilot-instructions.md"]) {
      expect(read(path.join(project, rel))).toMatch(/infernoflow:start/);
    }
  });

  it("--targets writes the block to only the listed files; drops the rest (no double-load)", () => {
    appendEntry(project, { type: "gotcha", summary: "watch-out-here", agent: "claude" });
    refreshRuleFilesFromMemory(project);                          // all 3 get the block
    updateInjectionConfig(project, { targets: ["CLAUDE.md"] });
    refreshRuleFilesFromMemory(project);                          // strips the de-selected two
    expect(read(path.join(project, "CLAUDE.md"))).toContain("watch-out-here");
    expect(read(path.join(project, ".cursorrules"))).not.toContain("watch-out-here");
    expect(read(path.join(project, ".github", "copilot-instructions.md"))).not.toContain("infernoflow:start");
  });
});

describe("injection CLI flags (injectionPatchFromArgs)", () => {
  it("parses an explicit --targets list + --protocol-style", () => {
    const p = injectionPatchFromArgs(["--targets", "CLAUDE.md,.cursorrules", "--protocol-style", "full"]);
    expect(p.targets).toEqual(["CLAUDE.md", ".cursorrules"]);
    expect(p.protocolStyle).toBe("full");
  });

  it("ignores an invalid --protocol-style value", () => {
    expect(injectionPatchFromArgs(["--protocol-style", "nope"]).protocolStyle).toBeUndefined();
  });

  it("--targets auto resolves to CLAUDE.md under Claude Code", () => {
    const prev = process.env.CLAUDE_CODE_SESSION;
    process.env.CLAUDE_CODE_SESSION = "1";
    try {
      expect(injectionPatchFromArgs(["--targets", "auto"]).targets).toEqual(["CLAUDE.md"]);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION; else process.env.CLAUDE_CODE_SESSION = prev;
    }
  });

  it("no injection flags → empty patch", () => {
    expect(injectionPatchFromArgs(["--json", "--dry-run"])).toEqual({});
  });
});
