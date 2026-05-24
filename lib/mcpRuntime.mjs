/**
 * MCP-runtime stamp helpers — close the "after upgrade the IDE still has
 * the old MCP server loaded" footgun that bit 0.43→0.44 users.
 *
 * Flow:
 *   - The MCP server template writes `.ai-memory/.mcp-runtime.json` at
 *     boot, recording the version of infernoflow it's serving.
 *   - `setup` and `doctor` read that file and compare to the running CLI
 *     version. If they differ, the user has upgraded the CLI on disk but
 *     hasn't restarted their IDE — the running MCP process still has the
 *     old code in memory (and ships the old bugs, e.g. the field misroute
 *     where `file` became `source`).
 *   - We surface a single typed message the caller can print or attach to
 *     setup output.
 *
 * Why this matters: the only previous mitigation for this class of bug
 * was a paragraph in CHANGELOG. Users who skip release notes (most of
 * them) had no way to know the wrapper was stale.
 */
import * as fs   from "node:fs";
import * as path from "node:path";

/**
 * @typedef {Object} RuntimeStamp
 * @property {string}  version
 * @property {number}  [pid]
 * @property {string}  [bootedAt]   ISO timestamp
 * @property {string}  [source]
 */

/**
 * Read the boot stamp written by the MCP server. Returns null when no
 * stamp exists (MCP server hasn't booted yet in this project, or it's
 * pre-0.44.1 which doesn't write one).
 * @param {string} cwd
 * @returns {RuntimeStamp | null}
 */
export function readMcpRuntimeStamp(cwd) {
  const file = path.join(cwd, ".ai-memory", ".mcp-runtime.json");
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.version !== "string") return null;
    return parsed;
  } catch { return null; }
}

/**
 * Compare a runtime stamp against the running CLI version. Returns:
 *   - null              → versions match (or no stamp exists yet)
 *   - { severity: "warn", message } → upgrade detected, restart needed
 *
 * Severity is "warn" not "error" because the server still works at the
 * cached version — the user just doesn't get the new fixes until restart.
 * @param {RuntimeStamp | null} stamp
 * @param {string} cliVersion
 */
export function compareMcpRuntime(stamp, cliVersion) {
  if (!stamp || !stamp.version)             return null;
  if (stamp.version === cliVersion)         return null;
  // 0.0.0-source / 0.0.0-unknown: we're running from a dev tree, not a
  // published version. Skip the warning so devs working on infernoflow
  // itself don't get spammed.
  if (cliVersion.startsWith("0.0.0"))       return null;
  if (stamp.version.startsWith("0.0.0"))    return null;

  return {
    severity: "warn",
    message:
      `Your AI tool is running an older infernoflow MCP server: ` +
      `MCP=${stamp.version} (booted ${stamp.bootedAt}) vs CLI=${cliVersion}. ` +
      `Quit and reopen Cursor / Claude Code / VS Code to pick up the new code. ` +
      `Until you do, amp_write calls will use the cached old wrapper.`,
  };
}

/**
 * One-shot helper: read stamp, compare to version, return the message
 * (or null). Useful in `setup` / `doctor` where the caller just wants
 * "is this stale, and if so what do I tell the user."
 * @param {string} cwd
 * @param {string} cliVersion
 */
export function detectStaleMcpRuntime(cwd, cliVersion) {
  return compareMcpRuntime(readMcpRuntimeStamp(cwd), cliVersion);
}
