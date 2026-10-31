/**
 * 0.47.0 — portable Cursor / VS Code MCP entries.
 *
 * .vscode/mcp.json and .cursor/mcp.json are usually committed. Before 0.47.0
 * every machine that ran setup wrote its own absolute paths into them, so a
 * pull left them dirty and a teammate's server pointed at someone else's disk.
 * Both editors start the server in the opened folder and expand
 * ${workspaceFolder} (verified on Windows, 2026-10-31).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cliInstallKind, portableIdeEntry, isPortableEntry, hasMachinePath, updateIdeMcpJson, WORKSPACE_VAR,
} from "../lib/mcpRegistration.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rd  = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
const envFor = (home) => ({ ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), XDG_CONFIG_HOME: path.join(home, ".config"), INFERNOFLOW_HOME: path.join(home, ".infernoflow") });

const OLD = (dir) => ({ command: "node", args: ["C:\\Users\\dana\\AppData\\Roaming\\npm\\node_modules\\infernoflow\\dist\\bin\\infernoflow.mjs", "mcp"], env: { INFERNOFLOW_PROJECT_DIR: dir } });

describe("portable entry", () => {
  it("names the command only: global install → infernoflow, npx cache / local install → npx", () => {
    const proj = path.resolve("/work/app");
    expect(cliInstallKind(proj, path.resolve("/usr/lib/node_modules/infernoflow/dist/bin/infernoflow.mjs"))).toBe("global");
    expect(cliInstallKind(proj, path.join(proj, "node_modules", "infernoflow", "dist", "bin", "infernoflow.mjs"))).toBe("local");
    expect(cliInstallKind(proj, path.resolve("/home/u/.npm/_npx/abc/node_modules/infernoflow/dist/bin/infernoflow.mjs"))).toBe("npx");

    const g = portableIdeEntry("vscode", proj, path.resolve("/usr/lib/node_modules/infernoflow/dist/bin/infernoflow.mjs"));
    expect(g).toEqual({ type: "stdio", command: "infernoflow", args: ["mcp"], env: { INFERNOFLOW_PROJECT_DIR: WORKSPACE_VAR } });
    const l = portableIdeEntry("cursor", proj, path.join(proj, "node_modules", "infernoflow", "bin", "infernoflow.mjs"));
    expect(l).toEqual({ command: "npx", args: ["-y", "infernoflow", "mcp"], env: { INFERNOFLOW_PROJECT_DIR: WORKSPACE_VAR } });
    for (const e of [g, l]) { expect(isPortableEntry(e)).toBe(true); expect(hasMachinePath(e)).toBe(false); }
  });

  it("recognises machine-specific entries", () => {
    expect(isPortableEntry(OLD("C:\\Ron\\app"))).toBe(false);
    expect(hasMachinePath(OLD("C:\\Ron\\app"))).toBe(true);
    expect(hasMachinePath({ command: "infernoflow", args: ["mcp"], env: { INFERNOFLOW_PROJECT_DIR: "/home/dana/app" } })).toBe(true);
    expect(isPortableEntry({ command: "infernoflow", args: ["mcp"], env: { INFERNOFLOW_PROJECT_DIR: "/home/dana/app" } })).toBe(false);
    expect(isPortableEntry({ command: "infernoflow.cmd", args: ["mcp"] })).toBe(true);           // no env: cwd decides
    expect(isPortableEntry({ command: "npx", args: ["infernoflow@0.47.0", "mcp"] })).toBe(true);
    expect(isPortableEntry({ command: "npx", args: ["-y", "evil", "mcp"] })).toBe(false);
  });
});

describe("updateIdeMcpJson", () => {
  let dir;
  beforeEach(() => { dir = tmp("infernoflow-pm-"); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it("rewrites an old machine-path entry, keeps other servers and the user's extra env", () => {
    const file = path.join(dir, ".vscode", "mcp.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const old = OLD(dir); old.env.DEBUG = "1";
    fs.writeFileSync(file, JSON.stringify({ servers: { infernoflow: { type: "stdio", ...old }, other: { command: "x" } } }, null, 2));
    const r = updateIdeMcpJson(dir, "vscode");
    expect(r).toMatchObject({ updated: true, migrated: true });
    const s = rd(file).servers;
    expect(s.other).toEqual({ command: "x" });
    expect(s.infernoflow.env).toEqual({ DEBUG: "1", INFERNOFLOW_PROJECT_DIR: WORKSPACE_VAR });
    expect(hasMachinePath(s.infernoflow)).toBe(false);
  });

  it("is idempotent, and never replaces another machine's portable form", () => {
    const file = path.join(dir, ".cursor", "mcp.json");
    expect(updateIdeMcpJson(dir, "cursor").updated).toBe(true);
    const first = fs.readFileSync(file, "utf8");
    expect(updateIdeMcpJson(dir, "cursor").updated).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(first);
    // A teammate committed the npx form: a global-install machine leaves it alone.
    const npx = { mcpServers: { infernoflow: { command: "npx", args: ["-y", "infernoflow", "mcp"], env: { INFERNOFLOW_PROJECT_DIR: WORKSPACE_VAR } } } };
    fs.writeFileSync(file, JSON.stringify(npx, null, 2) + "\n");
    expect(updateIdeMcpJson(dir, "cursor").updated).toBe(false);
    expect(rd(file)).toEqual(npx);
  });
});

describe("two clones stay clean", () => {
  let root, homeA, homeB;
  beforeEach(() => { root = tmp("infernoflow-pmc-"); homeA = tmp("infernoflow-pmha-"); homeB = tmp("infernoflow-pmhb-"); });
  afterEach(() => { for (const d of [root, homeA, homeB]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

  it("setup in a second clone leaves the committed IDE configs untouched", () => {
    const remote = path.join(root, "remote.git");
    git(root, "init", "-q", "--bare", remote);
    const A = path.join(root, "dana");
    git(root, "clone", "-q", remote, A);
    for (const [k, v] of [["user.name", "Dana"], ["user.email", "d@example.com"], ["commit.gpgsign", "false"]]) git(A, "config", k, v);
    fs.writeFileSync(path.join(A, "app.js"), "1\n");
    expect(spawnSync(process.execPath, [BIN, "setup", "--yes"], { cwd: A, env: envFor(homeA), encoding: "utf8", timeout: 60_000 }).status).toBe(0);
    for (const f of [".vscode/mcp.json", ".cursor/mcp.json"]) {
      const txt = fs.readFileSync(path.join(A, f), "utf8");
      expect(txt).not.toContain(A);
      expect(txt).toContain(WORKSPACE_VAR);
    }
    git(A, "add", "-A"); git(A, "commit", "-qm", "setup"); git(A, "push", "-q", "origin", "HEAD");

    const B = path.join(root, "omer", "somewhere-else");
    fs.mkdirSync(path.dirname(B), { recursive: true });
    git(root, "clone", "-q", remote, B);
    expect(spawnSync(process.execPath, [BIN, "setup", "--yes"], { cwd: B, env: envFor(homeB), encoding: "utf8", timeout: 60_000 }).status).toBe(0);
    const dirty = git(B, "status", "--porcelain", "--", ".vscode/mcp.json", ".cursor/mcp.json");
    expect(dirty).toBe("");
  }, 120_000);
});

describe("server with a committed config", () => {
  let home;
  beforeEach(() => { home = tmp("infernoflow-pmsh-"); });

  async function call(cwd, env, msg) {
    const proc = spawn(process.execPath, [BIN, "mcp"], { cwd, env: { ...envFor(home), ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", d => { out += d; });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "amp_write", arguments: { type: "gotcha", msg } } }) + "\n");
    await new Promise(r => setTimeout(r, 1500));
    proc.stdin.end();
    await new Promise(r => proc.on("exit", r));
    return out.split("\n").filter(Boolean).map(l => JSON.parse(l)).find(l => l.id === 2).result;
  }

  it("an unexpanded ${workspaceFolder} falls back to the folder the editor started it in", async () => {
    const dir = tmp("infernoflow-pms-");
    fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
    git(dir, "init", "-q");
    const res = await call(dir, { INFERNOFLOW_PROJECT_DIR: WORKSPACE_VAR, WORKSPACE_FOLDER_PATHS: "" }, "written via cwd");
    expect(res.isError).toBeFalsy();
    const files = fs.readdirSync(path.join(dir, ".ai-memory"), { recursive: true }).filter(f => String(f).endsWith(".jsonl"));
    expect(files.some(f => fs.readFileSync(path.join(dir, ".ai-memory", String(f)), "utf8").includes("written via cwd"))).toBe(true);
    expect(fs.existsSync(path.join(dir, WORKSPACE_VAR))).toBe(false);
  }, 30_000);

  it("refuses to start a memory store in a folder that isn't set up", async () => {
    const dir = tmp("infernoflow-pmn-");
    git(dir, "init", "-q");
    const res = await call(dir, { INFERNOFLOW_PROJECT_DIR: "", WORKSPACE_FOLDER_PATHS: "" }, "should not land");
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("isn't set up");
    expect(fs.existsSync(path.join(dir, ".ai-memory"))).toBe(false);
  }, 30_000);
});

describe("doctor", () => {
  it("warns about a machine-path entry and --fix rewrites it", () => {
    const dir = tmp("infernoflow-pmd-"), home = tmp("infernoflow-pmdh-");
    fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".vscode"), { recursive: true });
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, ".vscode", "mcp.json"), JSON.stringify({ servers: { infernoflow: { type: "stdio", ...OLD(dir) } } }));
    const doc = (...a) => spawnSync(process.execPath, [BIN, "doctor", ...a], { cwd: dir, env: envFor(home), encoding: "utf8", timeout: 60_000 });
    const j = JSON.parse(doc("--json").stdout);
    const list = j.results || j.checks || j;
    expect(list.find(r => r.label === "MCP portability")).toMatchObject({ status: "warn" });
    doc("--fix");
    expect(hasMachinePath(rd(path.join(dir, ".vscode", "mcp.json")).servers.infernoflow)).toBe(false);
  }, 120_000);
});
