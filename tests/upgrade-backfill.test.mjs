/**
 * Upgrade-backfill smoke: simulate a v0.43.x project on disk and run a v0.44
 * CLI command in it. The silent upgrade backfill (lib/upgradeCheck.mjs) must
 * migrate it cleanly:
 *   - the legacy `# --- infernoflow ---` .gitignore block is replaced with
 *     the v0.44 `# >>> infernoflow:start` clean-tree policy
 *   - rule files are refreshed (in case they had the old dual-block bug)
 *   - .last-cli-version is updated so the backfill doesn't re-run forever
 *
 * Why: dogfood found that the user couldn't see new captures in their
 * existing project because v0.43 layout assumptions persisted past upgrade.
 * This test catches that class of regression.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import * as fs   from "node:fs"
import * as os   from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs")

// The exact legacy markers the v0.43 init flow used. If the backfill
// doesn't recognise these, projects that were on 0.43.x for months keep
// the old block forever.
const LEGACY_GITIGNORE = [
  "node_modules",
  "",
  "# --- infernoflow (developer-local AI memory; do not commit) ---",
  ".ai-memory/",
  ".cursorrules",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  "# --- /infernoflow ---",
  "",
  "dist",
  "",
].join("\n")

function mkV043Project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-v043-"))
  // Real git so branch detection picks up "main".
  fs.mkdirSync(path.join(dir, ".git", "refs", "heads"), { recursive: true })
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n")
  fs.writeFileSync(path.join(dir, ".git", "refs", "heads", "main"), "0".repeat(40) + "\n")

  // v0.43-shaped .ai-memory: a flat sessions.jsonl, no branches/ dir,
  // no global.jsonl, .last-cli-version pinned to an old version so the
  // backfill thinks it needs to fire.
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true })
  fs.writeFileSync(path.join(dir, ".ai-memory", ".last-cli-version"), "0.43.12")
  fs.writeFileSync(
    path.join(dir, ".ai-memory", "sessions.jsonl"),
    [
      JSON.stringify({ type: "gotcha", msg: "old entry from v0.43", ts: 1, id: "amp_LEGACY1", meta: { agent: "human" } }),
      JSON.stringify({ type: "decision", msg: "another old one", ts: 2, id: "amp_LEGACY2", meta: { agent: "human" } }),
    ].join("\n") + "\n",
  )
  fs.writeFileSync(path.join(dir, ".ai-memory", "amp.json"),
    JSON.stringify({ amp: "1.0", project: "upgrade-test", config: {} }, null, 2))

  // Legacy .gitignore block — the v0.43 "ignore everything" philosophy.
  fs.writeFileSync(path.join(dir, ".gitignore"), LEGACY_GITIGNORE)

  // Stale CLAUDE.md with BOTH managed blocks (the bug dogfood surfaced).
  fs.writeFileSync(path.join(dir, "CLAUDE.md"),
    "# Project\n\n" +
    "<!-- infernoflow:start -->\n## Old content\n- ⚠ gotcha: stale\n<!-- infernoflow:end -->\n\n" +
    "<!-- AMP:START -->\n# Duplicate block\n<!-- AMP:END -->\n")

  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ name: "upgrade-test", version: "0.0.0" }, null, 2))
  return dir
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, NO_COLOR: "1" },
  })
}

describe("upgrade backfill — v0.43.x project gets cleanly migrated by v0.44 CLI", () => {
  let project
  beforeEach(() => { project = mkV043Project() })
  afterEach(() => { try { fs.rmSync(project, { recursive: true, force: true }) } catch {} })

  it("running any CLI command triggers the silent backfill and replaces the legacy .gitignore block", () => {
    const r = runCli(["status"], project)
    expect(r.status).toBe(0)

    const gi = fs.readFileSync(path.join(project, ".gitignore"), "utf8")
    // Legacy block stripped.
    expect(gi).not.toContain("# --- infernoflow (developer-local")
    expect(gi).not.toContain("# --- /infernoflow ---")
    // New v0.44 clean-tree block in place.
    expect(gi).toContain("# >>> infernoflow:start")
    expect(gi).toContain(".ai-memory/global.jsonl")
    // User's own .gitignore entries preserved.
    expect(gi).toContain("node_modules")
    expect(gi).toContain("dist")
  })

  it("rebuilds CLAUDE.md cleanly — no duplicate `<!-- AMP:START -->` block lingers", () => {
    runCli(["status"], project)
    const claude = fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8")
    // The new managed block exists.
    expect(claude).toMatch(/<!--\s*infernoflow:start\s*-->/)
    // The old dual block must be gone.
    expect(claude).not.toMatch(/<!--\s*AMP:START\s*-->/)
    // Exactly one managed block.
    const matches = claude.match(/<!--\s*infernoflow:start\s*-->/g) || []
    expect(matches.length).toBe(1)
  })

  it("preserves the existing v0.43 sessions.jsonl entries via the merged reader", () => {
    runCli(["status"], project)
    const statusJson = runCli(["status", "--json"], project)
    expect(statusJson.status).toBe(0)
    const parsed = JSON.parse(statusJson.stdout)
    expect(parsed.ok).toBe(true)
    // Both legacy entries should still be counted.
    expect(parsed.entries).toBeGreaterThanOrEqual(2)
  })

  it("updates .last-cli-version so the backfill doesn't re-run forever", () => {
    runCli(["status"], project)
    const lastVer = fs.readFileSync(path.join(project, ".ai-memory", ".last-cli-version"), "utf8").trim()
    expect(lastVer).not.toBe("0.43.12")
    // It should be SOME version string (could be "0.0.0-source" when running
    // from the source tree, or 0.44.x when running from dist).
    expect(lastVer).toMatch(/^\d/)
  })

  it("is idempotent — running again after upgrade does not re-mutate files", () => {
    runCli(["status"], project)
    const giAfter1 = fs.readFileSync(path.join(project, ".gitignore"), "utf8")
    const claudeAfter1 = fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8")

    runCli(["status"], project)
    const giAfter2 = fs.readFileSync(path.join(project, ".gitignore"), "utf8")
    const claudeAfter2 = fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8")

    expect(giAfter2).toBe(giAfter1)
    expect(claudeAfter2).toBe(claudeAfter1)
  })
})
