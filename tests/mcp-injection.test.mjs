/**
 * MCP server — command-injection regression tests (security fix, 0.44.20).
 *
 * Before 0.44.20 the server built shell command strings out of tool arguments
 * and ran them with execSync, so a crafted argument (which the model can be
 * steered into sending by anything it reads) ran commands on the user's
 * machine. Every payload below created a file on 0.44.19.
 *
 * Each payload tries to create a marker file using BOTH POSIX (`;`, `$( )`,
 * backticks) and Windows cmd.exe (`&`, `|`) separators, so the test is
 * meaningful on every OS in the CI matrix. The test passes only if no marker
 * file appears and the server stays up.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = path.resolve(__dirname, "..", "templates", "cursor", "inferno-mcp-server.mjs");

function makeCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-inj-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"),       { recursive: true });
  return dir;
}

function drive(cwd, messages) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [MCP_SERVER], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", INFERNOFLOW_PROJECT_DIR: cwd },
    });
    let out = "";
    proc.stdout.on("data", d => { out += d.toString("utf8"); });
    proc.stderr.on("data", () => {});
    const timer = setTimeout(() => { proc.kill(); reject(new Error("MCP server timed out\n" + out)); }, 60_000);
    proc.on("exit", () => {
      clearTimeout(timer);
      resolve(out.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
    });
    for (const m of messages) proc.stdin.write(JSON.stringify(m) + "\n");
    setTimeout(() => proc.stdin.end(), 500);
  });
}

/** Shell fragments that would create `marker` if any shell interpreted them. */
function payloads(marker) {
  const js = `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, "/")}','x')"`;
  return [
    `x"; ${js}; echo "`,          // break out of "..." in sh
    `x" & ${js} & echo "`,        // break out of "..." in cmd.exe
    `$(${js})`,                   // sh command substitution inside "..."
    "`" + js + "`",              // sh backticks
    `x\\" & ${js} & \\"`,         // JSON.stringify-style escaping vs cmd.exe
    `1; ${js} #`,                 // unquoted interpolation (sh)
    `1 & ${js}`,                  // unquoted interpolation (cmd.exe)
    `x | ${js}`,                  // pipe
  ];
}

const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("MCP server rejects or neutralises command injection", () => {
  let cwd, marker;
  beforeEach(() => { cwd = makeCwd(); marker = path.join(cwd, "PWNED"); });
  afterEach(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });

  /** @type {Array<[string, (p: any) => Record<string, any>]>} */
  const cases = [
    ["infernoflow_context", (p) => ({ intent: p })],
    ["infernoflow_context", (p) => ({ working: p })],
    ["amp_search",          (p) => ({ query: p })],
    ["amp_read",            (p) => ({ query: p })],
    ["amp_read",            (p) => ({ type: p })],    // enum — must be rejected
    ["amp_read",            (p) => ({ limit: p })],   // integer — must be rejected
    ["infernoflow_git_drift", (p) => ({ sinceCommits: p })], // integer — must be rejected
    ["amp_bookmark",        (p) => ({ label: "safe", note: p })],
    ["amp_write",           (p) => ({ type: "note", msg: p })],
  ];

  for (const [tool, mk] of cases) {
    it(`${tool} ${Object.keys(mk("x")).join(",")}: no command runs`, async () => {
      const msgs = [{ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }];
      payloads(marker).forEach((p, i) => msgs.push(call(i + 1, tool, mk(p))));
      const responses = await drive(cwd, msgs);
      // Give any (wrongly) spawned background process a moment to land.
      await new Promise(r => setTimeout(r, 300));
      expect(fs.existsSync(marker)).toBe(false);
      // The server must answer every call (result or error) — never hang/crash.
      for (let i = 1; i <= payloads(marker).length; i++) {
        expect(responses.find(r => r.id === i)).toBeDefined();
      }
    }, 120_000);
  }
});

describe("MCP server input validation", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });

  it("rejects values outside the declared schema with -32602", async () => {
    const r = await drive(cwd, [
      call(1, "amp_read", { type: "not-a-type" }),
      call(2, "amp_read", { limit: "5" }),
      call(3, "amp_read", { limit: 1.5 }),
      call(4, "infernoflow_git_drift", { sinceCommits: 0 }),
      call(5, "infernoflow_git_drift", { sinceCommits: 101 }),
      call(6, "amp_write", { type: "note" }),                       // missing msg
      call(7, "amp_write", { type: "note", msg: "x".repeat(2001) }),
      call(8, "amp_write", { type: "note", msg: "ok", tags: "a,b" }),
      call(9, "amp_read", ["not", "an", "object"]),
    ]);
    for (let id = 1; id <= 9; id++) {
      const res = r.find(x => x.id === id);
      expect(res, `id ${id}`).toBeDefined();
      expect(res.error, `id ${id}`).toBeDefined();
      expect(res.error.code, `id ${id}`).toBe(-32602);
    }
  }, 60_000);

  it("drops unknown properties instead of failing", async () => {
    const r = await drive(cwd, [call(1, "amp_write", { type: "note", msg: "hello", bogus: "$(id)" })]);
    const res = r.find(x => x.id === 1);
    expect(res.error).toBeUndefined();
    expect(res.result.content[0].text).toMatch(/Logged/);
  }, 60_000);

  it("unknown tool names still return -32601", async () => {
    const r = await drive(cwd, [call(1, "rm_rf", {})]);
    expect(r.find(x => x.id === 1).error.code).toBe(-32601);
  }, 60_000);

  it("text starting with dashes is never read as a CLI flag", async () => {
    // `--watch --auto-push` would put `context` into a commit-and-push loop.
    const r = await drive(cwd, [call(1, "infernoflow_context", { intent: "--watch", working: "--auto-push" })]);
    const res = r.find(x => x.id === 1);
    expect(res).toBeDefined();               // returned (did not enter watch mode and hang)
  }, 60_000);
});
