/**
 * Session bookmarks — pins the contract that `infernoflow bookmark` creates a
 * `note` tagged "bookmark" (with optional Tier-2 context), lists newest-first,
 * recalls by id-prefix or label, deletes with its sidecar, and is NEVER
 * auto-pruned even when stale.
 *
 * Driven through the real CLI (bin/infernoflow.mjs) via spawnSync + cwd, so it
 * also exercises command registration and dispatch. (vitest workers forbid
 * process.chdir, and bookmark.mjs reads process.cwd() internally.)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import { readEntries, readDetail, pruneEntries } from "../lib/amp/io.mjs";
import { _resetProjectRootCache } from "../lib/projectRoot.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN  = path.join(REPO, "bin", "infernoflow.mjs");

let dir;
function mkProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-bm-"));
  fs.mkdirSync(path.join(d, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(d, ".git"), { recursive: true });
  return d;
}
function run(...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: "utf8" });
  return { out: r.stdout || "", err: r.stderr || "", status: r.status };
}
const bookmarks = () => { _resetProjectRootCache(); return readEntries(dir).filter(e => Array.isArray(e.tags) && e.tags.includes("bookmark")); };

beforeEach(() => { _resetProjectRootCache(); dir = mkProject(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("infernoflow bookmark", () => {
  it("creates a marker bookmark (no context)", () => {
    const r = run("bookmark", "before the SP refactor");
    expect(r.out).toMatch(/Bookmark saved/);
    const bms = bookmarks();
    expect(bms.length).toBe(1);
    expect(bms[0].type).toBe("note");
    expect(bms[0].summary).toBe("before the SP refactor");
    expect(bms[0].detailRef).toBeUndefined();
  });

  it("captures context via --note into a Tier-2 sidecar (not inline)", () => {
    run("bookmark", "auth works", "--note", "JWT in httpOnly cookie; refresh on 401");
    const b = bookmarks()[0];
    expect(b.detailRef).toBeTruthy();
    expect(readDetail(dir, b)).toContain("httpOnly cookie");
    const raw = fs.readFileSync(path.join(dir, ".ai-memory", "sessions.jsonl"), "utf8");
    expect(raw).not.toContain("httpOnly cookie"); // body is not inline in the index
  });

  it("captures context via --detail-file", () => {
    const f = path.join(dir, "snap.md");
    fs.writeFileSync(f, "# snapshot\nlong body here\n");
    run("bookmark", "big session", "--detail-file", f);
    expect(readDetail(dir, bookmarks()[0])).toContain("long body here");
  });

  it("lists bookmarks newest-first", () => {
    run("bookmark", "first");
    run("bookmark", "second", "--note", "ctx");
    const out = run("bookmark", "list").out;
    expect(out).toMatch(/first/);
    expect(out).toMatch(/second/);
    expect(out.indexOf("second")).toBeLessThan(out.indexOf("first")); // newest first
  });

  it("list --json emits structured data with hasContext", () => {
    run("bookmark", "x", "--note", "y");
    const parsed = JSON.parse(run("bookmark", "list", "--json").out);
    expect(parsed.length).toBe(1);
    expect(parsed[0].label).toBe("x");
    expect(parsed[0].hasContext).toBe(true);
  });

  it("show recalls context by label substring", () => {
    run("bookmark", "resume here", "--note", "the exact spot: line 42");
    expect(run("bookmark", "show", "resume").out).toContain("the exact spot: line 42");
  });

  it("show recalls by id prefix", () => {
    run("bookmark", "byid", "--note", "hello there");
    const id = bookmarks()[0].id;
    expect(run("bookmark", "show", id.slice(0, 10)).out).toContain("hello there");
  });

  it("rm deletes a bookmark and its sidecar", () => {
    run("bookmark", "temp", "--note", "ctx");
    const b = bookmarks()[0];
    run("bookmark", "rm", b.id);
    expect(bookmarks().length).toBe(0);
    expect(readDetail(dir, b)).toBe(null); // sidecar removed
  });

  it("a bare bookmark auto-captures the session transcript as context", () => {
    // Fake Claude Code home + transcript for THIS project dir.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-home-"));
    const enc  = path.resolve(dir).replace(/[^a-zA-Z0-9]/g, "-");
    const tdir = path.join(home, ".claude", "projects", enc);
    fs.mkdirSync(tdir, { recursive: true });
    const transcript = [
      JSON.stringify({ type: "user",      message: { role: "user",      content: "we need to fix the SP deadlock" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Use a set-based UPDATE...FROM instead of the cursor." }] } }),
    ].join("\n") + "\n";
    fs.writeFileSync(path.join(tdir, "session.jsonl"), transcript);

    // Bare bookmark (no --note) → should auto-harvest the transcript above.
    spawnSync(process.execPath, [BIN, "bookmark", "resume point"], {
      cwd: dir, encoding: "utf8",
      env: { ...process.env, USERPROFILE: home, HOME: home },
    });

    const b = bookmarks()[0];
    expect(b.detailRef).toBeTruthy();                 // context was captured
    const body = readDetail(dir, b);
    expect(body).toContain("SP deadlock");            // user turn
    expect(body).toContain("set-based UPDATE");       // assistant turn
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("bookmarks are NEVER auto-pruned, even when stale", () => {
    run("bookmark", "old bookmark", "--note", "keep me");
    // Age the entry past the default cutoff across every mirror file.
    const memDir = path.join(dir, ".ai-memory");
    const files = [path.join(memDir, "sessions.jsonl")];
    const branches = path.join(memDir, "branches");
    if (fs.existsSync(branches)) for (const n of fs.readdirSync(branches)) if (n.endsWith(".jsonl")) files.push(path.join(branches, n));
    const oldTs = Date.now() - 200 * 24 * 60 * 60 * 1000;
    for (const f of files) {
      const out = fs.readFileSync(f, "utf8").split("\n").filter(Boolean)
        .map(l => { try { return JSON.stringify({ ...JSON.parse(l), ts: oldTs }); } catch { return l; } });
      fs.writeFileSync(f, out.join("\n") + "\n", "utf8");
    }
    _resetProjectRootCache();
    const res = pruneEntries(dir, { types: ["note"] }); // force note archiving
    expect(res.archived).toBe(0);        // bookmark protected despite being a stale note
    expect(bookmarks().length).toBe(1);
  });
});
