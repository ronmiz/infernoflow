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

describe("vscode-extension rule-file write policy (v0.44.3)", () => {
  // v0.44.1 banned the extension from writing rule files at all (CLI was the
  // single writer). v0.44.3 narrows that: the extension writes ONCE on
  // activation so auto-capture link 1 (the Memory-protocol block) lands even
  // when the CLI was never installed — but the per-edit/debounced path stays
  // inert, since per-edit writes were what blocked branch switches in v0.43.
  const text = fs.readFileSync(EXTENSION_TS, "utf8")

  it("imports rebuildAiRuleFiles as an ACTIVE import (not commented out)", () => {
    expect(text).toMatch(/^\s*import\s+\{\s*rebuildAiRuleFiles\s*\}\s+from\s+["']\.\/contextSync["']/m)
  })

  it("calls rebuildAiRuleFiles exactly once, gated behind isInitialised() (one-time bootstrap, not per-edit)", () => {
    const calls = text.match(/rebuildAiRuleFiles\s*\(\s*\)/g) || []
    expect(calls.length).toBe(1)
    expect(text).toContain("ampIO.isInitialised()")
  })

  it("does NOT rebuild rule files from the debounced per-edit scheduleRebuild path", () => {
    const m = text.match(/const scheduleRebuild = \(\) => \{([\s\S]*?)\n {2}\};/)
    expect(m).toBeTruthy()
    expect(m[1]).not.toContain("rebuildAiRuleFiles(")
  })
})
