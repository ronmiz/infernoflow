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
 */
import { refreshRuleFilesFromMemory } from "../ruleFiles.mjs";
import { findProjectRoot } from "../projectRoot.mjs";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

export async function refreshCommand(args) {
  const dryRun  = args.includes("--dry-run") || args.includes("-n");
  const jsonOut = args.includes("--json");

  const root = findProjectRoot(process.cwd());

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
