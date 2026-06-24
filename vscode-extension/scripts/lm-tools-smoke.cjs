/**
 * lm-tools-smoke — runtime check for the Copilot Language Model Tools path.
 *
 * Copilot Chat itself can't be scripted, but the part WE own can: this harness
 * loads the compiled extension with a minimal `vscode` mock, runs the real
 * `registerLmTools()`, then invokes the captured `amp_write` / `amp_read` tools
 * exactly as Copilot's runtime would — and asserts a real entry lands in
 * `.ai-memory/sessions.jsonl`.
 *
 * What it proves:
 *   1. Both tools register under the names the manifest declares.
 *   2. amp_write.invoke() validates input and persists via ampIO (source tag).
 *   3. amp_read.invoke() reads the entry back.
 *
 * What it does NOT prove: that Copilot's model decides to call the tool — that
 * needs a live Copilot session. Run: `node scripts/lm-tools-smoke.cjs`
 */
"use strict";

const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");

const extDir = path.resolve(__dirname, "..");

// ── temp workspace (a realistic, already-initialised infernoflow project) ────
const ws = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-lmtools-"));
fs.mkdirSync(path.join(ws, ".ai-memory"), { recursive: true });
fs.writeFileSync(path.join(ws, ".ai-memory", "sessions.jsonl"), "", "utf8");

// ── minimal vscode mock (only the surface amp.ts + lmTools.ts touch) ─────────
const captured = new Map();
const vscodeMock = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: ws }, name: "t", index: 0 }],
    createFileSystemWatcher: () => ({
      onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {},
    }),
    getConfiguration: () => ({ get: (_k, d) => d }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
  },
  window: {
    showErrorMessage: (m) => { console.error("  [vscode.window.showErrorMessage]", m); },
    showInformationMessage: () => {},
    showWarningMessage: () => {},
  },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  Disposable: class { constructor(fn) { this._fn = fn; } dispose() { if (this._fn) this._fn(); } },
  LanguageModelTextPart: class { constructor(value) { this.value = value; } },
  LanguageModelToolResult: class { constructor(content) { this.content = content; } },
  lm: {
    registerTool: (name, tool) => { captured.set(name, tool); return { dispose() {} }; },
  },
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === "vscode") return vscodeMock;
  return origLoad.apply(this, arguments);
};

// ── load the COMPILED extension (out/), not the .ts source ───────────────────
const { ampIO } = require(path.join(extDir, "out", "amp.js"));
const { registerLmTools } = require(path.join(extDir, "out", "lmTools.js"));

const text = (res) => res.content.map((p) => p.value).join("");

(async () => {
  ampIO.attach();
  registerLmTools({ subscriptions: [] });

  // 1. registration names match the manifest
  assert.ok(captured.has("amp_write"), "amp_write was not registered");
  assert.ok(captured.has("amp_read"), "amp_read was not registered");
  console.log("✔ registered tools:", [...captured.keys()].join(", "));

  // 2. invalid input is rejected without writing
  const bad = await captured.get("amp_write").invoke({ input: { type: "bogus", msg: "x" } }, {});
  assert.match(text(bad), /Invalid 'type'/, "bad type should be rejected");
  console.log("✔ amp_write rejects invalid type:", JSON.stringify(text(bad)));

  // 3. a valid write persists to disk with the copilot source tag
  const ok = await captured.get("amp_write").invoke(
    { input: { type: "gotcha", msg: "LM-tools smoke entry", file: "src/smoke.ts", line: 7 } }, {},
  );
  console.log("✔ amp_write result:", JSON.stringify(text(ok)));

  const sessions = path.join(ws, ".ai-memory", "sessions.jsonl");
  const entries = fs.readFileSync(sessions, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const found = entries.find((e) => e.msg === "LM-tools smoke entry" && e.type === "gotcha");
  assert.ok(found, "entry not persisted; on disk: " + JSON.stringify(entries));
  assert.strictEqual(found.source, "copilot-lm-tool", "source tag should be copilot-lm-tool, got " + found.source);
  assert.strictEqual(found.file, "src/smoke.ts");
  assert.strictEqual(found.line, 7);
  console.log("✔ entry persisted: source=" + found.source + " file=" + found.file + ":" + found.line);

  // 4. amp_read reads it back
  const r = await captured.get("amp_read").invoke({ input: { type: "gotcha" } }, {});
  assert.match(text(r), /LM-tools smoke entry/, "amp_read should return the entry; got: " + text(r));
  console.log("✔ amp_read returned the entry");

  console.log("\nALL LM-TOOL RUNTIME CHECKS PASSED");
  // best-effort cleanup
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
})().catch((e) => {
  console.error("\nFAIL:", e && e.message ? e.message : e);
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
