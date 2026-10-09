/**
 * 0.46.3 Fix #5 — `infernoflow doctor --e2e` runs the whole chain (CLI, MCP
 * server with every listed tool, hooks, attribution) in a sandbox. Run it on
 * every OS in the test matrix; the runtime job runs it on the built dist/.
 */
import { describe, it, expect } from "vitest";
import { runE2E } from "../lib/e2e.mjs";

describe("doctor --e2e", () => {
  it("every step passes in a sandbox", () => {
    const results = runE2E();
    const notOk = results.filter(r => r.status === "fail");
    expect(notOk, JSON.stringify(notOk, null, 2)).toEqual([]);
    expect(results.map(r => r.label)).toEqual(expect.arrayContaining(["MCP tools (memory mode)", "MCP tools (full mode)", "Prompt hook", "Git drift without git"]));
  }, 180_000);
});
