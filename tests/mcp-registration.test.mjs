/**
 * Per-project MCP registration (0.45.0) — D1/D2/F5 + F4 + D4.
 *
 * Before 0.45.0, `setup` and the silent upgrade backfill wrote ONE user-level
 * `infernoflow` entry (~/.claude.json, Claude Desktop) pinned to the last
 * project, so every repo read/wrote that project's memory and ran a server
 * file from inside that repo.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs");

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rd  = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

function project(name, root) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  try { execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" }); } catch { fs.mkdirSync(path.join(dir, ".git"), { recursive: true }); }
  return dir;
}

function desktopConfig(home) {
  if (process.platform === "win32")  return path.join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}

function envFor(home) {
  return { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), XDG_CONFIG_HOME: path.join(home, ".config"), INFERNOFLOW_HOME: path.join(home, ".infernoflow") };
}

const run = (args, cwd, home) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", timeout: 60_000, env: envFor(home) });

const LEGACY = (dir) => ({ command: "node", args: [path.join(dir, ".cursor", "inferno-mcp-server.mjs")], env: { INFERNOFLOW_PROJECT_DIR: dir } });

describe("setup registers per project, never one pinned user-level entry", () => {
  let root, home, A, B;
  beforeEach(() => {
    root = tmp("infernoflow-reg-"); home = tmp("infernoflow-reghome-");
    A = project("alpha", root); B = project("beta", root);
    // A legacy pinned entry in both user-level configs, plus a server of the user's own.
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { infernoflow: LEGACY(B), mine: { command: "x" } }, projects: { keep: true } }));
    fs.mkdirSync(path.dirname(desktopConfig(home)), { recursive: true });
    fs.writeFileSync(desktopConfig(home), JSON.stringify({ mcpServers: { infernoflow: LEGACY(B), other: { command: "y" } } }));
  });
  afterEach(() => { for (const d of [root, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

  it("setup in A then B: each project points at itself; the pinned entries are gone (with backups)", () => {
    expect(run(["setup", "--yes"], A, home).status).toBe(0);
    expect(run(["setup", "--yes"], B, home).status).toBe(0);

    for (const dir of [A, B]) {
      const e = rd(path.join(dir, ".mcp.json")).mcpServers.infernoflow;
      expect(e.command).toBe("node");
      expect(e.args[0]).toBe(BIN);
      expect(e.args[1]).toBe("mcp");
      expect(fs.realpathSync(e.env.INFERNOFLOW_PROJECT_DIR)).toBe(fs.realpathSync(dir));
      expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toMatch(/^\.mcp\.json$/m);
      expect(fs.existsSync(path.join(dir, ".cursor", "inferno-mcp-server.mjs"))).toBe(false); // no copy in the repo
      expect(rd(path.join(dir, ".vscode", "mcp.json")).servers.infernoflow.args[1]).toBe("mcp");
      expect(rd(path.join(dir, ".cursor", "mcp.json")).mcpServers.infernoflow.args[1]).toBe("mcp");
    }

    const cj = rd(path.join(home, ".claude.json"));
    expect(cj.mcpServers.infernoflow).toBeUndefined();
    expect(cj.mcpServers.mine).toEqual({ command: "x" });   // user's own server untouched
    expect(cj.projects).toEqual({ keep: true });             // nothing else touched

    const dc = rd(desktopConfig(home)).mcpServers;
    expect(dc.infernoflow).toBeUndefined();
    expect(fs.realpathSync(dc["infernoflow-alpha"].env.INFERNOFLOW_PROJECT_DIR)).toBe(fs.realpathSync(A));
    expect(fs.realpathSync(dc["infernoflow-beta"].env.INFERNOFLOW_PROJECT_DIR)).toBe(fs.realpathSync(B));
    expect(dc.other).toEqual({ command: "y" });

    const backups = fs.readdirSync(path.join(home, ".infernoflow", "backups"));
    expect(backups.some(f => f.startsWith(".claude.json."))).toBe(true);
    expect(backups.some(f => f.startsWith("claude_desktop_config.json."))).toBe(true);
  });

  it("never modifies a .mcp.json that git tracks, and then keeps the user-level entry", () => {
    fs.writeFileSync(path.join(A, ".mcp.json"), JSON.stringify({ mcpServers: { team: { command: "t" } } }, null, 2));
    try {
      execFileSync("git", ["add", ".mcp.json"], { cwd: A, stdio: "ignore" });
    } catch { return; } // no git available — nothing to test
    const before = fs.readFileSync(path.join(A, ".mcp.json"), "utf8");
    run(["setup", "--yes"], A, home);
    expect(fs.readFileSync(path.join(A, ".mcp.json"), "utf8")).toBe(before);
    expect(rd(path.join(home, ".claude.json")).mcpServers.infernoflow).toBeDefined(); // not removed: A has no other registration
  });

  it("the upgrade backfill never (re)creates a user-level infernoflow entry", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: {} }));
    fs.writeFileSync(path.join(A, ".ai-memory", ".last-cli-version"), "0.44.19");
    const r = run(["log", "--show"], A, home);
    expect(r.status).toBe(0);
    expect(rd(path.join(home, ".claude.json")).mcpServers.infernoflow).toBeUndefined();
    expect(fs.realpathSync(rd(path.join(A, ".mcp.json")).mcpServers.infernoflow.env.INFERNOFLOW_PROJECT_DIR)).toBe(fs.realpathSync(A));
  });
});

describe("`infernoflow mcp` runs the packaged server", () => {
  let dir, home;
  beforeEach(() => { home = tmp("infernoflow-mcphome-"); dir = project("p", tmp("infernoflow-mcp-")); });

  it("answers initialize/tools/list and writes to INFERNOFLOW_PROJECT_DIR, reporting the store", async () => {
    const proc = spawn(process.execPath, [BIN, "mcp"], { cwd: os.tmpdir(), env: { ...envFor(home), INFERNOFLOW_PROJECT_DIR: dir }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", d => { out += d; });
    const send = (m) => proc.stdin.write(JSON.stringify(m) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "amp_write", arguments: { type: "gotcha", msg: "hello from mcp" } } });
    await new Promise(r => setTimeout(r, 1500));
    proc.stdin.end();
    await new Promise(r => proc.on("exit", r));
    const lines = out.split("\n").filter(Boolean).map(l => JSON.parse(l));   // stdout is pure JSON-RPC
    expect(lines.find(l => l.id === 1).result.serverInfo.name).toBe("infernoflow");
    expect(lines.find(l => l.id === 2).result.tools.length).toBeGreaterThan(5);
    const w = lines.find(l => l.id === 3).result.content[0].text;
    expect(w).toContain(`store: ${path.join(dir, ".ai-memory")}`);
    expect(fs.readFileSync(path.join(dir, ".ai-memory", "sessions.jsonl"), "utf8")).toContain("hello from mcp");
  }, 30_000);
});

describe("API keys never stay in the project (F4)", () => {
  let dir, home;
  beforeEach(() => { home = tmp("infernoflow-aihome-"); dir = project("p", tmp("infernoflow-ai-")); });

  it("moves an apiKey from inferno/integrations.json to ~/.infernoflow/ai-credentials.json", () => {
    fs.mkdirSync(path.join(dir, "inferno"), { recursive: true });
    fs.writeFileSync(path.join(dir, "inferno", "integrations.json"), JSON.stringify({ anthropic: { apiKey: "sk-ant-test-123", model: "m" } }));
    const r = run(["ai", "status"], dir, home);
    expect(r.stderr).toMatch(/moved API key/);
    const proj = rd(path.join(dir, "inferno", "integrations.json"));
    expect(proj.anthropic.apiKey).toBeUndefined();
    expect(proj.anthropic.model).toBe("m");
    const credFile = path.join(home, ".infernoflow", "ai-credentials.json");
    expect(rd(credFile).providers.anthropic.apiKey).toBe("sk-ant-test-123");
    if (process.platform !== "win32") expect(fs.statSync(credFile).mode & 0o077).toBe(0);
  });

  it("gitignores inferno/integrations.json", () => {
    fs.writeFileSync(path.join(dir, ".ai-memory", ".last-cli-version"), "0.44.19");
    run(["log", "--show"], dir, home);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain("inferno/integrations.json");
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain(".ai-memory/details.local.jsonl");
  });
});

describe("doctor reports the security state (D4)", () => {
  let dir, home;
  beforeEach(() => { home = tmp("infernoflow-dochome-"); dir = project("p", tmp("infernoflow-doc-")); });

  it("flags a pinned user-level entry, outdated copies and secrets in memory", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { infernoflow: LEGACY("/some/other/repo") } }));
    fs.mkdirSync(path.join(dir, ".claude", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "hooks", "log-frustration.mjs"), "spawnSync('infernoflow', [], { shell: true })\n");
    fs.writeFileSync(path.join(dir, ".ai-memory", "sessions.jsonl"), JSON.stringify({ type: "note", msg: "ghp_" + "a".repeat(36), ts: 1, id: "amp_1" }) + "\n");
    const r = run(["doctor", "--json"], dir, home);
    const out = JSON.parse(r.stdout);
    const res = Array.isArray(out) ? out : (out.results || out.checks || []);
    const by = (label) => res.find(x => x.label === label);
    expect(by("MCP registration").status).toBe("warn");
    expect(by("Generated copies").status).toBe("warn");
    expect(by("Secrets in memory").status).toBe("warn");
  });
});
