/**
 * 0.49.0 — decisions / findings / "remember this" the user said in a session
 * but nobody saved are offered once at the next session start (local only).
 */
import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { unsavedSignals } from "../lib/commands/hook.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs");
const VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")).version;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const user = (text) => ({ type: "user", message: { role: "user", content: text } });
const said = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const tool = (name, input = {}) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
function transcript(lines) {
  const f = path.join(tmp("ifx-tr-"), "t.jsonl");
  fs.writeFileSync(f, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
  return f;
}

describe("unsavedSignals", () => {
  it("keeps signals with no save after them; a save clears what came before", () => {
    const f = transcript([
      user("we decided to use Postgres for the jobs table"),
      said("ok"),
      tool("mcp__infernoflow__amp_write", { type: "decision", msg: "Postgres for jobs" }),
      user("turns out the cache key ignores the locale"),
      said("good catch"),
      user("<system-reminder>we decided X</system-reminder>"),        // machine text: ignored
      user("fix the login page"),                                        // no signal
      user("תזכור שהפורט של ה-staging הוא 8443"),
    ]);
    expect(unsavedSignals(f)).toEqual([
      { kind: "discovery", text: "turns out the cache key ignores the locale" },
      { kind: "remember", text: "תזכור שהפורט של ה-staging הוא 8443" },
    ]);
  });

  it("a CLI save through Bash counts too; missing transcript gives nothing", () => {
    const f = transcript([user("let's go with pnpm"), tool("Bash", { command: 'infernoflow log "pnpm chosen" --type decision' })]);
    expect(unsavedSignals(f)).toEqual([]);
    expect(unsavedSignals(path.join(os.tmpdir(), "nope.jsonl"))).toEqual([]);
  });
});

describe("session end → next session start", () => {
  it("offers the unsaved items once, keeps them out of git", () => {
    const dir = tmp("ifx-ss-");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    fs.mkdirSync(path.join(dir, ".ai-memory"));
    fs.writeFileSync(path.join(dir, ".ai-memory", ".last-cli-version"), VERSION);
    const env = { ...process.env, NO_COLOR: "1", INFERNOFLOW_HOME: tmp("ifx-ssh-"), CLAUDE_PROJECT_DIR: dir };
    const run = (args, input = "") => spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: "utf8", timeout: 30_000, env, input });
    const f = transcript([user("we decided the API returns 404 for missing users, not 200"), said("noted")]);
    expect(run(["hook", "session-end", "--transcript", f, "--reason", "other"]).status).toBe(0);

    const first = run(["hook", "session-start"], "{}").stdout;
    expect(first).toContain("## Possibly unsaved from the last session");
    expect(first).toContain('decision: "we decided the API returns 404 for missing users, not 200"');
    expect(first).toContain("Ask first");
    expect(run(["hook", "session-start"], "{}").stdout).not.toContain("Possibly unsaved");   // once

    // The prompt text never reaches a shared (committed) file.
    for (const rel of fs.readdirSync(path.join(dir, ".ai-memory"), { recursive: true }).map(String)) {
      const p = path.join(dir, ".ai-memory", rel);
      if (!fs.statSync(p).isFile() || rel === ".hook-state.json" || rel.includes("local") || rel === "sessions.jsonl") continue;
      expect(fs.readFileSync(p, "utf8"), rel).not.toContain("404 for missing users");
    }
  });
});
