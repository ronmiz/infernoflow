/**
 * 0.46.3 Fix #2 — memory-mode projects (no inferno/contract.json) are not told
 * to "run infernoflow init": check and context explain the mode and exit 0,
 * and generate-skills (contract-only) says how to enable full mode.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BIN  = path.join(ROOT, "bin", "infernoflow.mjs");

let dir, home;
beforeEach(() => {
  dir  = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-memmode-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-memmode-home-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".ai-memory", ".last-cli-version"), JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
});
afterEach(() => { for (const d of [dir, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], {
  cwd: dir, encoding: "utf8", timeout: 30_000,
  env: { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming") },
});

describe("memory mode", () => {
  it("check exits 0 and explains the mode instead of 'run init'", () => {
    const r = cli("check");
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Memory mode/);
    expect(r.stdout + r.stderr).toMatch(/init --mode full --adopt/);
  });

  it("check --json reports a skipped, ok check", () => {
    const r = cli("check", "--json");
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(j).toMatchObject({ ok: true, mode: "memory", skipped: true });
  });

  it("context shows the memory resume instead of failing", () => {
    const r = cli("context");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/memory mode/i);
  });

  it("generate-skills says the skills need a contract", () => {
    const r = cli("generate-skills");
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/init --mode full --adopt/);
  });
});

describe("check stays a real gate", () => {
  const git = (...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" });
  it("a contract that git knows about but is missing from disk fails", () => {
    fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
    git("init", "-q");
    fs.mkdirSync(path.join(dir, "inferno"));
    fs.writeFileSync(path.join(dir, "inferno", "contract.json"), "{}");
    git("add", "inferno/contract.json"); git("commit", "-q", "-m", "contract");
    fs.rmSync(path.join(dir, "inferno"), { recursive: true, force: true });
    const r = cli("check", "--json");
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toMatch(/"mode":"memory"/);
  });

  it("--strict fails in memory mode (CI gates)", () => {
    expect(cli("check", "--strict").status).not.toBe(0);
  });
});
