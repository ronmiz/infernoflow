/**
 * Cross-machine sync — `global.jsonl` resolution + the `infernoflow sync`
 * subcommands. Branch files travel via git and are covered by branch-memory
 * tests; this file only exercises the personal layer.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ampPaths,
  resolveGlobalFile,
  projectSlug,
  appendEntry,
  readEntries,
} from "../lib/amp/io.mjs";
import { _resetProjectRootCache } from "../lib/projectRoot.mjs";
import { _resetBranchCache }      from "../lib/git/branch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs");

function mkProject(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-sync-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"),       { recursive: true });
  if (extra.ampJson) {
    fs.writeFileSync(
      path.join(dir, ".ai-memory", "amp.json"),
      JSON.stringify(extra.ampJson, null, 2),
    );
  }
  return dir;
}
function mkSyncedRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-synced-"));
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

beforeEach(() => {
  _resetProjectRootCache();
  _resetBranchCache();
  delete process.env.INFERNOFLOW_GLOBAL_DIR;
});

// ── projectSlug ────────────────────────────────────────────────────────────

describe("projectSlug", () => {
  let project;
  afterEach(() => rmrf(project));

  it("defaults to basename when amp.json has no project field", () => {
    project = mkProject();
    // mkdtemp returns names like `infernoflow-sync-XXXXXX`
    expect(projectSlug(project)).toMatch(/^infernoflow-sync-/);
  });

  it("honors amp.json `project` field", () => {
    project = mkProject({ ampJson: { project: "MyCoolApp" } });
    expect(projectSlug(project)).toBe("mycoolapp");
  });

  it("slugifies unsafe characters", () => {
    project = mkProject({ ampJson: { project: "My App / Backend!" } });
    expect(projectSlug(project)).toBe("my-app-backend");
  });

  it("caps slug length at 64 chars", () => {
    project = mkProject({ ampJson: { project: "x".repeat(200) } });
    expect(projectSlug(project).length).toBe(64);
  });
});

// ── resolveGlobalFile ──────────────────────────────────────────────────────

describe("resolveGlobalFile — resolution priority", () => {
  let project, syncedRoot;
  beforeEach(() => { project = mkProject(); syncedRoot = mkSyncedRoot(); });
  afterEach(()  => { rmrf(project); rmrf(syncedRoot); });

  it("defaults to in-project .ai-memory/global.jsonl when nothing is configured", () => {
    const file = resolveGlobalFile(project, path.join(project, ".ai-memory"));
    expect(file).toBe(path.join(project, ".ai-memory", "global.jsonl"));
  });

  it("env var INFERNOFLOW_GLOBAL_DIR takes priority and namespaces by project slug", () => {
    process.env.INFERNOFLOW_GLOBAL_DIR = syncedRoot;
    const file = resolveGlobalFile(project, path.join(project, ".ai-memory"));
    const slug = projectSlug(project);
    expect(file).toBe(path.join(syncedRoot, slug, "global.jsonl"));
  });

  it("amp.json `globalDir` is used when env var absent", () => {
    rmrf(project);
    project = mkProject({ ampJson: { globalDir: syncedRoot, project: "p1" } });
    const file = resolveGlobalFile(project, path.join(project, ".ai-memory"));
    expect(file).toBe(path.join(syncedRoot, "p1", "global.jsonl"));
  });

  it("env var WINS over amp.json when both are set", () => {
    rmrf(project);
    project = mkProject({ ampJson: { globalDir: "/from/amp/json", project: "p1" } });
    process.env.INFERNOFLOW_GLOBAL_DIR = syncedRoot;
    const file = resolveGlobalFile(project, path.join(project, ".ai-memory"));
    expect(file).toBe(path.join(syncedRoot, "p1", "global.jsonl"));
  });

  it("expands a leading tilde to the user's home directory", () => {
    process.env.INFERNOFLOW_GLOBAL_DIR = "~/infernoflow-test-sync";
    const file = resolveGlobalFile(project, path.join(project, ".ai-memory"));
    expect(file.startsWith(os.homedir())).toBe(true);
    expect(file.endsWith("global.jsonl")).toBe(true);
  });

  it("resolves a relative path against the project root", () => {
    process.env.INFERNOFLOW_GLOBAL_DIR = "../shared-memory";
    const file = resolveGlobalFile(project, path.join(project, ".ai-memory"));
    expect(path.isAbsolute(file)).toBe(true);
    expect(file).toContain("shared-memory");
  });
});

// ── Writes flow into the synced location ───────────────────────────────────

describe("appendEntry — writes preferences to the synced location when configured", () => {
  let project, syncedRoot;
  beforeEach(() => { project = mkProject(); syncedRoot = mkSyncedRoot(); });
  afterEach(()  => { rmrf(project); rmrf(syncedRoot); });

  it("preference type lands in <syncedRoot>/<slug>/global.jsonl", () => {
    process.env.INFERNOFLOW_GLOBAL_DIR = syncedRoot;
    appendEntry(project, { type: "preference", summary: "dark mode" });

    const slug   = projectSlug(project);
    const synced = path.join(syncedRoot, slug, "global.jsonl");
    expect(fs.existsSync(synced)).toBe(true);
    expect(fs.readFileSync(synced, "utf8")).toContain("dark mode");

    // Must NOT have written to the in-project default.
    expect(fs.existsSync(path.join(project, ".ai-memory", "global.jsonl"))).toBe(false);
  });

  it("readEntries picks up entries from the synced location", () => {
    process.env.INFERNOFLOW_GLOBAL_DIR = syncedRoot;
    appendEntry(project, { type: "preference", summary: "pref-1" });
    appendEntry(project, { type: "gotcha",     summary: "branch-g" });
    const entries = readEntries(project);
    const summaries = entries.map(e => e.summary).sort();
    expect(summaries).toEqual(["branch-g", "pref-1"]);
  });
});

// ── `infernoflow sync` CLI ─────────────────────────────────────────────────

function runSync(cwd, args = [], env = {}) {
  return spawnSync(process.execPath, [BIN, "sync", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, ...env, NO_COLOR: "1" },
  });
}

describe("infernoflow sync — CLI subcommands", () => {
  let project, syncedRoot;
  beforeEach(() => { project = mkProject(); syncedRoot = mkSyncedRoot(); });
  afterEach(()  => { rmrf(project); rmrf(syncedRoot); });

  it("bare `sync` shows status with source=default", () => {
    const r = runSync(project, ["--json"], { INFERNOFLOW_GLOBAL_DIR: "" });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.configured).toBe(false);
    expect(parsed.source).toMatch(/default/);
  });

  it("`sync status` with env var reports source=env", () => {
    const r = runSync(project, ["status", "--json"], { INFERNOFLOW_GLOBAL_DIR: syncedRoot });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.configured).toBe(true);
    expect(parsed.source).toMatch(/env/);
    expect(parsed.configuredPath).toBe(syncedRoot);
  });

  it("`sync set <path>` writes globalDir into amp.json", () => {
    const r = runSync(project, ["set", "/some/sync/dir"]);
    expect(r.status).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(path.join(project, ".ai-memory", "amp.json"), "utf8"));
    expect(cfg.globalDir).toBe("/some/sync/dir");
  });

  it("`sync clear` removes globalDir from amp.json", () => {
    runSync(project, ["set", "/some/sync/dir"]);
    const r = runSync(project, ["clear", "--json"]);
    expect(r.status).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(path.join(project, ".ai-memory", "amp.json"), "utf8"));
    expect(cfg.globalDir).toBeUndefined();
  });

  it("`sync migrate --dry-run` reports what would move without writing", () => {
    // Seed local global.jsonl, then enable sync.
    const localFile = path.join(project, ".ai-memory", "global.jsonl");
    fs.writeFileSync(localFile,
      JSON.stringify({ type: "preference", msg: "x", ts: 1, id: "amp_X" }) + "\n" +
      JSON.stringify({ type: "preference", msg: "y", ts: 2, id: "amp_Y" }) + "\n");
    runSync(project, ["set", syncedRoot]);
    const r = runSync(project, ["migrate", "--dry-run", "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.fromLocal).toBe(2);
    // Local file must still exist after dry-run.
    expect(fs.existsSync(localFile)).toBe(true);
  });

  it("`sync migrate` moves entries and archives the local copy", () => {
    const localFile = path.join(project, ".ai-memory", "global.jsonl");
    fs.writeFileSync(localFile,
      JSON.stringify({ type: "preference", msg: "x", ts: 1, id: "amp_X" }) + "\n");
    runSync(project, ["set", syncedRoot]);
    const r = runSync(project, ["migrate", "--json"]);
    expect(r.status).toBe(0);

    const parsed = JSON.parse(r.stdout);
    expect(parsed.afterMerge).toBe(1);
    // Target file exists at <syncedRoot>/<slug>/global.jsonl
    const slug = projectSlug(project);
    const target = path.join(syncedRoot, slug, "global.jsonl");
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toContain('"id":"amp_X"');
    // Original archived.
    expect(fs.existsSync(localFile)).toBe(false);
    const ampMemDir = path.join(project, ".ai-memory");
    const archived = fs.readdirSync(ampMemDir).filter(n => /global-archive-/.test(n));
    expect(archived.length).toBe(1);
  });

  it("`sync migrate` is idempotent (dedupes by id when re-run)", () => {
    const localFile = path.join(project, ".ai-memory", "global.jsonl");
    fs.writeFileSync(localFile,
      JSON.stringify({ type: "preference", msg: "x", ts: 1, id: "amp_X" }) + "\n");
    runSync(project, ["set", syncedRoot]);
    runSync(project, ["migrate"]);

    // Simulate a re-migrate after another machine's write added an entry already.
    const slug = projectSlug(project);
    const target = path.join(syncedRoot, slug, "global.jsonl");
    const before = fs.readFileSync(target, "utf8");

    // Restore a copy of the same local file and re-migrate.
    fs.writeFileSync(localFile,
      JSON.stringify({ type: "preference", msg: "x", ts: 1, id: "amp_X" }) + "\n");
    runSync(project, ["migrate"]);
    const after = fs.readFileSync(target, "utf8");
    // Same content as before — no duplicate of amp_X.
    expect(after).toBe(before);
  });

  it("rejects unknown subverbs with exit 1", () => {
    const r = runSync(project, ["nope"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Unknown sync verb/);
  });
});
