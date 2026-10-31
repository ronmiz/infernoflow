/**
 * 0.46.6 — the rule-file block is the same on every clone:
 * no commit list by default, shared (git-tracked) entries only, bookmarks
 * refresh it like `log` does, and AGENTS.md gets it when the project has one.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { appendEntry, readSharedEntries, _resetGitStampCache } from "../lib/amp/io.mjs";
import { refreshRuleFilesFromMemory } from "../lib/ruleFiles.mjs";
import { _resetProjectRootCache } from "../lib/projectRoot.mjs";
import { _resetBranchCache } from "../lib/git/branch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BIN  = path.join(ROOT, "bin", "infernoflow.mjs");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const env = (home) => ({ ...process.env, NO_COLOR: "1", INFERNOFLOW_HOME: home, CLAUDECODE: "", CLAUDE_CODE_SESSION: "" });
const cli = (args, cwd, home) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", timeout: 30_000, env: env(home), input: "" });

function initGit(dir, name) {
  git(dir, "config", "user.name", name);
  git(dir, "config", "user.email", `${name.toLowerCase()}@example.com`);
  git(dir, "config", "commit.gpgsign", "false");
}
function project() {
  const dir = path.join(tmp("infernoflow-rf-"), "proj");
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  git(path.dirname(dir), "init", "-q", dir);
  initGit(dir, "Dana");
  fs.writeFileSync(path.join(dir, "app.js"), "console.log(1)\n");
  git(dir, "add", "app.js");
  git(dir, "commit", "-qm", "init");
  fs.writeFileSync(path.join(dir, ".ai-memory", ".last-cli-version"), VERSION);
  return dir;
}

beforeEach(() => { _resetProjectRootCache(); _resetBranchCache(); _resetGitStampCache(); });

describe("rule-file block", () => {
  it("has no commit list by default", () => {
    const dir = project();
    appendEntry(dir, { type: "gotcha", msg: "app.js logs on load" });
    refreshRuleFilesFromMemory(dir);
    const text = read(path.join(dir, ".cursorrules"));
    expect(text).toContain("app.js logs on load");
    expect(text).not.toContain("Recent commits");
  });

  it("--max-commits 0 really means none (it used to fall back to 10)", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, ".ai-memory", "amp.json"), JSON.stringify({ config: { injection: { maxCommits: 0 } } }));
    appendEntry(dir, { type: "note", msg: "x" });
    refreshRuleFilesFromMemory(dir);
    expect(read(path.join(dir, ".cursorrules"))).not.toContain("Recent commits");
    fs.writeFileSync(path.join(dir, ".ai-memory", "amp.json"), JSON.stringify({ config: { injection: { maxCommits: 2 } } }));
    refreshRuleFilesFromMemory(dir);
    expect(read(path.join(dir, ".cursorrules"))).toContain("Recent commits");
  });

  it("leaves out personal and local-only entries (they must not reach git)", () => {
    const dir = project();
    appendEntry(dir, { type: "gotcha", msg: "shared gotcha" });
    appendEntry(dir, { type: "preference", msg: "personal preference" });
    appendEntry(dir, { type: "note", msg: "Session ended — local resume point", tags: ["bookmark", "auto-handoff"], localOnly: true });
    expect(readSharedEntries(dir).map(e => e.summary)).toEqual(["shared gotcha"]);
    refreshRuleFilesFromMemory(dir);
    const text = read(path.join(dir, ".cursorrules"));
    expect(text).toContain("shared gotcha");
    expect(text).not.toContain("personal preference");
    expect(text).not.toContain("Session ended");
  });

  it("AGENTS.md gets the block only when the project has one (or targets name it)", () => {
    const dir = project();
    appendEntry(dir, { type: "gotcha", msg: "agents gotcha" });
    refreshRuleFilesFromMemory(dir);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Agents\n\nOur own instructions.\n");
    refreshRuleFilesFromMemory(dir);
    const text = read(path.join(dir, "AGENTS.md"));
    expect(text).toContain("agents gotcha");
    expect(text).toContain("Our own instructions.");
    // Explicit targets without AGENTS.md: the block is removed, the user's text stays.
    fs.writeFileSync(path.join(dir, ".ai-memory", "amp.json"), JSON.stringify({ config: { injection: { targets: [".cursorrules"] } } }));
    refreshRuleFilesFromMemory(dir);
    expect(read(path.join(dir, "AGENTS.md"))).not.toContain("agents gotcha");
    expect(read(path.join(dir, "AGENTS.md"))).toContain("Our own instructions.");
  });

  it("bookmark refreshes the rule files like log does", () => {
    const dir = project();
    const home = tmp("infernoflow-rfh-");
    expect(cli(["log", "first gotcha", "--type", "gotcha"], dir, home).status).toBe(0);
    expect(cli(["bookmark", "auth: stopped here", "--note", "next: refreshToken"], dir, home).status).toBe(0);
    expect(read(path.join(dir, ".cursorrules"))).toContain("auth: stopped here");
  });
});

describe("a teammate's clone stays clean", () => {
  it("pulling memory and running the CLI doesn't change the committed rule files", () => teamClone([]));
  // 0.47.0: Windows checkouts (core.autocrlf=true) have CRLF rule files; the
  // refresh must keep them byte-identical, not rewrite them with LF.
  it("…also when git checks the files out with CRLF (Windows autocrlf)", () => teamClone(["-c", "core.autocrlf=true"]));

  it("an update keeps the file's CRLF line endings", () => {
    const dir = project();
    appendEntry(dir, { type: "gotcha", msg: "first" });
    refreshRuleFilesFromMemory(dir);
    const f = path.join(dir, ".cursorrules");
    fs.writeFileSync(f, ("# Team rules\n\n" + read(f)).replace(/\n/g, "\r\n"));
    const before = read(f);
    refreshRuleFilesFromMemory(dir);
    expect(read(f)).toBe(before);                         // nothing new: untouched
    appendEntry(dir, { type: "gotcha", msg: "second" });
    refreshRuleFilesFromMemory(dir);
    const after = read(f);
    expect(after).toContain("second");
    expect(after).toContain("# Team rules");
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");   // every line still ends in CRLF
  });
});

function teamClone(cloneOpts) {
  {
    const base = tmp("infernoflow-team-");
    const home = tmp("infernoflow-teamh-");
    const remote = path.join(base, "remote.git");
    git(base, "init", "-q", "--bare", remote);
    const a = path.join(base, "dana");
    git(base, "clone", "-q", remote, a);
    initGit(a, "Dana");
    fs.writeFileSync(path.join(a, "app.js"), "console.log(1)\n");
    git(a, "add", "."); git(a, "commit", "-qm", "init"); git(a, "push", "-q", "origin", "HEAD");
    fs.mkdirSync(path.join(a, ".ai-memory"), { recursive: true });
    fs.writeFileSync(path.join(a, ".ai-memory", ".last-cli-version"), VERSION);
    expect(cli(["log", "Auth API returns 200 on errors", "--type", "gotcha", "--file", "app.js"], a, home).status).toBe(0);
    expect(cli(["bookmark", "auth: stopped at refresh", "--note", "next: same check in refreshToken"], a, home).status).toBe(0);
    git(a, "add", ".ai-memory", ".cursorrules", ".github", "CLAUDE.md"); git(a, "commit", "-qm", "memory"); git(a, "push", "-q", "origin", "HEAD");

    const b = path.join(base, "omer");
    git(base, "clone", "-q", ...cloneOpts, remote, b);
    initGit(b, "Omer");
    fs.writeFileSync(path.join(b, ".ai-memory", ".last-cli-version"), VERSION);
    expect(cli(["refresh"], b, home).status).toBe(0);
    expect(cli(["status"], b, home).status).toBe(0);
    const dirty = git(b, "status", "--porcelain").split("\n").filter(Boolean)
      .filter(l => /\.cursorrules|copilot-instructions|CLAUDE\.md|AGENTS\.md/.test(l));
    expect(dirty).toEqual([]);
    expect(read(path.join(b, ".cursorrules"))).toContain("auth: stopped at refresh");
    if (cloneOpts.length) expect(read(path.join(b, ".cursorrules"))).toContain("\r\n");   // the CRLF checkout really happened
  }
}
