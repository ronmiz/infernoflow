/**
 * Memory rotation / prune — pins the contract that pruneEntries archives
 * stale notes/attempts/detections without ever touching gotchas/decisions/
 * patterns, that the merged read excludes archived entries, and that the
 * dry-run / hard-delete / config-overrides paths all behave.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import { pruneEntries, resolveRotationSettings, readEntries, appendEntry, updateInjectionConfig } from "../lib/amp/io.mjs";
import { _resetProjectRootCache } from "../lib/projectRoot.mjs";

const DAY = 24 * 60 * 60 * 1000;

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-prune-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

/** Rewrite every entry across EVERY memory file (branches/*.jsonl + legacy
 *  sessions.jsonl mirror) so the simulated "age" is consistent — appendEntry
 *  writes to both at the same ts in production, so both must age together. */
function rewriteTimestamps(projectRoot, predicate, newTs) {
  const memDir = path.join(projectRoot, ".ai-memory");
  const files = [];
  const branches = path.join(memDir, "branches");
  if (fs.existsSync(branches)) {
    for (const name of fs.readdirSync(branches)) {
      if (name.endsWith(".jsonl")) files.push(path.join(branches, name));
    }
  }
  for (const name of ["sessions.jsonl", "global.jsonl"]) {
    const p = path.join(memDir, name);
    if (fs.existsSync(p)) files.push(p);
  }
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const out = lines.map(l => {
      try {
        const e = JSON.parse(l);
        return predicate(e) ? JSON.stringify({ ...e, ts: newTs }) : l;
      } catch { return l; }
    });
    fs.writeFileSync(file, out.join("\n") + "\n", "utf8");
  }
}

beforeEach(() => _resetProjectRootCache());

describe("resolveRotationSettings (pure)", () => {
  it("returns defaults when no config or no rotation section", () => {
    for (const cfg of [null, undefined, {}, { config: {} }]) {
      const s = resolveRotationSettings(cfg);
      expect(s.archiveAfterDays).toBe(30);
      expect(s.archivableTypes).toEqual(["note", "attempt", "detection"]);
      expect(s.auto).toBe(false);
    }
  });
  it("honors partial rotation config", () => {
    const s = resolveRotationSettings({ config: { rotation: { archiveAfterDays: 7, auto: true } } });
    expect(s.archiveAfterDays).toBe(7);
    expect(s.auto).toBe(true);
    expect(s.archivableTypes).toEqual(["note", "attempt", "detection"]);
  });
});

describe("pruneEntries", () => {
  let project;
  beforeEach(() => { project = mkProject(); });
  afterEach(() => rmrf(project));

  function seedMixed() {
    // Fresh (now): kept regardless of type.
    appendEntry(project, { type: "note",     summary: "fresh note",       agent: "claude" });
    appendEntry(project, { type: "gotcha",   summary: "fresh gotcha",     agent: "claude" });
    // Old: ones we WANT archived.
    appendEntry(project, { type: "note",     summary: "old note A",       agent: "claude" });
    appendEntry(project, { type: "attempt",  summary: "old attempt",      agent: "claude" });
    appendEntry(project, { type: "detection",summary: "old detection",    agent: "claude" });
    // Old PROTECTED — must survive.
    appendEntry(project, { type: "gotcha",   summary: "old gotcha A",     agent: "claude" });
    appendEntry(project, { type: "decision", summary: "old decision A",   agent: "claude" });
    appendEntry(project, { type: "pattern",  summary: "old pattern A",    agent: "claude" });
    // Age all entries whose summary starts with "old".
    rewriteTimestamps(project, e => /^old /.test(e.msg || ""), Date.now() - 45 * DAY);
  }

  it("dry-run reports counts without writing", () => {
    seedMixed();
    const before = readEntries(project).length;
    const r = pruneEntries(project, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.archived).toBe(3); // old note + attempt + detection
    expect(r.kept).toBe(5);     // 2 fresh + 3 old protected
    expect(readEntries(project).length).toBe(before); // unchanged
  });

  it("--apply archives stale archivable types and protects gotcha/decision/pattern", () => {
    seedMixed();
    const r = pruneEntries(project, { dryRun: false });
    expect(r.archived).toBe(3);
    const remaining = readEntries(project);
    const summaries = remaining.map(e => e.summary).sort();
    expect(summaries).toContain("old gotcha A");    // protected by type
    expect(summaries).toContain("old decision A");  // protected by type
    expect(summaries).toContain("old pattern A");   // protected by type
    expect(summaries).toContain("fresh note");      // protected by freshness
    expect(summaries).toContain("fresh gotcha");    // protected by both
    expect(summaries).not.toContain("old note A");
    expect(summaries).not.toContain("old attempt");
    expect(summaries).not.toContain("old detection");
  });

  it("creates the archive file and the archived entries are readable as JSONL", () => {
    seedMixed();
    pruneEntries(project, { dryRun: false });
    const archiveDir = path.join(project, ".ai-memory", "archive");
    expect(fs.existsSync(archiveDir)).toBe(true);
    const files = fs.readdirSync(archiveDir).filter(f => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThan(0);
    const lines = fs.readFileSync(path.join(archiveDir, files[0]), "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
    for (const l of lines) {
      const e = JSON.parse(l);
      expect(["note", "attempt", "detection"]).toContain(e.type);
    }
  });

  it("merged readEntries does NOT surface archived entries", () => {
    seedMixed();
    expect(readEntries(project).length).toBe(8);
    pruneEntries(project, { dryRun: false });
    expect(readEntries(project).length).toBe(5);
  });

  it("is idempotent — second run after first does nothing", () => {
    seedMixed();
    const first = pruneEntries(project, { dryRun: false });
    expect(first.archived).toBe(3);
    const second = pruneEntries(project, { dryRun: false });
    expect(second.archived).toBe(0);
    expect(second.kept).toBe(5);
  });

  it("honors --max-age-days override (smaller threshold archives more)", () => {
    appendEntry(project, { type: "note", summary: "note 10d old", agent: "claude" });
    appendEntry(project, { type: "note", summary: "note fresh",   agent: "claude" });
    rewriteTimestamps(project, e => /10d old/.test(e.msg), Date.now() - 10 * DAY);
    const r30 = pruneEntries(project, { dryRun: true, maxAgeDays: 30 });
    expect(r30.archived).toBe(0); // 10d < 30d threshold
    const r7  = pruneEntries(project, { dryRun: true, maxAgeDays:  7 });
    expect(r7.archived).toBe(1);
  });

  it("honors --types override (e.g., note-only)", () => {
    appendEntry(project, { type: "note",    summary: "old note",    agent: "claude" });
    appendEntry(project, { type: "attempt", summary: "old attempt", agent: "claude" });
    rewriteTimestamps(project, () => true, Date.now() - 45 * DAY);
    const r = pruneEntries(project, { dryRun: true, types: ["note"] });
    expect(r.archived).toBe(1);
    expect(r.byType).toEqual({ note: 1 });
  });

  it("never archives gotcha/decision/pattern even when explicitly in --types", () => {
    appendEntry(project, { type: "gotcha", summary: "old gotcha", agent: "claude" });
    rewriteTimestamps(project, () => true, Date.now() - 90 * DAY);
    const r = pruneEntries(project, { dryRun: true, types: ["gotcha", "note"] });
    expect(r.archived).toBe(0);
  });

  it("--no-archive hard-deletes without creating archive file", () => {
    appendEntry(project, { type: "note", summary: "old note", agent: "claude" });
    rewriteTimestamps(project, () => true, Date.now() - 45 * DAY);
    pruneEntries(project, { dryRun: false, archive: false });
    expect(readEntries(project).length).toBe(0);
    const archiveDir = path.join(project, ".ai-memory", "archive");
    expect(fs.existsSync(archiveDir)).toBe(false);
  });

  it("backward compat: works on a project with no rotation config", () => {
    appendEntry(project, { type: "note", summary: "old note", agent: "claude" });
    rewriteTimestamps(project, () => true, Date.now() - 45 * DAY);
    // No updateInjectionConfig / rotation config call. Should still prune
    // with built-in defaults.
    expect(() => pruneEntries(project, { dryRun: false })).not.toThrow();
    expect(readEntries(project).length).toBe(0);
  });

  it("respects amp.json config.rotation.archiveAfterDays", () => {
    appendEntry(project, { type: "note", summary: "10d old note", agent: "claude" });
    rewriteTimestamps(project, () => true, Date.now() - 10 * DAY);
    // Write a custom rotation config (we don't have a dedicated updater for
    // rotation yet — write directly).
    const cfgPath = path.join(project, ".ai-memory", "amp.json");
    const cfg = { amp: "1.0", project: "p", config: { rotation: { archiveAfterDays: 7 } } };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
    const r = pruneEntries(project, { dryRun: true });
    expect(r.archived).toBe(1); // 10d > 7d threshold from config
  });
});
