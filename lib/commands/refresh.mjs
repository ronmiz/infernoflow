/**
 * infernoflow refresh
 *
 * Hand-crank for the rule-file write triggers. Rebuilds CLAUDE.md,
 * .cursorrules, and .github/copilot-instructions.md from the current
 * memory so the *next* AI session starts with up-to-date context.
 *
 * When you actually need this:
 *   - After `git checkout` to a branch with different memory entries
 *   - Before starting a fresh AI session if you've been logging via the
 *     VS Code extension AND you don't have the MCP server (which would
 *     refresh on its own at boot)
 *   - Debugging: "why isn't the agent seeing my latest gotcha?"
 *
 * Normally not needed:
 *   - MCP server boot refreshes automatically (see inferno-mcp-server.mjs)
 *   - VS Code extension refreshes live as memory changes
 *   - `infernoflow init` and `infernoflow setup` both write the initial files
 *
 * The default no-op-when-unchanged behavior of refreshRuleFilesFromMemory
 * keeps this idempotent.
 *
 * Usage:
 *   infernoflow refresh                 Rebuild rule files
 *   infernoflow refresh --json          Print the result as JSON
 *   infernoflow refresh --dry-run       Show what would change without writing
 *   infernoflow refresh --max-memory N      Cap injected memory entries (writes config)
 *   infernoflow refresh --max-commits N     Cap injected git commits (writes config)
 *   infernoflow refresh --max-entry-chars N Truncate each injected entry (writes config)
 *   infernoflow refresh --no-protocol       Stop injecting the protocol block (writes config)
 */
import { refreshRuleFilesFromMemory } from "../ruleFiles.mjs";
import { updateInjectionConfig } from "../amp/io.mjs";
import { findProjectRoot } from "../projectRoot.mjs";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

/** Read an integer flag value, e.g. numFlag(args, "--max-memory"). */
function numFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = parseInt(args[i + 1], 10);
  return Number.isFinite(v) ? v : undefined;
}

/** Build an injection-config patch from CLI flags (empty if none given). */
export function injectionPatchFromArgs(args) {
  const patch = {};
  const mm = numFlag(args, "--max-memory");      if (mm !== undefined) patch.maxEntries    = mm;
  const mc = numFlag(args, "--max-commits");     if (mc !== undefined) patch.maxCommits    = mc;
  const me = numFlag(args, "--max-entry-chars"); if (me !== undefined) patch.maxEntryChars = me;
  if (args.includes("--no-protocol")) patch.includeProtocol = false;
  if (args.includes("--protocol"))    patch.includeProtocol = true;
  return patch;
}

export async function refreshCommand(args) {
  const dryRun  = args.includes("--dry-run") || args.includes("-n");
  const jsonOut = args.includes("--json");

  const root = findProjectRoot(process.cwd());

  // Persist any injection-tuning flags to amp.json before rebuilding, so the
  // rebuild (and every future write) honors them.
  const patch = injectionPatchFromArgs(args);
  if (!dryRun && Object.keys(patch).length) {
    try { updateInjectionConfig(root, patch); } catch { /* non-fatal */ }
  }

  if (dryRun) {
    if (jsonOut) {
      console.log(JSON.stringify({ dryRun: true, projectRoot: root }, null, 2));
      return;
    }
    console.log("\n  " + bold("🔥 infernoflow refresh") + gray(" — dry run"));
    console.log("  " + gray("Project root: ") + cyan(root));
    console.log("  " + gray("Would rewrite: ") + ".cursorrules, CLAUDE.md, .github/copilot-instructions.md");
    console.log();
    return;
  }

  let results;
  try {
    results = refreshRuleFilesFromMemory(root);
  } catch (err) {
    if (jsonOut) {
      console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    } else {
      console.error(red("\n  ✘ refresh failed: ") + err.message + "\n");
    }
    process.exit(1);
  }

  if (jsonOut) {
    console.log(JSON.stringify({ ok: true, projectRoot: root, results }, null, 2));
    return;
  }

  console.log("\n  " + bold("🔥 infernoflow refresh"));
  console.log("  " + "─".repeat(50));
  for (const r of results) {
    if ("error" in r && r.error) {
      console.log("  " + red("✘ ") + r.rel + gray(" — " + r.error));
    } else if ("created" in r && (r.created || r.updated)) {
      console.log("  " + green("✔ ") + r.rel + gray(r.created ? " — created" : " — updated"));
    } else {
      console.log("  " + gray("· ") + r.rel + gray(" — unchanged"));
    }
  }
  console.log();
}
