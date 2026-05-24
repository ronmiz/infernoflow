/**
 * Tarball-install test — the closest thing we can do to a fresh-machine
 * install without actually spinning up a VM.
 *
 * Why:
 *   The standard tests in this repo all run against the *source tree*.
 *   That's faster but it MISSES a real class of bugs:
 *     - files left out of `package.json` "files" so they don't get
 *       published
 *     - bin path that resolves locally but not when installed via npm
 *     - dependencies referenced but not declared
 *     - hooks that run during `npm install` and fail silently
 *
 *   This test runs `npm pack` to produce the EXACT tarball that would go
 *   to the npm registry, installs it into a totally fresh temp project
 *   with no preinstalled infernoflow, runs `infernoflow init --yes`, and
 *   asserts the 60-second-magic loop fires correctly.
 *
 * Speed: ~10–30s per run. Excluded from the default `npm test` — invoke
 * via `npm run test:install` (added in v0.44.1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import * as fs   from "node:fs"
import * as os   from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT  = path.resolve(__dirname, "..")

// Speed-vs-thoroughness: pack once, install into N test projects.
let tarballPath = ""
let installDir  = ""

beforeAll(() => {
  // Build first so dist/ is up-to-date — npm pack copies dist/ verbatim.
  const build = spawnSync("npm", ["run", "build"], { cwd: PKG_ROOT, encoding: "utf8", shell: true, timeout: 120_000 })
  if (build.status !== 0) throw new Error("build failed:\n" + build.stdout + build.stderr)

  // npm pack writes the tarball to PKG_ROOT and prints its filename on stdout.
  const packed = spawnSync("npm", ["pack", "--silent"], { cwd: PKG_ROOT, encoding: "utf8", shell: true, timeout: 60_000 })
  if (packed.status !== 0) throw new Error("npm pack failed:\n" + packed.stdout + packed.stderr)
  const tarballName = packed.stdout.trim().split("\n").filter(Boolean).pop()
  tarballPath = path.join(PKG_ROOT, tarballName)
  if (!fs.existsSync(tarballPath)) throw new Error("expected tarball at " + tarballPath)

  // Install into a totally fresh temp project. `npm install <tarball>` will
  // create node_modules + put infernoflow's bin under node_modules/.bin/.
  installDir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-tarball-"))
  fs.writeFileSync(path.join(installDir, "package.json"),
    JSON.stringify({ name: "tarball-install-test", version: "0.0.0", private: true }, null, 2))

  const install = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefix", installDir, tarballPath], {
    cwd: installDir,
    encoding: "utf8",
    shell: true,
    timeout: 120_000,
  })
  if (install.status !== 0) {
    throw new Error("npm install of tarball failed:\n" + install.stdout + install.stderr)
  }
}, 240_000)

afterAll(() => {
  try { if (installDir) fs.rmSync(installDir, { recursive: true, force: true }) } catch {}
  try { if (tarballPath) fs.rmSync(tarballPath) } catch {}
})

function infernoflowBin() {
  // On Windows npm creates .cmd shims; on POSIX it's a symlink. Either
  // resolves to the same dist/bin/infernoflow.mjs.
  const direct = path.join(installDir, "node_modules", ".bin", "infernoflow")
  if (fs.existsSync(direct))             return direct
  if (fs.existsSync(direct + ".cmd"))    return direct + ".cmd"
  if (fs.existsSync(direct + ".exe"))    return direct + ".exe"
  // Last-ditch: spawn `node` directly against the bin entry in node_modules.
  return path.join(installDir, "node_modules", "infernoflow", "dist", "bin", "infernoflow.mjs")
}

function runCli(args, cwd) {
  const bin = infernoflowBin()
  // For .mjs paths spawn node directly; otherwise let the shim handle it.
  const isMjs = bin.toLowerCase().endsWith(".mjs")
  const child = isMjs
    ? spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } })
    : spawnSync(bin, args, { cwd, encoding: "utf8", shell: true, timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } })
  return child
}

function mkFreshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-fresh-"))
  fs.mkdirSync(path.join(dir, ".git", "refs", "heads"), { recursive: true })
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n")
  fs.writeFileSync(path.join(dir, ".git", "refs", "heads", "main"), "0".repeat(40) + "\n")
  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ name: "fresh-test", version: "0.0.0" }, null, 2))
  return dir
}

describe("tarball install — simulates npm install -g infernoflow on a fresh machine", () => {
  it("the tarball contains a runnable bin that reports the correct version", () => {
    const r = runCli(["--version"], installDir)
    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0)
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("infernoflow --help prints the trimmed command surface (17–19 commands)", () => {
    const r = runCli(["--help"], installDir)
    expect(r.status).toBe(0)
    // Memory core should be present.
    expect(r.stdout).toContain("log")
    expect(r.stdout).toContain("ask")
    expect(r.stdout).toContain("switch")
    expect(r.stdout).toContain("recap")
    expect(r.stdout).toContain("status")
    // Cut commands should NOT be present (regression: surface bloated again).
    expect(r.stdout).not.toContain("publish")
    expect(r.stdout).not.toContain("monorepo")
  })

  it("init --yes in a fresh project produces a working memory loop", () => {
    const project = mkFreshProject()
    try {
      const r = runCli(["init", "--yes"], project)
      expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0)

      // Required artifacts after init:
      expect(fs.existsSync(path.join(project, ".ai-memory")), ".ai-memory/ missing").toBe(true)
      expect(fs.existsSync(path.join(project, ".ai-memory", "amp.json"))).toBe(true)
      expect(fs.existsSync(path.join(project, ".gitignore"))).toBe(true)
      expect(fs.existsSync(path.join(project, ".gitattributes"))).toBe(true)

      // Rule files present for every supported IDE.
      for (const rel of [".cursorrules", "CLAUDE.md", path.join(".github", "copilot-instructions.md")]) {
        expect(fs.existsSync(path.join(project, rel)), `missing rule file: ${rel}`).toBe(true)
      }

      // Demo entry should be in the branch file (init --yes auto-logs one).
      const branchFile = path.join(project, ".ai-memory", "branches", "main.jsonl")
      expect(fs.existsSync(branchFile), "demo entry not written").toBe(true)
      const lines = fs.readFileSync(branchFile, "utf8").trim().split("\n").filter(Boolean)
      expect(lines.length).toBeGreaterThanOrEqual(1)
    } finally {
      fs.rmSync(project, { recursive: true, force: true })
    }
  })

  it("status reports the demo entry after init", () => {
    const project = mkFreshProject()
    try {
      runCli(["init", "--yes"], project)
      const r = runCli(["status", "--json"], project)
      expect(r.status).toBe(0)
      const parsed = JSON.parse(r.stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.entries).toBeGreaterThanOrEqual(1)
    } finally {
      fs.rmSync(project, { recursive: true, force: true })
    }
  })
})
