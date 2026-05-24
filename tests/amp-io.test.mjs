/**
 * AMP I/O — the load-bearing contract.
 *
 * If anything here breaks, the capture loop is broken at its foundation.
 * Tests cover: wire-format shape, type fallback for non-AMP types,
 * round-trip fidelity, ULID format, and read/write file behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import {
  toAmp,
  fromAmp,
  appendEntry,
  readEntries,
  ampPaths,
  ensureAmpDir,
  generateULID,
  writeDefaultConfig,
  readConfig,
  AMP_VERSION,
  migrateLegacy,
} from "../lib/amp/io.mjs";

// ── helpers ────────────────────────────────────────────────────────────────

function makeTempCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-test-"));
  // Mark this temp dir as a project root for findProjectRoot() so the
  // resolver doesn't walk above /tmp into the dev's home dir. A .git
  // marker is the cheapest universal signal.
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("toAmp / fromAmp wire format", () => {
  it("maps internal.summary → amp.msg", () => {
    const amp = toAmp({ type: "decision", summary: "use pnpm", agent: "claude" });
    expect(amp.msg).toBe("use pnpm");
    expect(amp.summary).toBeUndefined();
  });

  it("converts ISO timestamp to Unix ms integer", () => {
    const iso = "2026-05-18T12:34:56.000Z";
    const amp = toAmp({ type: "note", summary: "x", ts: iso });
    expect(typeof amp.ts).toBe("number");
    expect(amp.ts).toBe(Date.parse(iso));
  });

  it("auto-generates an AMP id with 'amp_' prefix", () => {
    const amp = toAmp({ type: "note", summary: "x" });
    expect(amp.id).toMatch(/^amp_[0-9A-Z]{26}$/);
  });

  it("falls back non-AMP types to 'note' with meta.subtype", () => {
    const amp = toAmp({ type: "preference", summary: "dark mode" });
    expect(amp.type).toBe("note");
    expect(amp.meta?.subtype).toBe("preference");
  });

  it("keeps AMP-spec types as-is", () => {
    for (const t of ["gotcha", "decision", "attempt", "note", "detection", "pattern"]) {
      const amp = toAmp({ type: t, summary: "x" });
      expect(amp.type).toBe(t);
      expect(amp.meta?.subtype).toBeUndefined();
    }
  });

  it("maps AMP tools (cursor/claude/copilot/windsurf) to amp.tool; other agents to meta.agent", () => {
    expect(toAmp({ type: "note", summary: "x", agent: "claude" }).tool).toBe("claude");
    expect(toAmp({ type: "note", summary: "x", agent: "cursor" }).tool).toBe("cursor");
    expect(toAmp({ type: "note", summary: "x", agent: "human"  }).meta?.agent).toBe("human");
    expect(toAmp({ type: "note", summary: "x", agent: "human"  }).tool).toBeUndefined();
  });

  it("preserves file, line, function, tags, source", () => {
    const amp = toAmp({
      type: "gotcha",
      summary: "x",
      file: "src/App.tsx",
      line: 42,
      function: "render",
      tags: ["ui", "react"],
      source: "git-hook",
    });
    expect(amp.file).toBe("src/App.tsx");
    expect(amp.line).toBe(42);
    expect(amp.function).toBe("render");
    expect(amp.tags).toEqual(["ui", "react"]);
    expect(amp.source).toBe("git-hook");
  });

  it("derives confidence=0.7 from auto:true when no explicit confidence given", () => {
    expect(toAmp({ type: "note", summary: "x", auto: true }).confidence).toBe(0.7);
    expect(toAmp({ type: "note", summary: "x", auto: true, confidence: 0.9 }).confidence).toBe(0.9);
  });

  it("stores infernoflow-specific 'result' in meta.result (AMP schema is strict)", () => {
    const amp = toAmp({ type: "attempt", summary: "x", result: "failed" });
    expect(amp.meta?.result).toBe("failed");
    expect(amp.result).toBeUndefined();
  });
});

describe("fromAmp reverses toAmp", () => {
  it("maps amp.msg → internal.summary", () => {
    const internal = fromAmp({ type: "decision", msg: "use pnpm", ts: 1, id: "amp_X" });
    expect(internal.summary).toBe("use pnpm");
    expect(internal.msg).toBeUndefined();
  });

  it("restores subtype back into internal.type", () => {
    const internal = fromAmp({ type: "note", msg: "x", ts: 1, meta: { subtype: "preference" } });
    expect(internal.type).toBe("preference");
  });

  it("maps amp.tool → internal.agent; meta.agent overrides", () => {
    expect(fromAmp({ type: "note", msg: "x", ts: 1, tool: "claude" }).agent).toBe("claude");
    expect(fromAmp({ type: "note", msg: "x", ts: 1, meta: { agent: "human" } }).agent).toBe("human");
  });

  it("restores result from meta.result", () => {
    const internal = fromAmp({ type: "attempt", msg: "x", ts: 1, meta: { result: "failed" } });
    expect(internal.result).toBe("failed");
  });
});

describe("round-trip fidelity", () => {
  it("internal → amp → internal preserves all known fields", () => {
    const original = {
      ts: "2026-05-18T12:00:00.000Z",
      agent: "claude",
      type: "decision",
      summary: "use SQLite",
      result: "worked",
      source: "agent",
      file: "schema.prisma",
      line: 7,
      tags: ["db"],
    };
    const amp = toAmp(original);
    const restored = fromAmp(amp);

    expect(restored.summary).toBe(original.summary);
    expect(restored.type).toBe(original.type);
    expect(restored.agent).toBe(original.agent);
    expect(restored.result).toBe(original.result);
    expect(restored.file).toBe(original.file);
    expect(restored.line).toBe(original.line);
    expect(restored.tags).toEqual(original.tags);
    // ts becomes ms-int after toAmp; verify it's the same instant
    expect(restored.ts).toBe(Date.parse(original.ts));
  });

  it("legacy entry (already has summary) passes through fromAmp unchanged", () => {
    const legacy = { type: "note", summary: "legacy", ts: "iso" };
    expect(fromAmp(legacy)).toEqual(legacy);
  });
});

describe("generateULID", () => {
  it("produces 26 chars from Crockford base32 alphabet", () => {
    const ulid = generateULID();
    expect(ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("is monotonic across rapid calls (timestamp prefix non-decreasing)", () => {
    const a = generateULID().slice(0, 10);
    const b = generateULID().slice(0, 10);
    expect(b >= a).toBe(true);
  });

  it("generates unique values", () => {
    const set = new Set(Array.from({ length: 100 }, () => generateULID()));
    expect(set.size).toBe(100);
  });
});

describe("ampPaths layout resolution", () => {
  let cwd;
  beforeEach(() => { cwd = makeTempCwd(); });
  afterEach(() => rmrf(cwd));

  it("prefers .ai-memory/ when it exists", () => {
    fs.mkdirSync(path.join(cwd, ".ai-memory"), { recursive: true });
    const p = ampPaths(cwd);
    expect(p.isAmp).toBe(true);
    expect(p.sessions.endsWith(path.join(".ai-memory", "sessions.jsonl"))).toBe(true);
  });

  it("falls back to inferno/ for legacy reads when .ai-memory/ missing", () => {
    fs.mkdirSync(path.join(cwd, "inferno"), { recursive: true });
    const p = ampPaths(cwd);
    expect(p.isAmp).toBe(false);
    expect(p.sessions.endsWith(path.join("inferno", "sessions.jsonl"))).toBe(true);
  });

  it("forces .ai-memory/ when forWrite:true even if only inferno/ exists", () => {
    fs.mkdirSync(path.join(cwd, "inferno"), { recursive: true });
    const p = ampPaths(cwd, { forWrite: true });
    expect(p.isAmp).toBe(true);
  });
});

describe("appendEntry + readEntries", () => {
  let cwd;
  beforeEach(() => { cwd = makeTempCwd(); });
  afterEach(() => rmrf(cwd));

  it("creates .ai-memory/ and writes entries in AMP shape", () => {
    // v0.44: writes route into branches/<branch>.jsonl, not the legacy
    // flat sessions.jsonl. Branch is "no-branch" here (empty .git, no
    // commits). Test reads via the merged readEntries so we exercise the
    // user-facing contract, not the internal filename.
    appendEntry(cwd, { type: "decision", summary: "use SQLite", agent: "claude" });
    appendEntry(cwd, { type: "gotcha",   summary: "MCP no hot-reload" });

    const entries = readEntries(cwd);
    expect(entries.length).toBe(2);
    // readEntries returns internal shape; the AMP wire format on disk has
    // `msg` (we'll cover that with a separate raw-file test if needed).
    expect(entries[0].summary).toBe("use SQLite");
    expect(entries[0].type).toBe("decision");
    expect(entries[0].agent).toBe("claude");
    expect(entries[0].id).toMatch(/^amp_/);
  });

  it("readEntries returns entries in internal shape", () => {
    appendEntry(cwd, { type: "pattern", summary: "x" });
    const entries = readEntries(cwd);
    expect(entries.length).toBe(1);
    expect(entries[0].summary).toBe("x");
    expect(entries[0].type).toBe("pattern");
  });

  it("survives bogus JSONL lines without throwing", () => {
    appendEntry(cwd, { type: "note", summary: "good" });
    // Corrupt the destination file (branches/<current>.jsonl in v0.44).
    const p = ampPaths(cwd);
    fs.appendFileSync(p.currentBranchFile, "{not valid json\n");
    appendEntry(cwd, { type: "note", summary: "also good" });
    const entries = readEntries(cwd);
    expect(entries.length).toBe(2);
    expect(entries.map(e => e.summary)).toEqual(["good", "also good"]);
  });

  it("returns [] when no memory files exist", () => {
    expect(readEntries(cwd)).toEqual([]);
  });

  it("preserves file, line, tags through write→read", () => {
    appendEntry(cwd, {
      type: "gotcha",
      summary: "x",
      file: "src/App.tsx",
      line: 42,
      tags: ["a", "b"],
    });
    const [e] = readEntries(cwd);
    expect(e.file).toBe("src/App.tsx");
    expect(e.line).toBe(42);
    expect(e.tags).toEqual(["a", "b"]);
  });
});

describe("config + constants", () => {
  let cwd;
  beforeEach(() => { cwd = makeTempCwd(); });
  afterEach(() => rmrf(cwd));

  it("writeDefaultConfig is idempotent — never clobbers existing amp.json", () => {
    expect(writeDefaultConfig(cwd)).toBe(true);
    expect(writeDefaultConfig(cwd)).toBe(false);
  });

  it("readConfig returns parsed amp.json", () => {
    writeDefaultConfig(cwd, { project: "infernotest_01" });
    const cfg = readConfig(cwd);
    expect(cfg.amp).toBe(AMP_VERSION);
    expect(cfg.project).toBe("infernotest_01");
  });

  // Regression: AMP_MARKERS was removed in v0.44 along with the duplicate-
  // managed-block writer in log.mjs. The single canonical writer in
  // ruleFiles.mjs owns `<!-- infernoflow:start -->` exclusively; if this
  // import suddenly succeeds again, a parallel writer has been resurrected.
  it("AMP_MARKERS export is gone (deliberately) — single-writer policy", async () => {
    const io = /** @type {{ AMP_MARKERS?: unknown }} */ (await import("../lib/amp/io.mjs"));
    expect(io.AMP_MARKERS).toBeUndefined();
  });
});

describe("migrateLegacy", () => {
  let cwd;
  beforeEach(() => { cwd = makeTempCwd(); });
  afterEach(() => rmrf(cwd));

  it("returns migrated=0 when no legacy file exists", () => {
    const r = migrateLegacy(cwd);
    expect(r.migrated).toBe(0);
  });

  it("copies legacy inferno/sessions.jsonl to .ai-memory/ in AMP shape", () => {
    const legacy = path.join(cwd, "inferno");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, "sessions.jsonl"),
      JSON.stringify({ type: "decision", summary: "legacy", ts: "2026-01-01T00:00:00Z" }) + "\n"
    );

    const r = migrateLegacy(cwd);
    expect(r.migrated).toBe(1);

    const ampSess = fs.readFileSync(path.join(cwd, ".ai-memory", "sessions.jsonl"), "utf8");
    const entry = JSON.parse(ampSess.trim());
    expect(entry.msg).toBe("legacy");
    expect(entry.type).toBe("decision");
  });

  it("won't overwrite an existing .ai-memory/sessions.jsonl", () => {
    fs.mkdirSync(path.join(cwd, "inferno"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "inferno", "sessions.jsonl"), "{}\n");
    fs.mkdirSync(path.join(cwd, ".ai-memory"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".ai-memory", "sessions.jsonl"), "{}\n");

    const r = migrateLegacy(cwd);
    expect(r.migrated).toBe(0);
    expect(r.reason).toMatch(/already exists/);
  });
});
