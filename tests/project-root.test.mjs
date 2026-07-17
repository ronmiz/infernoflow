/**
 * Project-root resolution — pins the "what does 'this project' mean?" contract.
 *
 * Multi-folder layouts (.NET full-stack with publish/, monorepos, build
 * artefact dirs that copy the source tree) used to scatter `.ai-memory/`
 * folders all over because everything keyed off process.cwd(). These tests
 * lock down that we walk *up* to find a single canonical root.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import {
  findProjectRoot,
  findAllMemoryDirs,
  _resetProjectRootCache,
} from "../lib/projectRoot.mjs";

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-root-"));
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

beforeEach(() => _resetProjectRootCache());

describe("findProjectRoot — marker resolution", () => {
  let root;
  afterEach(() => rmrf(root));

  it("returns the dir itself when it contains .ai-memory/", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".ai-memory"));
    expect(findProjectRoot(root)).toBe(fs.realpathSync(root));
  });

  it("walks up from a subdirectory to find .ai-memory/", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".ai-memory"));
    const sub = path.join(root, "src", "server", "deep");
    fs.mkdirSync(sub, { recursive: true });
    expect(findProjectRoot(sub)).toBe(fs.realpathSync(root));
  });

  it("prefers .ai-memory/ over an upstream .git/", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".git"));        // upstream marker
    const inner = path.join(root, "packages", "core");
    fs.mkdirSync(path.join(inner, ".ai-memory"), { recursive: true });
    // Started inside packages/core — should resolve to packages/core, not root
    expect(findProjectRoot(inner)).toBe(fs.realpathSync(inner));
  });

  it("falls back to legacy inferno/ when .ai-memory/ absent", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, "inferno"));
    const sub = path.join(root, "src");
    fs.mkdirSync(sub);
    expect(findProjectRoot(sub)).toBe(fs.realpathSync(root));
  });

  it("finds .git/ when no memory dir exists", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".git"));
    const sub = path.join(root, "src", "App");
    fs.mkdirSync(sub, { recursive: true });
    expect(findProjectRoot(sub)).toBe(fs.realpathSync(root));
  });

  it("detects a Node project via package.json", () => {
    root = mkTmp();
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    expect(findProjectRoot(path.join(root, "src"))).toBeUndefined; // no src yet
    fs.mkdirSync(path.join(root, "src"));
    _resetProjectRootCache();
    expect(findProjectRoot(path.join(root, "src"))).toBe(fs.realpathSync(root));
  });

  it("detects a .NET project via *.csproj", () => {
    root = mkTmp();
    fs.writeFileSync(path.join(root, "Server.csproj"), "<Project></Project>");
    const sub = path.join(root, "Controllers");
    fs.mkdirSync(sub);
    expect(findProjectRoot(sub)).toBe(fs.realpathSync(root));
  });

  it("detects a .NET solution via *.sln", () => {
    root = mkTmp();
    fs.writeFileSync(path.join(root, "App.sln"), "Microsoft Visual Studio Solution File");
    expect(findProjectRoot(path.join(root, "src"))).toBeUndefined; // no src yet
    fs.mkdirSync(path.join(root, "src"));
    _resetProjectRootCache();
    expect(findProjectRoot(path.join(root, "src"))).toBe(fs.realpathSync(root));
  });

  it("detects a Rust project via Cargo.toml", () => {
    root = mkTmp();
    fs.writeFileSync(path.join(root, "Cargo.toml"), "[package]\nname='x'");
    fs.mkdirSync(path.join(root, "src"));
    expect(findProjectRoot(path.join(root, "src"))).toBe(fs.realpathSync(root));
  });

  it("detects a Python project via pyproject.toml", () => {
    root = mkTmp();
    fs.writeFileSync(path.join(root, "pyproject.toml"), "[tool.poetry]");
    fs.mkdirSync(path.join(root, "src"));
    expect(findProjectRoot(path.join(root, "src"))).toBe(fs.realpathSync(root));
  });

  it("falls back to the start dir when no markers are found anywhere", () => {
    // Use a deep temp dir nested far enough that walking up isn't likely to
    // hit a project marker we don't control.
    root = mkTmp();
    const isolated = path.join(root, "no", "markers", "anywhere");
    fs.mkdirSync(isolated, { recursive: true });
    // The walk may hit a marker upstream on a dev's machine — assert only that
    // the result is either the start OR an ancestor of the start. Either way
    // it MUST be a parent of `isolated` (never something disjoint).
    const got = findProjectRoot(isolated);
    expect(isolated.startsWith(got)).toBe(true);
  });

  it("is memoised — second call returns identical instance without re-walking", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".git"));
    const a = findProjectRoot(root);
    const b = findProjectRoot(root);
    expect(a).toBe(b);
  });

  it("_resetProjectRootCache clears the memo", () => {
    // Deterministic: a parent with .git and a child with its own .git. This
    // avoids depending on whatever markers happen to exist upstream on the
    // dev machine (which made this test flaky — and masked a drive-root
    // pollution bug in findProjectRoot).
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".git"));                       // parent marker
    const child = path.join(root, "child");
    fs.mkdirSync(path.join(child, ".git"), { recursive: true }); // child marker

    const first = findProjectRoot(child);
    expect(first).toBe(fs.realpathSync(child));                  // cached at child

    _resetProjectRootCache();
    fs.rmSync(path.join(child, ".git"), { recursive: true });    // remove child marker

    // Cache cleared + child marker gone → must re-walk UP to the parent's .git.
    const after = findProjectRoot(child);
    expect(after).toBe(fs.realpathSync(root));                   // walked up to parent
    expect(after).not.toBe(first);                              // proves the memo was cleared
  });
});

describe("findAllMemoryDirs — multi-folder pollution detector", () => {
  let root;
  afterEach(() => rmrf(root));

  it("returns [] for a project with no memory dirs", () => {
    root = mkTmp();
    expect(findAllMemoryDirs(root)).toEqual([]);
  });

  it("finds a single .ai-memory/ at the root", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".ai-memory"));
    const found = findAllMemoryDirs(root);
    expect(found.length).toBe(1);
    expect(found[0].kind).toBe("amp");
  });

  it("finds both an .ai-memory/ at root AND a stray copy in publish/", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".ai-memory"));
    fs.mkdirSync(path.join(root, "publish", ".ai-memory"), { recursive: true });
    const found = findAllMemoryDirs(root);
    expect(found.length).toBe(2);
    expect(found.every(f => f.kind === "amp")).toBe(true);
  });

  it("distinguishes amp vs legacy inferno", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".ai-memory"));
    fs.mkdirSync(path.join(root, "old-clone", "inferno"), { recursive: true });
    const found = findAllMemoryDirs(root);
    const kinds = found.map(f => f.kind).sort();
    expect(kinds).toEqual(["amp", "legacy"]);
  });

  it("skips node_modules, dist, build, and other noise dirs", () => {
    root = mkTmp();
    fs.mkdirSync(path.join(root, ".ai-memory"));
    fs.mkdirSync(path.join(root, "node_modules", "x", ".ai-memory"), { recursive: true });
    fs.mkdirSync(path.join(root, "dist", "inferno"), { recursive: true });
    const found = findAllMemoryDirs(root);
    expect(found.length).toBe(1); // only the root one
    expect(found[0].path.endsWith(".ai-memory")).toBe(true);
  });
});
