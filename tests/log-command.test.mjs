/**
 * `infernoflow log` — CLI surface.
 *
 * Spawns the real binary in a temp CWD so we exercise argv parsing,
 * VALID_TYPES validation, and field plumbing end-to-end. The CLI calls
 * process.exit(1) on errors, which is awkward to mock — spawning is honest.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs");

function makeCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-log-"));
  // Pre-create .ai-memory/ so log doesn't bail with "no inferno/" prompt.
  // .git marks this dir as a project root for findProjectRoot().
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"),       { recursive: true });
  return dir;
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function runLog(cwd, args) {
  const r = spawnSync(process.execPath, [BIN, "log", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return r;
}

/**
 * Branch-aware read: scan every JSONL file under .ai-memory/ (the legacy
 * flat sessions.jsonl, branches/*.jsonl, global.jsonl) and return their
 * union in chronological order, DEDUPED by AMP id. Tests assert against
 * this — they shouldn't care which file an entry actually landed in, and
 * the v0.44 mirror-write policy puts each entry in two files for live
 * extension visibility.
 */
function readEntries(cwd) {
  const dir = path.join(cwd, ".ai-memory");
  if (!fs.existsSync(dir)) return [];
  const found = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.name.endsWith(".jsonl")) continue;
      try {
        for (const line of fs.readFileSync(full, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try { found.push(JSON.parse(line)); } catch {}
        }
      } catch {}
    }
  };
  walk(dir);
  // Dedupe by AMP id (mirror policy → same entry in branch + sessions).
  const seen = new Set();
  const unique = [];
  for (const e of found) {
    const key = e.id || `${e.ts}|${e.msg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  return unique.sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

// ── VALID_TYPES is the contract surface that broke before ──────────────────

describe("VALID_TYPES contract", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  // AMP-spec types — these MUST all be accepted. Before the fix, `detection`
  // and `pattern` were missing and the CLI exited(1) when amp_write tried them.
  const AMP_TYPES = ["gotcha", "decision", "attempt", "note", "detection", "pattern"];

  it.each(AMP_TYPES)("accepts AMP type '%s'", (type) => {
    const r = runLog(cwd, [`msg-${type}`, "--type", type, "--quiet"]);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    const entries = readEntries(cwd);
    expect(entries.length).toBe(1);
  });

  // Legacy infernoflow types — must round-trip via meta.subtype for back-compat.
  const LEGACY_TYPES = ["preference", "theme", "handoff", "error"];

  it.each(LEGACY_TYPES)("accepts legacy type '%s' (stored as note + meta.subtype)", (type) => {
    const r = runLog(cwd, [`msg-${type}`, "--type", type, "--quiet"]);
    expect(r.status).toBe(0);
    const [entry] = readEntries(cwd);
    expect(entry.type).toBe("note");
    expect(entry.meta?.subtype).toBe(type);
  });

  it("rejects unknown types with exit 1", () => {
    const r = runLog(cwd, ["msg", "--type", "definitely-not-a-type"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Invalid type/);
  });
});

// ── Flag parsing: --file, --line, --tags ───────────────────────────────────

describe("--file / --line / --tags propagate to the entry", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  it("preserves --file as entry.file (not entry.source)", () => {
    const r = runLog(cwd, ["x", "--type", "gotcha", "--file", "src/App.tsx", "--quiet"]);
    expect(r.status).toBe(0);
    const [e] = readEntries(cwd);
    expect(e.file).toBe("src/App.tsx");
    expect(e.source).toBeUndefined();
  });

  it("preserves --line as a number", () => {
    const r = runLog(cwd, ["x", "--type", "gotcha", "--line", "42", "--quiet"]);
    expect(r.status).toBe(0);
    const [e] = readEntries(cwd);
    expect(e.line).toBe(42);
  });

  it("ignores non-numeric --line gracefully (no crash)", () => {
    const r = runLog(cwd, ["x", "--type", "gotcha", "--line", "abc", "--quiet"]);
    expect(r.status).toBe(0);
    const [e] = readEntries(cwd);
    expect(e.line).toBeUndefined();
  });

  it("splits --tags on comma into an array", () => {
    const r = runLog(cwd, ["x", "--type", "gotcha", "--tags", "a,b,c", "--quiet"]);
    expect(r.status).toBe(0);
    const [e] = readEntries(cwd);
    expect(e.tags).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace in tag values and drops empties", () => {
    const r = runLog(cwd, ["x", "--type", "gotcha", "--tags", "a, b , ,c", "--quiet"]);
    expect(r.status).toBe(0);
    const [e] = readEntries(cwd);
    expect(e.tags).toEqual(["a", "b", "c"]);
  });

  it("keeps --source separate from --file (--source is provenance, --file is location)", () => {
    const r = runLog(cwd, [
      "x", "--type", "gotcha",
      "--file",   "src/App.tsx",
      "--source", "git-hook",
      "--quiet",
    ]);
    expect(r.status).toBe(0);
    const [e] = readEntries(cwd);
    expect(e.file).toBe("src/App.tsx");
    expect(e.source).toBe("git-hook");
  });
});

// ── Message collection ─────────────────────────────────────────────────────

describe("message collection", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  it("joins all non-flag tokens into the message, skipping flag values", () => {
    // Raw .jsonl on disk is AMP wire shape — the message field is `msg`.
    const r = runLog(cwd, [
      "the",  "agent", "wrote", "this",
      "--type", "note",
      "--file", "x.ts",
      "--tags", "a,b",
      "--quiet",
    ]);
    expect(r.status).toBe(0);
    const [e] = readEntries(cwd);
    expect(e.msg).toBe("the agent wrote this");
  });

  it("prints usage when no message given", () => {
    const r = runLog(cwd, []);
    // log without args shows help — should not exit non-zero
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/append to session memory/i);
  });
});

// ── --json output ──────────────────────────────────────────────────────────

describe("--json output", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  it("prints stored entries as JSON array (internal shape via fromAmp)", () => {
    // log --json prints entries normalized to internal shape — the message
    // field is `summary` here, not `msg`. That's the contract for consumers.
    runLog(cwd, ["entry one", "--type", "note",   "--quiet"]);
    runLog(cwd, ["entry two", "--type", "gotcha", "--quiet"]);
    const r = runLog(cwd, ["--json"]);
    expect(r.status).toBe(0);
    const arr = JSON.parse(r.stdout);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(2);
    expect(arr[0].summary).toBe("entry one");
    expect(arr[1].summary).toBe("entry two");
  });
});
