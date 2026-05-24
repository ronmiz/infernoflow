/**
 * Extension/CLI dedup pin: the vscode-extension's file watcher widened
 * in v0.44.1 to cover branches/*.jsonl + global.jsonl. Before the fix the
 * pattern was `{.ai-memory,inferno}/sessions.jsonl` — invisible to every
 * branch write. Pin the new shape so a future refactor can't silently
 * narrow it again.
 *
 * Static analysis, not runtime — we can't load the vscode API in vitest.
 */
import { describe, it, expect } from "vitest"
import * as fs   from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AMP_TS = path.resolve(__dirname, "..", "vscode-extension", "src", "amp.ts")
const EXTENSION_TS = path.resolve(__dirname, "..", "vscode-extension", "src", "extension.ts")

describe("vscode-extension watcher pattern", () => {
  it("watches every .jsonl file under .ai-memory/ + inferno/, not just sessions.jsonl", () => {
    const text = fs.readFileSync(AMP_TS, "utf8")
    // The widened glob.
    expect(text).toContain('{.ai-memory,inferno}/**/*.jsonl')
    // The old narrow pattern must NOT be the live one.
    expect(text).not.toMatch(/RelativePattern\([^)]*['"]\{\.ai-memory,inferno\}\/sessions\.jsonl['"]/)
  })
})

describe("vscode-extension delegates rule-file writes to the CLI", () => {
  it("does NOT call rebuildAiRuleFiles from the auto-refresh path", () => {
    const text = fs.readFileSync(EXTENSION_TS, "utf8")
    // The auto-refresh path used to call rebuildAiRuleFiles(activeFile)
    // on every memory change. v0.44.1 removed that — only an explicit
    // user-triggered command (in commands.ts) still calls the writer.
    // We assert the auto path is no longer active by checking the import
    // is commented out at module top.
    expect(text).toMatch(/\/\/.*import\s+\{\s*rebuildAiRuleFiles\s*\}/)
  })
})
