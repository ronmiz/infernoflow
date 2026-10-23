/**
 * 0.46.5 — memory maintenance: suggest (default) / auto / off.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { appendEntry, readEntries, writeDefaultConfig, readConfig, _resetGitStampCache } from "../lib/amp/io.mjs";
import { _resetProjectRootCache } from "../lib/projectRoot.mjs";
import { _resetBranchCache } from "../lib/git/branch.mjs";
import { maintenanceSettings, maintenanceSuggestions } from "../lib/maintenance.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BIN  = path.join(ROOT, "bin", "infernoflow.mjs");

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });

function repo() {
  const dir = path.join(tmp("infernoflow-m-"), "proj");
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  git(dir, "init", "-q");
  git(dir, "config", "user.name", "Test Dev");
  git(dir, "config", "user.email", "dev@example.com");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "app.js"), "console.log(1)\n");
  git(dir, "add", "app.js");
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" } });
  fs.writeFileSync(path.join(dir, ".ai-memory", ".last-cli-version"), JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
  return dir;
}
const cli = (args, cwd, env = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", timeout: 30_000, input: "{}", env: { ...process.env, NO_COLOR: "1", INFERNOFLOW_HOME: tmp("infernoflow-mh-"), ...env } });
const setMode = (dir, maintenance) => fs.writeFileSync(path.join(dir, ".ai-memory", "amp.json"), JSON.stringify({ amp: "1.0", config: { maintenance } }, null, 2));
const noise = (dir, n = 3) => { for (let i = 0; i < n; i++) appendEntry(dir, { type: "note", msg: `commit: wip ${i}`, source: "git-hook", auto: true }); };

beforeEach(() => { _resetProjectRootCache(); _resetBranchCache(); _resetGitStampCache(); });

describe("maintenance settings", () => {
  it("defaults to suggest; accepts a string or an object; ignores junk", () => {
    expect(maintenanceSettings(null)).toEqual({ mode: "suggest", thresholds: { curate: 3, stale: 3, prune: 20 } });
    expect(maintenanceSettings({ config: { maintenance: "off" } }).mode).toBe("off");
    expect(maintenanceSettings({ config: { maintenance: "bogus" } }).mode).toBe("suggest");
    const s = maintenanceSettings({ config: { maintenance: { mode: "auto", thresholds: { curate: 1, stale: -2 } } } });
    expect(s).toEqual({ mode: "auto", thresholds: { curate: 1, stale: 3, prune: 20 } });
  });

  it("new projects get maintenance: \"suggest\" in amp.json", () => {
    const dir = repo();
    writeDefaultConfig(dir);
    expect(readConfig(dir).config.maintenance).toBe("suggest");
  });
});

describe("maintenance hints", () => {
  let dir;
  beforeEach(() => { dir = repo(); });

  it("status suggests curate when noise reaches the threshold, and not below it", () => {
    noise(dir, 2);
    expect(cli(["status"], dir).stdout).not.toContain("curate --apply");
    noise(dir, 1);
    const r = cli(["status"], dir);
    expect(r.stdout).toContain("Maintenance");
    expect(r.stdout).toContain("infernoflow curate --apply");
    const j = JSON.parse(cli(["status", "--json"], dir).stdout);
    expect(j.maintenance.mode).toBe("suggest");
    expect(j.maintenance.suggestions.map(s => s.kind)).toContain("curate");
  });

  it("off hides every hint", () => {
    noise(dir, 5);
    setMode(dir, "off");
    expect(cli(["status"], dir).stdout).not.toContain("Maintenance");
    expect(cli(["hook", "session-start"], dir).stdout).not.toContain("Memory maintenance");
    expect(cli(["recap"], dir).stdout).not.toContain("Memory maintenance");
  });

  it("session-start shows the hint at most once a day and never runs the command", () => {
    noise(dir, 3);
    const first = cli(["hook", "session-start"], dir).stdout;
    expect(first).toContain("## Memory maintenance");
    expect(first).toContain("infernoflow curate --apply");
    expect(first).toContain("Don't run these commands without asking");
    expect(readEntries(dir).filter(e => /^commit: wip/.test(e.summary)).length).toBe(3);   // suggest mode changes nothing
    expect(cli(["hook", "session-start"], dir).stdout).not.toContain("Memory maintenance");
    expect(fs.existsSync(path.join(dir, ".ai-memory", ".maintenance-state.json"))).toBe(true);
  });

  it("suggests reviewing entries whose file changed since they were written", () => {
    for (let i = 0; i < 3; i++) appendEntry(dir, { type: "gotcha", msg: `app.js quirk ${i}`, file: "app.js" });
    const kinds = () => JSON.parse(cli(["status", "--json"], dir).stdout).maintenance.suggestions;
    expect(kinds().some(x => x.kind === "stale")).toBe(false);
    fs.writeFileSync(path.join(dir, "app.js"), "console.log(2)\n");   // working-tree change counts
    expect(kinds().find(x => x.kind === "stale")?.count).toBe(3);
    expect(maintenanceSuggestions(dir, { signals: { curate: 0, stale: 3, prune: 0 } }).map(x => x.command)).toEqual(["infernoflow resume"]);
  });
});

describe("maintenance auto mode", () => {
  it("cleans noise once a day, archives it first, and keeps gotchas and decisions", () => {
    const dir = repo();
    const home = tmp("infernoflow-mh-");
    setMode(dir, "auto");
    noise(dir, 3);
    appendEntry(dir, { type: "gotcha", msg: "keep this gotcha" });
    appendEntry(dir, { type: "decision", msg: "keep this decision" });
    const r = cli(["hook", "session-start"], dir, { INFERNOFLOW_HOME: home });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Automatic maintenance ran: removed 3 noisy entries");
    const left = readEntries(dir);
    expect(left.some(e => /^commit: wip/.test(e.summary))).toBe(false);
    expect(left.some(e => e.summary === "keep this gotcha")).toBe(true);
    expect(left.some(e => e.summary === "keep this decision")).toBe(true);
    expect(fs.readdirSync(path.join(home, "backups")).some(f => f.includes("-curated-"))).toBe(true);
    // Same day: nothing runs again, even with fresh noise.
    noise(dir, 3);
    const again = cli(["hook", "session-start"], dir, { INFERNOFLOW_HOME: home }).stdout;
    expect(again).not.toContain("Automatic maintenance ran");
    expect(readEntries(dir).filter(e => /^commit: wip/.test(e.summary)).length).toBe(3);
  });
});
