/**
 * bookmark-smoke — verify the ONE uncertain link in the extension bookmark UI:
 * that ampIO.write() (backed by the bundled infernoflow-amp package, a separate
 * codebase from lib/amp/io.mjs) actually persists `tags`, so a bookmark created
 * from the sidebar is really tagged "bookmark" and shows up in the Bookmarks
 * section + jump flow. The tree rendering / jump command are plain vscode calls
 * covered by tsc; this pins the data round-trip.
 *
 * Run: node scripts/bookmark-smoke.cjs
 */
"use strict";
const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");

const extDir = path.resolve(__dirname, "..");
const ws = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-bm-ui-"));
fs.mkdirSync(path.join(ws, ".ai-memory"), { recursive: true });
fs.writeFileSync(path.join(ws, ".ai-memory", "sessions.jsonl"), "", "utf8");

const vscodeMock = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: ws }, name: "t", index: 0 }],
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
    getConfiguration: () => ({ get: (_k, d) => d }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
  },
  window: { showErrorMessage: (m) => console.error("  [showErrorMessage]", m) },
  RelativePattern: class { constructor(b, p) { this.base = b; this.pattern = p; } },
  Disposable: class { constructor(fn) { this._fn = fn; } dispose() { if (this._fn) this._fn(); } },
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === "vscode") return vscodeMock;
  return origLoad.apply(this, arguments);
};

const { ampIO } = require(path.join(extDir, "out", "amp.js"));

try {
  ampIO.attach();
  const written = ampIO.write({ type: "note", msg: "before the SP refactor", tags: ["bookmark"], file: "db/usp.sql", line: 12 });
  assert.ok(written, "ampIO.write returned nothing");
  console.log("✔ write returned entry:", written.id || "(no id)");

  const entries = ampIO.readEntries();
  const bm = entries.find(e => e.msg === "before the SP refactor");
  assert.ok(bm, "bookmark entry not found on read-back");
  assert.ok(Array.isArray(bm.tags) && bm.tags.includes("bookmark"),
    "TAGS NOT PERSISTED by bundled infernoflow-amp — tags=" + JSON.stringify(bm.tags));
  console.log("✔ tag persisted round-trip: tags =", JSON.stringify(bm.tags));

  // The tree filter that drives the Bookmarks section:
  const bookmarks = entries.filter(e => Array.isArray(e.tags) && e.tags.includes("bookmark"));
  assert.strictEqual(bookmarks.length, 1, "expected exactly 1 bookmark, got " + bookmarks.length);
  console.log("✔ Bookmarks-section filter picks it up (file " + bm.file + ":" + bm.line + ")");

  console.log("\nBOOKMARK UI DATA ROUND-TRIP PASSED");
  fs.rmSync(ws, { recursive: true, force: true });
} catch (e) {
  console.error("\nFAIL:", e.message);
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch {}
  process.exit(1);
}
