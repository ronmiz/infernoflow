/**
 * MCP-restart footgun regression: when the user upgrades the CLI on disk
 * but doesn't restart their IDE, the still-running MCP server keeps
 * serving the old code. Before v0.44.1 the only mitigation was a
 * paragraph in CHANGELOG. v0.44.1 added:
 *   1. The MCP server writes .ai-memory/.mcp-runtime.json at boot with
 *      its version.
 *   2. lib/mcpRuntime.mjs reads it and compares to the installed CLI
 *      version, returning a typed warning when they differ.
 *   3. setup + doctor surface the warning.
 *
 * These tests pin the warning behavior so a future refactor can't silently
 * stop firing it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs   from "node:fs"
import * as os   from "node:os"
import * as path from "node:path"

import {
  readMcpRuntimeStamp,
  compareMcpRuntime,
  detectStaleMcpRuntime,
} from "../lib/mcpRuntime.mjs"

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-mcp-stamp-"))
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true })
  return dir
}
function writeStamp(dir, stamp) {
  fs.writeFileSync(path.join(dir, ".ai-memory", ".mcp-runtime.json"), JSON.stringify(stamp))
}
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} }

describe("readMcpRuntimeStamp", () => {
  let cwd
  beforeEach(() => { cwd = mkTmp() })
  afterEach(() => rmrf(cwd))

  it("returns null when no stamp exists", () => {
    expect(readMcpRuntimeStamp(cwd)).toBeNull()
  })

  it("returns the parsed stamp when the file is valid", () => {
    writeStamp(cwd, { version: "0.44.0", pid: 1234, bootedAt: "2026-05-19T08:00:00Z" })
    const r = readMcpRuntimeStamp(cwd)
    expect(r?.version).toBe("0.44.0")
    expect(r?.pid).toBe(1234)
  })

  it("returns null for malformed JSON (does not throw)", () => {
    fs.writeFileSync(path.join(cwd, ".ai-memory", ".mcp-runtime.json"), "{ not json")
    expect(readMcpRuntimeStamp(cwd)).toBeNull()
  })

  it("returns null when version field is missing", () => {
    fs.writeFileSync(path.join(cwd, ".ai-memory", ".mcp-runtime.json"), JSON.stringify({ pid: 1 }))
    expect(readMcpRuntimeStamp(cwd)).toBeNull()
  })
})

describe("compareMcpRuntime — version skew detection", () => {
  it("returns null when versions match (no warning needed)", () => {
    const r = compareMcpRuntime({ version: "0.44.0" }, "0.44.0")
    expect(r).toBeNull()
  })

  it("returns a warn when stamp is older than CLI (post-upgrade, pre-restart)", () => {
    const r = compareMcpRuntime({ version: "0.43.12", bootedAt: "2026-05-15T00:00:00Z" }, "0.44.0")
    expect(r).not.toBeNull()
    expect(r?.severity).toBe("warn")
    expect(r?.message).toMatch(/0\.43\.12/)
    expect(r?.message).toMatch(/0\.44\.0/)
    expect(r?.message).toMatch(/quit and reopen|restart/i)
  })

  it("returns null when stamp is null (no MCP has booted in this project yet)", () => {
    expect(compareMcpRuntime(null, "0.44.0")).toBeNull()
  })

  it("skips warning for dev/source builds (0.0.0-*) so contributors aren't spammed", () => {
    expect(compareMcpRuntime({ version: "0.44.0" },   "0.0.0-source")).toBeNull()
    expect(compareMcpRuntime({ version: "0.0.0-source" }, "0.44.0")).toBeNull()
  })

  it("works for downgrade case too (MCP newer than installed CLI — rare but possible)", () => {
    const r = compareMcpRuntime({ version: "0.44.5" }, "0.44.0")
    expect(r).not.toBeNull()
    expect(r?.severity).toBe("warn")
  })
})

describe("detectStaleMcpRuntime — one-shot helper", () => {
  let cwd
  beforeEach(() => { cwd = mkTmp() })
  afterEach(() => rmrf(cwd))

  it("returns null in a project with no stamp", () => {
    expect(detectStaleMcpRuntime(cwd, "0.44.0")).toBeNull()
  })

  it("returns null when the stamp matches CLI", () => {
    writeStamp(cwd, { version: "0.44.0", pid: 1, bootedAt: "x" })
    expect(detectStaleMcpRuntime(cwd, "0.44.0")).toBeNull()
  })

  it("returns a warning when the stamp lags CLI", () => {
    writeStamp(cwd, { version: "0.43.12", pid: 1, bootedAt: "2026-05-15T00:00:00Z" })
    const r = detectStaleMcpRuntime(cwd, "0.44.0")
    expect(r).not.toBeNull()
    expect(r?.message).toMatch(/quit and reopen|restart/i)
    expect(r?.message).toMatch(/0\.43\.12/)
  })
})
