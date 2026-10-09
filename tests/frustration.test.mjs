/**
 * 0.46.3 Fix #1 — the prompt hooks only react to text the human typed.
 * Subagent hand-backs, system reminders, pasted logs and quoted tool output
 * ("No changed files detected…") used to be logged as "User frustration".
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { humanText, isFrustration } from "../lib/frustration.mjs";
import { CAPTURE_HOOK_SCRIPT, CAPTURE_HOOK_VERSION } from "../lib/commands/setup.mjs";
import { isMisfiredHookEntry } from "../lib/commands/curate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const frustrated = (p) => isFrustration(humanText(p));

describe("humanText / isFrustration", () => {
  it("ignores machine text: subagent hand-backs, reminders, task notifications", () => {
    for (const p of [
      '<agent-message from="ad23bc82120c84803"> [Subagent hand-back] it is still not working </agent-message>',
      "<system-reminder>The user said: not working</system-reminder>",
      "<task-notification>build failed — same error</task-notification>",
      "[Subagent hand-back] The text below… not working",
      "<command-name>/doctor</command-name> not working",
    ]) expect(frustrated(p), p).toBe(false);
  });

  it("ignores quoted output, code and logs pasted into a prompt", () => {
    expect(frustrated("No changed files detected since last commit.")).toBe(false);
    expect(frustrated("here's the log:\n```\nError: same error, not working !!\n```\ncan you look?")).toBe(false);
    expect(frustrated("> it's still not working\nwhat does this quote mean?")).toBe(false);
    expect(frustrated("fix this:\n    if (!!x) retry();")).toBe(false);
    expect(frustrated("Error: request failed — not working\n    at fetch (a.js:1)")).toBe(false);
  });

  it("noisy signals (!!, retry) count only in a short prompt", () => {
    expect(frustrated("retry !!")).toBe(true);
    expect(frustrated("long explanation ".repeat(20) + " retry")).toBe(false);
    expect(frustrated("if (!!value) return")).toBe(false);   // not standalone
  });

  it("real frustration is detected", () => {
    for (const p of [
      "the build is broken again",
      "this is broken",
      "fix it!!",
      "why!!",
      "still not compiling",
      "at this point it's still not working",
      "it's still not working, same error",
      "This doesn't work",
      "does not work at all",
      "it's broken again",
      "no change after the fix",
      "still the same",
    ]) expect(frustrated(p), p).toBe(true);
  });
});

describe("bounded work on every prompt", () => {
  // Regression (review of 0.46.3): line patterns with \s* under the m flag
  // backtracked over blank lines — a 47 KB JSON paste held the hook for 45 s.
  it("large pastes are handled in milliseconds", () => {
    const json = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: i, name: "item " + i, tags: ["a", "b"] })), null, 2);
    for (const p of [
      "look at this:\n" + json + "\nit's still not working",
      "x" + "\n".repeat(20000) + "y",
      "    \n".repeat(20000),
      "<a>".repeat(200000),
      " \n\t\n".repeat(20000) + "at",
    ]) {
      const t = Date.now();
      humanText(p);
      expect(Date.now() - t, p.slice(0, 30)).toBeLessThan(1500);
    }
  });

  it("the person's words after a long paste still count", () => {
    const log = Array.from({ length: 400 }, (_, i) => "line " + i + " ok").join("\n");
    expect(frustrated(log + "\nit's still not working")).toBe(true);
  });
});

describe("one source of truth for the hooks", () => {
  it("the Claude Code hook embeds lib/frustration.mjs verbatim (hook version 5)", () => {
    expect(CAPTURE_HOOK_VERSION).toBe(5);
    expect(CAPTURE_HOOK_SCRIPT).toContain("const humanText = " + humanText.toString() + ";");
    expect(CAPTURE_HOOK_SCRIPT).toContain("const isFrustration = " + isFrustration.toString() + ";");
    expect(CAPTURE_HOOK_SCRIPT).not.toMatch(/const MARKERS/);
  });

  it("the BUILT (minified) hook still defines the names it calls", async () => {
    // Regression: dist/ is minified, so Function#toString gave "function n(e)"
    // and the published hook crashed with "humanText is not defined".
    const dist = path.join(ROOT, "dist", "lib", "commands", "setup.mjs");
    if (!fs.existsSync(dist)) return;
    const { CAPTURE_HOOK_SCRIPT: built } = await import(pathToFileURL(dist).href);
    expect(built).toMatch(/const humanText = function/);
    expect(built).toMatch(/const isFrustration = function/);
  });

  it("the Cursor hook carries an identical copy", () => {
    const cursor = fs.readFileSync(path.join(ROOT, "templates", "cursor", "hooks", "inferno-session-draft.mjs"), "utf8");
    expect(cursor).toContain(humanText.toString().replace(/^function /, "function "));
    expect(cursor).toContain(isFrustration.toString());
    expect(cursor).toContain("infernoflow-hook-version: 5");
    expect(cursor).not.toMatch(/TRIGGER_RES/);
  });
});

describe("Claude Code prompt hook end to end", () => {
  let project, home, fakeBin;
  beforeEach(() => {
    project = tmp("infernoflow-fr-");
    home = tmp("infernoflow-fr-home-");
    fakeBin = tmp("infernoflow-fr-bin-");
    fs.mkdirSync(path.join(project, ".ai-memory"), { recursive: true });
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    fs.writeFileSync(path.join(project, ".ai-memory", ".last-cli-version"), JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(fakeBin, "infernoflow.cmd"), "@echo off\r\n");
      const pkg = path.join(fakeBin, "node_modules", "infernoflow");
      fs.mkdirSync(path.dirname(pkg), { recursive: true });
      fs.symlinkSync(ROOT, pkg, "junction");
    } else {
      fs.mkdirSync(path.join(fakeBin, "bin"));
      fs.writeFileSync(path.join(fakeBin, "bin", "infernoflow"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
      fs.mkdirSync(path.join(fakeBin, "lib", "node_modules"), { recursive: true });
      fs.symlinkSync(ROOT, path.join(fakeBin, "lib", "node_modules", "infernoflow"));
    }
    fs.mkdirSync(path.join(project, ".claude", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(project, ".claude", "hooks", "log-frustration.mjs"), CAPTURE_HOOK_SCRIPT);
  });
  afterEach(() => {
    for (const d of [project, home, fakeBin]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  const runHook = (prompt) => spawnSync(process.execPath, [path.join(".claude", "hooks", "log-frustration.mjs")], {
    cwd: project, input: JSON.stringify({ prompt }), encoding: "utf8", timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"),
      CLAUDE_PROJECT_DIR: project,
      PATH: (process.platform === "win32" ? fakeBin : path.join(fakeBin, "bin")) + path.delimiter + process.env.PATH },
  });
  const entries = () => {
    const f = path.join(project, ".ai-memory", "sessions.jsonl");
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
  };

  it("agent hand-backs and quoted tool output log nothing; a real prompt logs once (cooldown holds)", () => {
    expect(runHook('<agent-message from="x">No changed files detected since last commit.</agent-message>').status).toBe(0);
    expect(runHook("No changed files detected since last commit.").status).toBe(0);
    expect(entries().filter(e => /User frustration/.test(e.msg))).toHaveLength(0);

    expect(runHook("it's still not working, same error").status).toBe(0);
    expect(runHook("still broken!! same error").status).toBe(0);    // within the 10-minute cooldown
    const logged = entries().filter(e => /User frustration/.test(e.msg));
    expect(logged).toHaveLength(1);
    expect(logged[0].msg).toBe("User frustration: it's still not working, same error");
    expect(logged[0].meta && logged[0].meta.agent).toBe("hook");      // Fix #4: attributed to the hook
  }, 60_000);
});

describe("curate finds entries the old hooks logged from machine text", () => {
  const e = (summary, source = "hook") => ({ type: "attempt", summary, source, ts: Date.now() });
  it("flags machine text and infernoflow's own tool output; keeps everything a person may have typed", () => {
    expect(isMisfiredHookEntry(e('User frustration: <agent-message from="ad23bc82120c84803"> [Subagent hand-back'))).toBe(true);
    expect(isMisfiredHookEntry(e("User frustration: No changed files detected since last commit."))).toBe(true);
    expect(isMisfiredHookEntry(e("Auto-trigger — user signalled trouble: <system-reminder>x", "cursor-trigger"))).toBe(true);
    expect(isMisfiredHookEntry(e("User frustration: it's still not working, same error"))).toBe(false);
    // cut off at the hook's prefix length — the trigger may have been after the cut
    expect(isMisfiredHookEntry(e("User frustration: " + "I rebuilt the whole project from scratch and then ran it agai".slice(0, 60)))).toBe(false);
    expect(isMisfiredHookEntry(e("User frustration: <agent-message", "memory-keeper"))).toBe(false);  // not a hook entry
    // The old hooks matched more phrases than today's — still real, never deleted.
    for (const m of ["this is broken", "why!!", "still not compiling", "fix it!!", "Error: it's not working"])
      expect(isMisfiredHookEntry(e("User frustration: " + m)), m).toBe(false);
  });
});
