/**
 * Clean-tree policy — managed-block writes to `.gitignore` and
 * `.gitattributes`. Idempotency and marker fidelity are the hard part.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

import {
  ensureManagedBlock,
  applyCleanTreePolicy,
  GITIGNORE_START,
  GITIGNORE_END,
} from "../lib/cleanTree.mjs";

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-clean-"));
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

describe("ensureManagedBlock", () => {
  let root;
  beforeEach(() => { root = mkTmp(); });
  afterEach(() => rmrf(root));

  it("creates the file with the managed block if it didn't exist", () => {
    const res = ensureManagedBlock(root, ".gitignore", `${GITIGNORE_START}\nfoo\n${GITIGNORE_END}`);
    expect(res).toBe("created");
    const text = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(text).toContain(GITIGNORE_START);
    expect(text).toContain("foo");
    expect(text).toContain(GITIGNORE_END);
  });

  it("appends to an existing file without touching the user's lines", () => {
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\ndist\n");
    const res = ensureManagedBlock(root, ".gitignore", `${GITIGNORE_START}\nbar\n${GITIGNORE_END}`);
    expect(res).toBe("updated");
    const text = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(text).toMatch(/^node_modules\ndist/);
    expect(text).toContain("bar");
  });

  it("replaces the managed block in place when the markers already exist", () => {
    const initial =
      "node_modules\n" +
      "\n" +
      `${GITIGNORE_START}\n` +
      "old-line\n" +
      `${GITIGNORE_END}\n` +
      "dist\n";
    fs.writeFileSync(path.join(root, ".gitignore"), initial);

    const replacement = `${GITIGNORE_START}\nnew-line\n${GITIGNORE_END}`;
    const res = ensureManagedBlock(root, ".gitignore", replacement);

    expect(res).toBe("updated");
    const text = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(text).toContain("node_modules");
    expect(text).toContain("dist");
    expect(text).toContain("new-line");
    expect(text).not.toContain("old-line");
    // Markers stay unique — exactly one of each.
    expect((text.match(new RegExp(GITIGNORE_START, "g")) || []).length).toBe(1);
    expect((text.match(new RegExp(GITIGNORE_END,   "g")) || []).length).toBe(1);
  });

  it("is idempotent — second call with same content reports 'unchanged'", () => {
    const content = `${GITIGNORE_START}\nx\n${GITIGNORE_END}`;
    ensureManagedBlock(root, ".gitignore", content);
    const second = ensureManagedBlock(root, ".gitignore", content);
    expect(second).toBe("unchanged");
  });

  it("creates the file's parent directory if missing", () => {
    const nested = ".some/sub/.gitignore";
    const res = ensureManagedBlock(root, nested, `${GITIGNORE_START}\nx\n${GITIGNORE_END}`);
    expect(res).toBe("created");
    expect(fs.existsSync(path.join(root, nested))).toBe(true);
  });
});

describe("applyCleanTreePolicy", () => {
  let root;
  beforeEach(() => { root = mkTmp(); });
  afterEach(() => rmrf(root));

  it("writes the standard rules into .gitignore and .gitattributes", () => {
    const report = applyCleanTreePolicy(root);
    expect(report.gitignore).toBe("created");
    expect(report.gitattributes).toBe("created");

    const gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gi).toContain(".ai-memory/global.jsonl");
    expect(gi).toContain(".ai-memory/handoff.md");
    expect(gi).toContain("**/publish/.ai-memory/");

    const ga = fs.readFileSync(path.join(root, ".gitattributes"), "utf8");
    expect(ga).toContain(".ai-memory/branches/*.jsonl merge=union");
  });

  it("is idempotent across reruns", () => {
    applyCleanTreePolicy(root);
    const second = applyCleanTreePolicy(root);
    expect(second.gitignore).toBe("unchanged");
    expect(second.gitattributes).toBe("unchanged");
  });
});
