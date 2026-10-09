/**
 * MCP server — JSON-RPC integration test.
 *
 * Spawns the actual MCP server template, sends real tools/call messages over
 * stdin, parses responses from stdout. This is the test that would have caught
 * the version-skew bug at the MCP boundary.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = path.resolve(__dirname, "..", "templates", "cursor", "inferno-mcp-server.mjs");

function makeCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-mcp-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"),       { recursive: true });
  return dir;
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

/**
 * Drive the MCP server through a script of JSON-RPC messages.
 * Returns parsed responses (one per id seen).
 */
async function driveServer(cwd, messages, env = process.env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [MCP_SERVER], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...env, NO_COLOR: "1" },
    });

    let outBuf = "";
    proc.stdout.on("data", d => { outBuf += d.toString("utf8"); });
    // stderr is fine to swallow — server announces itself there.
    proc.stderr.on("data", () => {});

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`MCP server timed out\nstdout:\n${outBuf}`));
    }, 60_000);

    proc.on("exit", () => {
      clearTimeout(timer);
      const responses = outBuf
        .split("\n")
        .filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      resolve(responses);
    });

    // Send all messages, then close stdin so the server exits.
    for (const m of messages) proc.stdin.write(JSON.stringify(m) + "\n");
    // Tiny grace period so the server can flush async work before stdin closes.
    setTimeout(() => proc.stdin.end(), 500);
  });
}

// Branch-aware: scan everything under .ai-memory/ and dedupe by AMP id
// (mirror-write policy puts each entry in both the routed file and the
// legacy sessions.jsonl for live extension visibility).
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

// ── tests ──────────────────────────────────────────────────────────────────

describe("MCP server bootstrap", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  it("responds to initialize with protocol version and serverInfo", async () => {
    const responses = await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    ]);
    const init = responses.find(r => r.id === 1);
    expect(init).toBeDefined();
    expect(init.result.protocolVersion).toBeDefined();
    expect(init.result.serverInfo.name).toBe("infernoflow");
  });

  it("lists tools including amp_write with the correct schema", async () => {
    const responses = await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);
    const list = responses.find(r => r.id === 2);
    expect(list).toBeDefined();
    const ampWrite = list.result.tools.find(t => t.name === "amp_write");
    expect(ampWrite).toBeDefined();
    // The type enum comes from the single schema (lib/schema.mjs): the AMP
    // spec types plus `preference` (stored as note + meta.subtype).
    const typeEnum = ampWrite.inputSchema.properties.type.enum;
    const { AGENT_TYPES } = await import("../lib/schema.mjs");
    expect([...typeEnum].sort()).toEqual([...AGENT_TYPES].sort());
    expect(typeEnum).toEqual(expect.arrayContaining(["attempt", "decision", "detection", "gotcha", "note", "pattern", "preference"]));
    expect(ampWrite.inputSchema.required).toContain("type");
    expect(ampWrite.inputSchema.required).toContain("msg");
  });
});

describe("amp_write end-to-end", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  it("writes a full-shape entry: type, msg, file, line, tags, tool=claude", async () => {
    const responses = await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-code", version: "2.0.0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "amp_write",
        arguments: {
          type: "decision",
          msg:  "use SQLite for v0",
          file: "server/prisma/schema.prisma",
          line: 7,
          tags: ["db", "architecture"],
        },
      }},
    ]);
    const call = responses.find(r => r.id === 2);
    expect(call.error).toBeUndefined();
    expect(call.result.content[0].text).toMatch(/Logged \[decision\]/);

    const [entry] = readEntries(cwd);
    expect(entry.type).toBe("decision");
    expect(entry.msg).toBe("use SQLite for v0");
    expect(entry.file).toBe("server/prisma/schema.prisma");   // NOT source
    expect(entry.line).toBe(7);                                // NOT dropped
    expect(entry.tags).toEqual(["db", "architecture"]);        // NOT dropped
    expect(entry.tool).toBe("claude");                         // NOT meta.agent=human
  });

  it("accepts AMP-spec types that the old wrapper rejected (detection, pattern)", async () => {
    const responses = await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "amp_write", arguments: { type: "detection", msg: "a" },
      }},
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: {
        name: "amp_write", arguments: { type: "pattern",   msg: "b" },
      }},
    ]);
    expect(responses.find(r => r.id === 2).error).toBeUndefined();
    expect(responses.find(r => r.id === 3).error).toBeUndefined();

    const entries = readEntries(cwd);
    expect(entries.map(e => e.type)).toEqual(["detection", "pattern"]);
  });

  it("writes optional fields only when provided (no empty strings)", async () => {
    await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "amp_write", arguments: { type: "note", msg: "minimal" },
      }},
    ]);
    const [entry] = readEntries(cwd);
    expect(entry.file).toBeUndefined();
    expect(entry.line).toBeUndefined();
    expect(entry.tags).toBeUndefined();
  });
});

describe("amp_write field MAPPING regression — the bug we just fixed", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  it("MUST NOT misroute `file` argument to `source` field on disk", async () => {
    // Old wrapper: input.file → --source <file> → CLI stored as `source`.
    // New wrapper: file lands in entry.file.
    // Regression test pinned to that behavior so the bug can never come back.
    await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "amp_write",
        arguments: { type: "gotcha", msg: "x", file: "src/x.ts" },
      }},
    ]);
    const [entry] = readEntries(cwd);
    expect(entry.file).toBe("src/x.ts");
    expect(entry.source).toBeUndefined();
  });

  it("MUST NOT drop `line` and `tags` (silent field loss in the old wrapper)", async () => {
    await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "amp_write",
        arguments: { type: "gotcha", msg: "x", line: 99, tags: ["t1", "t2"] },
      }},
    ]);
    const [entry] = readEntries(cwd);
    expect(entry.line).toBe(99);
    expect(entry.tags).toEqual(["t1", "t2"]);
  });
});

describe("clean-tree policy — rule files are NOT rewritten per write", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  it("amp_write does not modify CLAUDE.md after boot (regression: dirty-tree-blocks-checkout)", async () => {
    // Two-stage write: 1) boot the server (initialize) and let any boot-time
    // refresh run — this is allowed to touch CLAUDE.md once. 2) call
    // amp_write and assert CLAUDE.md hasn't changed since boot. The per-write
    // refresh was the bug; the boot-time refresh is intentional.
    const claudeMd = path.join(cwd, "CLAUDE.md");
    fs.writeFileSync(claudeMd, "# original content owned by user\n");

    // Stage 1: boot only (no tool call)
    await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    ]);
    const postBootContent = fs.readFileSync(claudeMd, "utf8");
    // User's original line must survive any boot-time refresh.
    expect(postBootContent).toContain("# original content owned by user");

    // Stage 2: amp_write must NOT modify CLAUDE.md beyond what boot did.
    await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "amp_write",
        arguments: { type: "note", msg: "this must not touch CLAUDE.md" },
      }},
    ]);
    const postWriteContent = fs.readFileSync(claudeMd, "utf8");
    expect(postWriteContent).toBe(postBootContent);
  });
});

describe("unknown tool", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  it("returns JSON-RPC error -32601 for unknown tool name", async () => {
    const responses = await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "definitely_not_a_tool", arguments: {},
      }},
    ]);
    const call = responses.find(r => r.id === 2);
    expect(call.error).toBeDefined();
    expect(call.error.code).toBe(-32601);
  });
});

describe("0.46.3: contract tools follow the project mode", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  it("memory mode: check/context are not listed, and calling them returns a hint, not an error", async () => {
    const responses = await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "infernoflow_check", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "infernoflow_context", arguments: {} } },
    ]);
    const names = responses.find(r => r.id === 2).result.tools.map(t => t.name);
    expect(names).not.toContain("infernoflow_check");
    expect(names).not.toContain("infernoflow_context");
    expect(names).toContain("amp_resume");
    for (const id of [3, 4]) {
      const r = responses.find(x => x.id === id);
      expect(r.error).toBeUndefined();
      expect(r.result.isError).toBeFalsy();
      expect(r.result.content[0].text).toMatch(/memory mode/);
      expect(r.result.content[0].text).toMatch(/amp_resume/);
    }
  });

  it("full mode (inferno/contract.json): check/context are listed", async () => {
    fs.mkdirSync(path.join(cwd, "inferno"));
    fs.writeFileSync(path.join(cwd, "inferno", "contract.json"), JSON.stringify({ capabilities: [] }));
    const responses = await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);
    const names = responses.find(r => r.id === 2).result.tools.map(t => t.name);
    expect(names).toContain("infernoflow_check");
    expect(names).toContain("infernoflow_context");
  });
});

describe("0.46.3: git drift never mistakes a git failure for 'no changes'", () => {
  let cwd;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-drift-"));
    fs.mkdirSync(path.join(cwd, ".ai-memory"));
  });
  afterEach(() => rmrf(cwd));

  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: "ignore" });
  const commit = (file) => { fs.writeFileSync(path.join(cwd, file), file + "\n"); git("add", file); git("commit", "-q", "-m", file); };
  const drift = async (sinceCommits) => {
    const r = await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "infernoflow_git_drift", arguments: sinceCommits ? { sinceCommits } : {} } },
    ]);
    const res = r.find(x => x.id === 2);
    expect(res.error).toBeUndefined();
    return res.result.content[0].text;
  };

  it("not a git repository → says so", async () => {
    const text = await drift();
    expect(text).toMatch(/not a git repository/);
    expect(text).not.toMatch(/No changed files/);
  });

  it("no commits yet → every file counts as changed", async () => {
    git("init", "-q");
    fs.writeFileSync(path.join(cwd, "a.js"), "1\n");
    const text = await drift();
    expect(text).toMatch(/no commits yet/);
    expect(text).toContain("a.js");
  });

  it("fewer commits than asked for → compares with the start of history", async () => {
    git("init", "-q");
    commit("first.js");
    const text = await drift(5);
    expect(text).toMatch(/Only 1 commit/);
    expect(text).toContain("first.js");
  });

  it("shallow clone → compared with the oldest fetched commit, not every file", async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-drift-src-"));
    try {
      const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: src, stdio: "ignore" });
      g("init", "-q");
      for (const f of ["a.js", "b.js", "c.js", "d.js"]) { fs.writeFileSync(path.join(src, f), f); g("add", f); g("commit", "-q", "-m", f); }
      fs.rmSync(cwd, { recursive: true, force: true });
      execFileSync("git", ["clone", "-q", "--depth", "2", "file://" + src.split(path.sep).join("/"), cwd], { stdio: "ignore" });
      fs.mkdirSync(path.join(cwd, ".ai-memory"));
      const text = await drift(5);
      expect(text).toMatch(/Shallow clone/);
      expect(text).toContain("d.js");
      expect(text).not.toContain("a.js");
    } finally { rmrf(src); }
  });

  it("enough commits → only the last n", async () => {
    git("init", "-q");
    commit("one.js"); commit("two.js"); commit("three.js");
    const text = await drift(1);
    expect(text).toContain("three.js");
    expect(text).not.toContain("two.js");
    expect(text).not.toMatch(/Only \d+ commit/);
  });
});

describe("0.46.3: amp_write is attributed to the MCP client that called it", () => {
  let cwd;
  beforeEach(() => { cwd = makeCwd(); });
  afterEach(() => rmrf(cwd));

  // No AI-tool variables from the environment running the tests.
  const cleanEnv = () => {
    const e = { ...process.env };
    for (const k of ["CLAUDECODE", "CLAUDE_CODE_SESSION", "CURSOR_TRACE_ID", "CURSOR_SESSION", "COPILOT_SESSION", "INFERNOFLOW_AGENT"]) delete e[k];
    return e;
  };
  const writeAs = async (clientName, env = cleanEnv()) => {
    await driveServer(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: clientName ? { clientInfo: { name: clientName, version: "1" } } : {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "amp_write", arguments: { type: "note", msg: "from " + clientName } } },
    ], env);
    return readEntries(cwd).find(e => e.msg === "from " + clientName);
  };

  it("VS Code (Copilot) → tool copilot", async () => {
    expect((await writeAs("Visual Studio Code")).tool).toBe("copilot");
  });
  it("Cursor → tool cursor", async () => {
    expect((await writeAs("cursor-vscode")).tool).toBe("cursor");
  });
  it("an unknown client is named, not passed off as claude", async () => {
    const e = await writeAs("Some Client!");
    expect(e.tool).toBeUndefined();
    expect(e.meta.agent).toBe("some-client");
  });
  it("no clientInfo, no AI-tool env → other", async () => {
    expect((await writeAs("")).tool).toBe("other");
  });
  it("INFERNOFLOW_AGENT still wins", async () => {
    expect((await writeAs("Visual Studio Code", { ...cleanEnv(), INFERNOFLOW_AGENT: "windsurf" })).tool).toBe("windsurf");
  });
});
