/**
 * MCP server — JSON-RPC integration test.
 *
 * Spawns the actual MCP server template, sends real tools/call messages over
 * stdin, parses responses from stdout. This is the test that would have caught
 * the version-skew bug at the MCP boundary.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
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
async function driveServer(cwd, messages) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [MCP_SERVER], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });

    let outBuf = "";
    proc.stdout.on("data", d => { outBuf += d.toString("utf8"); });
    // stderr is fine to swallow — server announces itself there.
    proc.stderr.on("data", () => {});

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`MCP server timed out\nstdout:\n${outBuf}`));
    }, 8_000);

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
    // The type enum on the schema must match the AMP spec.
    const typeEnum = ampWrite.inputSchema.properties.type.enum;
    expect(typeEnum.sort()).toEqual(
      ["attempt", "decision", "detection", "gotcha", "note", "pattern"].sort()
    );
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
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
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
