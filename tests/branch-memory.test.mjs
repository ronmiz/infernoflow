/**
 * Branch-aware memory — pins down the routing matrix, read-merge,
 * detached-HEAD handling, and legacy fallback.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import { appendEntry, readEntries, ampPaths } from "../lib/amp/io.mjs";
import {
  getCurrentBranch,
  getDefaultBranch,
  getBranchInfo,
  slugifyBranch,
  _resetBranchCache,
} from "../lib/git/branch.mjs";
import { _resetProjectRootCache } from "../lib/projectRoot.mjs";

function mkProject({ branch = "main", defaultBranch = "main" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-branch-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  const gitDir = path.join(dir, ".git");
  fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), `ref: refs/heads/${branch}\n`);
  const writeRef = (name) => {
    const refPath = path.join(gitDir, "refs", "heads", name);
    fs.mkdirSync(path.dirname(refPath), { recursive: true });  // handles feature/x
    fs.writeFileSync(refPath, "0000000000000000000000000000000000000000\n");
  };
  writeRef(defaultBranch);
  if (branch !== defaultBranch) writeRef(branch);
  return dir;
}

function mkDetached() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-detached-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  // HEAD = bare SHA (detached)
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "abc123def456abc123def456abc123def4567890\n");
  return dir;
}

function mkNoGit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-nogit-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  return dir;
}

function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

beforeEach(() => {
  _resetProjectRootCache();
  _resetBranchCache();
});

// ── Branch detection ──────────────────────────────────────────────────────

describe("getCurrentBranch", () => {
  let project;
  afterEach(() => rmrf(project));

  it("reads the branch from .git/HEAD", () => {
    project = mkProject({ branch: "feature-xyz" });
    expect(getCurrentBranch(project)).toBe("feature-xyz");
  });

  it("returns 'no-branch' when HEAD is detached", () => {
    project = mkDetached();
    expect(getCurrentBranch(project)).toBe("no-branch");
  });

  it("returns 'no-git' when there is no .git anywhere", () => {
    project = mkNoGit();
    expect(getCurrentBranch(project)).toBe("no-git");
  });

  it("handles nested-slash branch names (e.g. feature/auth-rewrite)", () => {
    project = mkProject({ branch: "feature/auth-rewrite" });
    expect(getCurrentBranch(project)).toBe("feature/auth-rewrite");
  });
});

describe("slugifyBranch", () => {
  it("flattens slashes and unsafe chars", () => {
    expect(slugifyBranch("feature/auth")).toBe("feature__auth");
    // Spaces + slashes + bang: slash → "__", then spaces/bang collapse with
    // surrounding chars into single "-" separators.
    expect(slugifyBranch("hot fix / 123!")).toBe("hot-fix-__-123");
    expect(slugifyBranch("")).toBe("no-branch");
  });
});

describe("getDefaultBranch", () => {
  let project;
  afterEach(() => rmrf(project));

  it("finds 'main' when refs/heads/main exists", () => {
    project = mkProject({ branch: "feature-xyz", defaultBranch: "main" });
    expect(getDefaultBranch(project)).toBe("main");
  });

  it("returns null when no candidate branch exists", () => {
    project = mkNoGit();
    expect(getDefaultBranch(project)).toBeNull();
  });
});

// ── Write routing ─────────────────────────────────────────────────────────

describe("appendEntry — routes by type", () => {
  let project;
  beforeEach(() => { project = mkProject({ branch: "feature-x", defaultBranch: "main" }); });
  afterEach(() => rmrf(project));

  it("routes 'gotcha' to the current-branch file", () => {
    appendEntry(project, { type: "gotcha", summary: "g1" });
    const p = ampPaths(project);
    expect(fs.existsSync(p.currentBranchFile), p.currentBranchFile).toBe(true);
    const text = fs.readFileSync(p.currentBranchFile, "utf8");
    expect(text).toContain("g1");
  });

  it("routes 'decision' to the current-branch file (travels with branch)", () => {
    appendEntry(project, { type: "decision", summary: "d1" });
    const p = ampPaths(project);
    expect(fs.readFileSync(p.currentBranchFile, "utf8")).toContain("d1");
  });

  it("routes 'preference' to global.jsonl (gitignored, doesn't travel)", () => {
    appendEntry(project, { type: "preference", summary: "p1" });
    const p = ampPaths(project);
    expect(fs.readFileSync(p.globalFile, "utf8")).toContain("p1");
    // Current branch file must NOT receive the preference entry.
    expect(fs.existsSync(p.currentBranchFile)).toBe(false);
  });

  it("explicit target='global' overrides the type-based default", () => {
    appendEntry(project, { type: "gotcha", summary: "g-on-global", target: "global" });
    const p = ampPaths(project);
    expect(fs.readFileSync(p.globalFile, "utf8")).toContain("g-on-global");
    expect(fs.existsSync(p.currentBranchFile)).toBe(false);
  });

  it("explicit target='legacy' writes to the flat sessions.jsonl (migration tool path)", () => {
    appendEntry(project, { type: "note", summary: "legacy-note", target: "legacy" });
    const p = ampPaths(project);
    expect(fs.readFileSync(p.sessions, "utf8")).toContain("legacy-note");
  });

  it("creates branches/ on first write — never errors on missing dir", () => {
    const p = ampPaths(project);
    expect(fs.existsSync(p.branchesDir)).toBe(false);
    appendEntry(project, { type: "gotcha", summary: "x" });
    expect(fs.existsSync(p.branchesDir)).toBe(true);
  });
});

// ── Read merging ──────────────────────────────────────────────────────────

describe("readEntries — merges across files in chronological order", () => {
  let project;
  beforeEach(() => { project = mkProject({ branch: "feature-x", defaultBranch: "main" }); });
  afterEach(() => rmrf(project));

  it("returns entries from all three layers (current branch, default branch, global)", () => {
    // Manually seed each file with one entry.
    const p = ampPaths(project, { forWrite: true });
    fs.mkdirSync(p.branchesDir, { recursive: true });
    fs.writeFileSync(
      p.currentBranchFile,
      JSON.stringify({ type: "gotcha", msg: "g-branch", ts: 3, id: "amp_B" }) + "\n"
    );
    fs.writeFileSync(
      p.defaultBranchFile,
      JSON.stringify({ type: "decision", msg: "d-main", ts: 1, id: "amp_D" }) + "\n"
    );
    fs.writeFileSync(
      p.globalFile,
      JSON.stringify({ type: "note", msg: "n-global", ts: 2, id: "amp_G" }) + "\n"
    );

    const entries = readEntries(project);
    expect(entries.map(e => e.summary)).toEqual(["d-main", "n-global", "g-branch"]);
  });

  it("dedupes by id when the same entry appears in multiple files", () => {
    const p = ampPaths(project, { forWrite: true });
    fs.mkdirSync(p.branchesDir, { recursive: true });
    const dup = JSON.stringify({ type: "gotcha", msg: "dup", ts: 1, id: "amp_DUP" }) + "\n";
    fs.writeFileSync(p.currentBranchFile, dup);
    fs.writeFileSync(p.defaultBranchFile, dup);
    fs.writeFileSync(p.globalFile,        dup);

    const entries = readEntries(project);
    expect(entries.length).toBe(1);
    expect(entries[0].summary).toBe("dup");
  });

  it("falls back to legacy sessions.jsonl for pre-v0.44 projects", () => {
    const p = ampPaths(project, { forWrite: true });
    fs.writeFileSync(
      p.sessions,
      JSON.stringify({ type: "note", msg: "legacy", ts: 1, id: "amp_L" }) + "\n"
    );
    const entries = readEntries(project);
    expect(entries.length).toBe(1);
    expect(entries[0].summary).toBe("legacy");
  });

  it("returns [] when no memory files exist at all", () => {
    expect(readEntries(project)).toEqual([]);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────

describe("edge cases", () => {
  let project;
  afterEach(() => rmrf(project));

  it("detached HEAD: writes route to branches/no-branch.jsonl", () => {
    project = mkDetached();
    appendEntry(project, { type: "gotcha", summary: "detached-gotcha" });
    const p = ampPaths(project);
    expect(p.branch.current).toBe("no-branch");
    const branchFile = path.join(p.branchesDir, "no-branch.jsonl");
    expect(fs.existsSync(branchFile)).toBe(true);
    expect(fs.readFileSync(branchFile, "utf8")).toContain("detached-gotcha");
  });

  it("no .git at all: writes route to branches/no-git.jsonl", () => {
    project = mkNoGit();
    appendEntry(project, { type: "decision", summary: "nogit-decision" });
    const p = ampPaths(project);
    const branchFile = path.join(p.branchesDir, "no-git.jsonl");
    expect(fs.existsSync(branchFile)).toBe(true);
  });

  it("on the default branch: current and default resolve to the same file", () => {
    project = mkProject({ branch: "main", defaultBranch: "main" });
    const p = ampPaths(project);
    expect(p.currentBranchFile).toBe(p.defaultBranchFile);
    appendEntry(project, { type: "gotcha", summary: "main-gotcha" });
    // The merged read must not double-count — see also the dedupe test above.
    const entries = readEntries(project);
    expect(entries.length).toBe(1);
  });
});

// ── getBranchInfo bundle ──────────────────────────────────────────────────

describe("getBranchInfo", () => {
  let project;
  afterEach(() => rmrf(project));

  it("returns slug-safe names for current and default", () => {
    project = mkProject({ branch: "feature/foo bar", defaultBranch: "main" });
    const info = getBranchInfo(project);
    expect(info.current).toBe("feature/foo bar");
    expect(info.currentSlug).toBe("feature__foo-bar");
    expect(info.default).toBe("main");
    expect(info.defaultSlug).toBe("main");
    expect(info.isSynthetic).toBe(false);
  });

  it("marks synthetic when on detached HEAD", () => {
    project = mkDetached();
    expect(getBranchInfo(project).isSynthetic).toBe(true);
  });
});
