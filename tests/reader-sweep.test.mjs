/**
 * Reader-sweep regression: pin down that no CLI command directly reads
 * `sessions.jsonl` in a way that bypasses the branch-aware merge.
 *
 * Why: v0.44 introduced `branches/<branch>.jsonl` + `global.jsonl`. The
 * merged `readEntries()` in lib/amp/io.mjs unions all three. Before the
 * v0.44.1 sweep, several commands (status, doctor, amp validate) had
 * their own private readers that hit only the legacy flat file — so
 * they under-reported by entire branches' worth of data. This test fails
 * if any such private reader is reintroduced.
 *
 * Detection: grep lib/commands/*.mjs for `readFileSync` patterns that
 * point at a `sessions.jsonl` path, and assert the match list is empty
 * (or whitelisted — `init.mjs` legitimately CREATES the file, doesn't
 * read it for entries).
 */
import { describe, it, expect } from "vitest"
import * as fs   from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const COMMANDS_DIR = path.resolve(__dirname, "..", "lib", "commands")

// Patterns that, if found in a non-whitelisted file, indicate a private reader.
const FORBIDDEN_PATTERNS = [
  /readFileSync\([^)]*sessions\.jsonl/,
  /readFileSync\([^)]*\.sessions\b/,
  /readFileSync\([^)]*ampPaths\([^)]*\)\.sessions/,
]

// Files that legitimately touch sessions.jsonl in a non-reader capacity.
const WHITELIST = new Set([
  // init.mjs creates an empty sessions.jsonl during scaffolding (writeFileSync),
  // not a read. The regex below distinguishes write vs read explicitly.
  "init.mjs",
  // log.mjs's writes go through appendEntry in amp/io.mjs, not direct reads.
  "log.mjs",
  // amp.mjs reads ALL jsonl files (sessions + global + branches) for `amp
  // validate` with per-file line numbers — that's correct branch-aware
  // behavior. Its raw read isn't bypassing the merged read, it's
  // a different operation (file-by-file validation).
  "amp.mjs",
  // uninstall.mjs references the file path for cleanup, doesn't read entries.
  "uninstall.mjs",
])

describe("reader-sweep regression", () => {
  const files = fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith(".mjs"))

  it.each(files)("%s does not contain a private sessions.jsonl reader (use readEntries from amp/io.mjs)", (file) => {
    if (WHITELIST.has(file)) return
    const text = fs.readFileSync(path.join(COMMANDS_DIR, file), "utf8")
    for (const pat of FORBIDDEN_PATTERNS) {
      const m = text.match(pat)
      expect(
        m,
        `${file}: found '${m?.[0]}' — replace with the merged reader.\n` +
        `       import { readEntries } from "../amp/io.mjs"; const entries = readEntries(cwd);`,
      ).toBeNull()
    }
  })

  it("the merged readEntries IS imported by every memory-reading command", () => {
    // Any command that consumes session memory should import readEntries.
    // This catches the OPPOSITE bug: a command that reads memory via some
    // OTHER private path entirely. Hand-curated list of commands that DO
    // read memory — keep in sync with what the product offers.
    const MEMORY_READERS = ["status.mjs", "recap.mjs", "ask.mjs", "switch.mjs", "doctor.mjs"]
    for (const file of MEMORY_READERS) {
      const text = fs.readFileSync(path.join(COMMANDS_DIR, file), "utf8")
      expect(
        text.match(/readEntries\s+as\s+\w+|readEntries\s*[},]/),
        `${file}: must import readEntries from amp/io.mjs`,
      ).not.toBeNull()
    }
  })
})
