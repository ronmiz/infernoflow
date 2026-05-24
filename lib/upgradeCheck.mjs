/**
 * lib/upgradeCheck.mjs — silent, transparent CLI-version-skew detection.
 *
 * Why this exists:
 *   Real dogfood failure (caught 2026-05-13): user was on CLI 0.43.4, ran
 *   `infernoflow init`, then upgraded to 0.43.10 via `npm install -g`.
 *   The new init had auto-MCP-setup baked in — but their existing project
 *   never re-ran init, so MCP was silently NOT wired up. They had to run
 *   `infernoflow setup --yes` as a separate manual step. The "one install
 *   = everything works" promise broke on every upgrade.
 *
 * What this does:
 *   On every CLI invocation, check whether the project's last-seen CLI
 *   version matches the currently-running one. If they differ (or no marker
 *   exists at all), run the silent backfill that init already does:
 *     - ensureGitignoreEntries — keeps memory developer-local
 *     - writeInitRuleFiles     — writes the Memory protocol skill block
 *     - autoSetupMcp           — wires up MCP for all four AI tools
 *   Then write the current version into `.ai-memory/.last-cli-version`
 *   (or `inferno/.last-cli-version` for legacy projects) so the same
 *   upgrade only runs once per project per version bump.
 *
 * What this DOESN'T do:
 *   - Never throws. The check must never block a command. Worst case it
 *     prints nothing and the user keeps working.
 *   - Never runs in projects that don't already have `.ai-memory/` or
 *     `inferno/`. We don't want to scaffold infernoflow into random repos.
 *   - Never runs for help/version/info commands. Cheap exit path.
 *   - Never prompts the user. The whole point is transparency.
 *
 * What's printed:
 *   By default nothing. If MCP setup actually wrote files (because they
 *   weren't there yet), a one-line "infernoflow: upgraded N → M, wired
 *   MCP servers" is shown to the user so the silent behavior is at least
 *   surfaced once.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Commands that should NOT trigger the upgrade check. Help/version are
// metadata reads; if we ran setup on `--version`, that would be surprising
// behavior. `setup` and `init` already do the same work explicitly.
const SKIP_COMMANDS = new Set([
  "--help", "-h", "--version", "-v",
  "commands", "doctor", "setup", "init", "uninstall",
]);

/**
 * Return the path to the .last-cli-version marker for this project. Prefer
 * `.ai-memory/` (AMP layout); fall back to `inferno/` if only the legacy
 * layout exists. Returns null when neither directory is present.
 */
function findMarkerPath(cwd) {
  const ampDir    = path.join(cwd, ".ai-memory");
  const legacyDir = path.join(cwd, "inferno");
  if (fs.existsSync(ampDir))    return path.join(ampDir,    ".last-cli-version");
  if (fs.existsSync(legacyDir)) return path.join(legacyDir, ".last-cli-version");
  return null;
}

/**
 * Read the previously-recorded CLI version for this project, or "" if no
 * marker has ever been written.
 */
function readLastVersion(markerPath) {
  try {
    return fs.readFileSync(markerPath, "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Public entry point — called once at the top of bin/infernoflow.mjs before
 * routing to a command handler. Pass the current CLI version and the
 * command-being-run; if a skew is detected, run the backfill.
 *
 * Wrapped in try/catch at the call site so any failure here is completely
 * invisible to the user.
 */
export async function runUpgradeBackfillIfNeeded(currentVersion, cmd) {
  // Cheap guards first — no I/O, no imports if we're going to skip
  if (!currentVersion) return;
  if (cmd && SKIP_COMMANDS.has(cmd)) return;

  const cwd = process.cwd();
  const markerPath = findMarkerPath(cwd);
  if (!markerPath) return; // Not an infernoflow project — bail

  const lastVersion = readLastVersion(markerPath);
  if (lastVersion === currentVersion) return; // Already up to date

  // ── Skew detected — run the silent backfill ───────────────────────────────
  // Dynamic imports keep the cold-start cost off the common path. Wrapped in
  // a single try so any individual backfill step that fails (e.g. on a host
  // where ~/.claude.json is read-only) doesn't poison the others.
  let mcpChanged = false;
  let firstUpgrade = lastVersion === "";

  try {
    // Use the memory-aware rebuild so the rule file includes existing
    // entries — falls back to the init stub if memory is empty.
    const { refreshRuleFilesFromMemory } = await import("./ruleFiles.mjs");
    refreshRuleFilesFromMemory(cwd);
  } catch { /* swallow */ }

  try {
    // v0.44 clean-tree policy. Idempotent and also strips the legacy v0.43
    // gitignore block — projects upgrading from older versions migrate
    // automatically on the first CLI run after install.
    const { applyCleanTreePolicy } = await import("./cleanTree.mjs");
    applyCleanTreePolicy(cwd);
  } catch { /* swallow */ }

  try {
    const { autoSetupMcp } = await import("./commands/setup.mjs");
    const summary = autoSetupMcp(cwd, { silent: true });
    // If any MCP file was actually written, surface a one-line note so the
    // user sees the system did something on their behalf.
    mcpChanged = !!(summary && (summary.mcpServer || summary.claudeJson || summary.cursorMcp || summary.vscodeMcp || summary.claudeSettings));
  } catch { /* swallow */ }

  // Persist the new version so this runs at most once per upgrade
  try {
    fs.writeFileSync(markerPath, currentVersion, "utf8");
  } catch { /* swallow — at worst we'll re-run next invocation */ }

  // ── User-visible breadcrumb ───────────────────────────────────────────────
  // Quiet but not invisible — the user should know SOMETHING changed under
  // their feet, especially since this fires on every command run after an
  // upgrade. One line, never a prompt.
  if (mcpChanged || firstUpgrade) {
    try {
      // Lazy require so the upgrade check itself stays import-cheap
      const { gray } = await import("./ui/output.mjs");
      const verb = lastVersion ? `upgraded ${lastVersion} → ${currentVersion}` : `initialized for ${currentVersion}`;
      process.stderr.write(gray(`  infernoflow: ${verb}, wired MCP servers + rule files\n`));
    } catch {
      // Fallback if ui module errored (color codes mismatched, etc.)
      process.stderr.write(`  infernoflow: refreshed for v${currentVersion}\n`);
    }
  }
}
