/**
 * 0.46.3 Fix #4 — CLI entries name who wrote them. Claude Code sets
 * CLAUDECODE=1 (CLAUDE_CODE_SESSION never existed), so its entries were
 * stamped "human"; the memory-keeper subagent and the prompt hooks were
 * indistinguishable from the user.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { detectAgent } from "../lib/commands/log.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("detectAgent", () => {
  it("explicit INFERNOFLOW_AGENT wins", () => {
    expect(detectAgent("memory-keeper", { INFERNOFLOW_AGENT: "windsurf", CLAUDECODE: "1" })).toBe("windsurf");
  });
  it("the writer named by --source comes before the environment", () => {
    expect(detectAgent("memory-keeper", { CLAUDECODE: "1" })).toBe("memory-keeper");
    expect(detectAgent("hook", { CLAUDECODE: "1" })).toBe("hook");
    expect(detectAgent("cursor-trigger", {})).toBe("cursor-hook");
  });
  it("AI tools are recognised by the variables they really set", () => {
    expect(detectAgent(null, { CLAUDECODE: "1" })).toBe("claude");
    expect(detectAgent(null, { CURSOR_TRACE_ID: "abc" })).toBe("human");   // set in every Cursor terminal
    expect(detectAgent(null, {})).toBe("human");
  });
});

describe("infernoflow log stamps the writer", () => {
  it("memory-keeper's documented command is attributed to memory-keeper", () => {
    const dir  = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-attr-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-attr-home-"));
    try {
      fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
      fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".ai-memory", ".last-cli-version"), JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
      const { INFERNOFLOW_AGENT: _ignored, ...inherited } = process.env;
      const env = { ...inherited, NO_COLOR: "1", HOME: home, USERPROFILE: home, CLAUDECODE: "1" };
      const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "infernoflow.mjs"), "log", "API wants multipart", "--type", "gotcha", "--source", "memory-keeper", "--quiet"], { cwd: dir, env, encoding: "utf8", timeout: 30_000 });
      expect(r.status).toBe(0);
      const e = JSON.parse(fs.readFileSync(path.join(dir, ".ai-memory", "sessions.jsonl"), "utf8").trim().split("\n").pop());
      expect(e.meta.agent).toBe("memory-keeper");
      expect(e.source).toBe("memory-keeper");
    } finally {
      for (const d of [dir, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
    }
  });
});
