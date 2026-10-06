/**
 * Tier-2 "detail" store — a rich `detail` body is stored OUTSIDE the index
 * (consolidated .ai-memory/details.jsonl since 0.44.18), so the index stays
 * lean; readEntries never loads the body; readDetail fetches it on demand;
 * deleteEntry cleans it up.
 *
 * 0.45.0 additions (security):
 *   - automatic transcript snapshots go to the gitignored details.local.jsonl
 *   - a legacy `detailRef` can never make readDetail read outside details/
 *   - secrets are redacted in msg / tags / detail before anything is written
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import { appendEntry, readEntries, readDetail, deleteEntry, LOCAL_DETAIL_STORE } from "../lib/amp/io.mjs";
import { _resetProjectRootCache } from "../lib/projectRoot.mjs";

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-detail-"));
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

let dir;
beforeEach(() => { _resetProjectRootCache(); dir = mkProject(); });
afterEach(() => rmrf(dir));

const BIG_BODY = [
  "# Session snapshot: SSMS stored-proc refactor",
  "",
  "We analyzed usp_RecalcBalances and found the cursor loop was the bottleneck.",
  "Decision: replace with a set-based UPDATE ... FROM join.",
  "Dead end: tried a temp table first — deadlocked under concurrent load.",
].join("\n");

const store      = () => path.join(dir, ".ai-memory", "details.jsonl");
const localStore = () => path.join(dir, ".ai-memory", LOCAL_DETAIL_STORE);
const sessions   = () => fs.readFileSync(path.join(dir, ".ai-memory", "sessions.jsonl"), "utf8");

describe("Tier-2 detail store", () => {
  it("stores the body in details.jsonl, not inline in the index", () => {
    const amp = appendEntry(dir, { type: "note", msg: "SSMS refactor session snapshot", detail: BIG_BODY });
    expect(fs.readFileSync(store(), "utf8")).toContain("deadlocked under concurrent load");
    const raw = sessions();
    expect(raw).not.toContain("deadlocked under concurrent load");
    const wire = JSON.parse(raw.trim().split("\n").pop());
    expect(wire.id).toBe(amp.id);
    expect(wire.meta.detailRef).toBe("details.jsonl");
    expect(wire.detail).toBeUndefined();
  });

  it("readEntries surfaces detailRef but never the body; readDetail loads it", () => {
    const amp = appendEntry(dir, { type: "note", msg: "snap", detail: BIG_BODY });
    const e = readEntries(dir).find(x => x.id === amp.id);
    expect(e.detailRef).toBe("details.jsonl");
    expect(JSON.stringify(e)).not.toContain("deadlocked");
    expect(readDetail(dir, e)).toBe(BIG_BODY);
  });

  it("entries without a detail have no detailRef", () => {
    const amp = appendEntry(dir, { type: "gotcha", msg: "plain one-liner", file: "src/a.ts" });
    expect(amp.meta?.detailRef).toBeUndefined();
    expect(readDetail(dir, readEntries(dir).find(x => x.id === amp.id))).toBe(null);
  });

  it("deleteEntry removes the body from the store too", () => {
    const amp = appendEntry(dir, { type: "note", msg: "snap", detail: BIG_BODY });
    expect(deleteEntry(dir, amp.id).removed).toBeGreaterThan(0);
    expect(fs.readFileSync(store(), "utf8")).not.toContain("deadlocked");
    expect(readEntries(dir).find(x => x.id === amp.id)).toBeUndefined();
  });

  it("readDetail returns null for a missing/blank ref and never throws", () => {
    expect(readDetail(dir, null)).toBe(null);
    expect(readDetail(dir, { msg: "x" })).toBe(null);
    expect(readDetail(dir, { detailRef: "details/nope.md" })).toBe(null);
  });

  it("still reads a legacy details/<id>.md body", () => {
    fs.mkdirSync(path.join(dir, ".ai-memory", "details"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".ai-memory", "details", "amp_legacy.md"), "legacy body");
    expect(readDetail(dir, { id: "amp_legacy", detailRef: "details/amp_legacy.md" })).toBe("legacy body");
  });
});

describe("local-only transcript snapshots (0.45.0)", () => {
  it("detailLocal routes the body to the gitignored local store", () => {
    const amp = appendEntry(dir, { type: "note", msg: "bookmark", tags: ["bookmark"], detail: BIG_BODY, detailLocal: true });
    expect(fs.existsSync(localStore())).toBe(true);
    expect(fs.readFileSync(localStore(), "utf8")).toContain("deadlocked");
    expect(fs.existsSync(store()) ? fs.readFileSync(store(), "utf8") : "").not.toContain("deadlocked");
    expect(amp.meta.detailRef).toBe(LOCAL_DETAIL_STORE);
    expect(readDetail(dir, readEntries(dir).find(x => x.id === amp.id))).toBe(BIG_BODY);
    expect(deleteEntry(dir, amp.id).removed).toBeGreaterThan(0);
    expect(fs.readFileSync(localStore(), "utf8")).not.toContain("deadlocked");
  });
});

describe("readDetail never reads outside .ai-memory/details/ (F7)", () => {
  const secretFile = () => path.join(dir, "secret.txt");
  beforeEach(() => fs.writeFileSync(secretFile(), "TOP SECRET"));

  /** @type {Array<[string, () => string]>} */
  const refs = [
    ["absolute path",               () => secretFile()],
    ["relative escape",             () => "../secret.txt"],
    ["escape through details/",     () => "details/../../secret.txt"],
    ["Windows separators",          () => "details/..\\..\\secret.txt"],
    ["file at memory root",         () => "secret.txt"],
  ];
  for (const [label, ref] of refs) {
    it(`refuses detailRef: ${label}`, () => {
      expect(readDetail(dir, { id: "amp_x", detailRef: ref() })).toBe(null);
      expect(readDetail(dir, { id: "amp_x", meta: { detailRef: ref() } })).toBe(null);
    });
  }

  it("refuses when the details/ folder itself is a symlink to elsewhere", () => {
    const outside = path.join(dir, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "CLAUDE.md"), "PRIVATE");
    try { fs.symlinkSync(outside, path.join(dir, ".ai-memory", "details"), "junction"); } catch { return; }
    expect(readDetail(dir, { id: "amp_x", detailRef: "details/CLAUDE.md" })).toBe(null);
  });

  it("refuses a details/*.md symlink that points outside", () => {
    const d = path.join(dir, ".ai-memory", "details");
    fs.mkdirSync(d, { recursive: true });
    try { fs.symlinkSync(secretFile(), path.join(d, "link.md")); } catch { return; } // no symlink rights (Windows) — skip
    expect(readDetail(dir, { id: "amp_x", detailRef: "details/link.md" })).toBe(null);
  });
});

describe("secret redaction on write (F3)", () => {
  const GH = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
  const ANT = "sk-ant-api03-" + "x".repeat(40);

  it("redacts msg, tags and detail; records what was redacted", () => {
    const amp = appendEntry(dir, { type: "note", msg: `token is ${GH}`, tags: [`k=${ANT}`], detail: `password=Hunter2pass! and ${ANT}` });
    const all = sessions() + (fs.existsSync(path.join(dir, ".ai-memory", "branches")) ? fs.readdirSync(path.join(dir, ".ai-memory", "branches")).map(f => fs.readFileSync(path.join(dir, ".ai-memory", "branches", f), "utf8")).join("") : "") + fs.readFileSync(store(), "utf8");
    expect(all).not.toContain(GH);
    expect(all).not.toContain(ANT);
    expect(all).not.toContain("Hunter2pass!");
    expect(amp.msg).toBe("token is [REDACTED:github-token]");
    expect(amp.meta.redacted).toEqual(expect.arrayContaining(["github-token", "anthropic-key"]));
  });

  it("redacts JSON-style keys, Bearer tokens and *_SECRET env assignments", () => {
    const amp = appendEntry(dir, { type: "note", msg: "cfg", detail: '{"apiKey": "AbCdEf1234567890xyz", "password": "Hunter2pass!"}\nAuthorization: Bearer abcdefghijklmnop1234567890\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
    const body = fs.readFileSync(store(), "utf8");
    for (const s of ["AbCdEf1234567890xyz", "Hunter2pass!", "abcdefghijklmnop1234567890", "wJalrXUtnFEMI"]) expect(body).not.toContain(s);
    expect(amp.meta.redacted.length).toBeGreaterThan(0);
  });

  it("leaves ordinary text alone", () => {
    const text = "the token expired; fix password reset flow; token: refreshed hourly; secret=process.env.X";
    const amp = appendEntry(dir, { type: "gotcha", msg: text });
    expect(amp.msg).toBe(text);
    expect(amp.meta?.redacted).toBeUndefined();
  });
});
