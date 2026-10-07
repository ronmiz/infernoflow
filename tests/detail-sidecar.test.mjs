/**
 * Tier-2 "detail" sidecar — pins the contract that a rich `detail` body is
 * stored in a sidecar file (details/<id>.md), NOT inline in the JSONL, so the
 * index stays lean; that readEntries never loads the body; that readDetail
 * fetches it on demand; and that deleteEntry cleans the sidecar up.
 *
 * This is the storage foundation for session checkpoints (Phase 2) and richer
 * memory entries — the "load only if the metadata is met, like a skill" idea.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import { appendEntry, readEntries, readDetail, deleteEntry, detailPath } from "../lib/amp/io.mjs";
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
  "Open thread: still need to reindex on (AccountId, PostedAt) before shipping.",
].join("\n");

describe("Tier-2 detail sidecar", () => {
  it("stores the body in details/<id>.md, not inline in the JSONL", () => {
    const amp = appendEntry(dir, {
      type: "note", msg: "SSMS refactor session snapshot", file: "db/usp_RecalcBalances.sql",
      detail: BIG_BODY,
    });
    expect(amp.id).toBeTruthy();

    // The sidecar exists and holds the full body.
    const side = detailPath(dir, amp.id);
    expect(fs.existsSync(side)).toBe(true);
    expect(fs.readFileSync(side, "utf8")).toBe(BIG_BODY);

    // The JSONL line carries a pointer, NOT the body.
    const raw = fs.readFileSync(path.join(dir, ".ai-memory", "sessions.jsonl"), "utf8");
    expect(raw).toContain("detailRef");
    expect(raw).toContain(`details/${amp.id}.md`);
    expect(raw).not.toContain("deadlocked under concurrent load"); // body is not inline
    // The wire keeps it AMP-spec-compliant: under meta, not a top-level field.
    const wire = JSON.parse(raw.trim().split("\n").pop());
    expect(wire.meta.detailRef).toBe(`details/${amp.id}.md`);
    expect(wire.detail).toBeUndefined();
  });

  it("readEntries surfaces detailRef but never the body", () => {
    const amp = appendEntry(dir, { type: "note", msg: "snap", detail: BIG_BODY });
    const entries = readEntries(dir);
    const e = entries.find(x => x.id === amp.id);
    expect(e).toBeTruthy();
    expect(e.detailRef).toBe(`details/${amp.id}.md`);
    expect(e.detail).toBeUndefined();      // body never loaded into the index
    expect(JSON.stringify(e)).not.toContain("deadlocked");
  });

  it("readDetail fetches the body on demand", () => {
    const amp = appendEntry(dir, { type: "note", msg: "snap", detail: BIG_BODY });
    const e = readEntries(dir).find(x => x.id === amp.id);
    expect(readDetail(dir, e)).toBe(BIG_BODY);
  });

  it("entries without a detail behave exactly as before (no sidecar, no detailRef)", () => {
    const amp = appendEntry(dir, { type: "gotcha", msg: "plain one-liner", file: "src/a.ts" });
    expect(amp.meta?.detailRef).toBeUndefined();
    const e = readEntries(dir).find(x => x.id === amp.id);
    expect(e.detailRef).toBeUndefined();
    expect(readDetail(dir, e)).toBe(null);
    expect(fs.existsSync(detailPath(dir, amp.id))).toBe(false);
  });

  it("deleteEntry removes the sidecar body too", () => {
    const amp = appendEntry(dir, { type: "note", msg: "snap", detail: BIG_BODY });
    const side = detailPath(dir, amp.id);
    expect(fs.existsSync(side)).toBe(true);

    const res = deleteEntry(dir, amp.id);
    expect(res.removed).toBeGreaterThan(0);
    expect(fs.existsSync(side)).toBe(false);                 // sidecar gone
    expect(readEntries(dir).find(x => x.id === amp.id)).toBeUndefined();
  });

  it("readDetail returns null for a missing/blank ref and never throws", () => {
    expect(readDetail(dir, null)).toBe(null);
    expect(readDetail(dir, { msg: "x" })).toBe(null);
    expect(readDetail(dir, { detailRef: "details/nope.md" })).toBe(null);
  });
});
