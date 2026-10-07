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
 *   infernoflow refresh --protocol-style S  compact | full | off  (writes config)
 *   infernoflow refresh --targets a,b       Only write the block to these files (writes config)
 *   infernoflow refresh --targets auto      Write to the canonical file for the running IDE only
 *   infernoflow refresh --no-protocol       Stop injecting the protocol block (writes config)
 */
import * as path from "node:path";
import { refreshRuleFilesFromMemory } from "../ruleFiles.mjs";
import { updateInjectionConfig } from "../amp/io.mjs";
import { findProjectRoot } from "../projectRoot.mjs";
import { detectIdeContext } from "../ai/ideDetection.mjs";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

const COPILOT_FILE = path.join(".github", "copilot-instructions.md");
const ALL_RULE_FILES = [".cursorrules", "CLAUDE.md", COPILOT_FILE];

/** Read an integer flag value, e.g. numFlag(args, "--max-memory"). */
function numFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = parseInt(args[i + 1], 10);
  return Number.isFinite(v) ? v : undefined;
}

/** Read a raw string flag value, e.g. strFlag(args, "--targets"). */
function strFlag(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
}

/**
 * `--targets auto`: write the memory block to the ONE canonical rule file for
 * the IDE you're running from, instead of all three — so a single-IDE project
 * doesn't pay for (and Copilot doesn't double-load) blocks in files it never
 * reads. Best-effort: falls back to all three when the IDE can't be told,
 * which is safe (current default). Use explicit `--targets a,b` for full control.
 */
export function resolveAutoTargets() {
  const env = process.env;
  if (env.CLAUDE_CODE_SESSION || env.CLAUDECODE) return ["CLAUDE.md"];
  const { ideDetected } = detectIdeContext("auto");
  if (ideDetected === "cursor") return [".cursorrules"];
  if (ideDetected === "vscode") return [COPILOT_FILE];   // VS Code Copilot
  return ALL_RULE_FILES;                                  // windsurf / unknown → all (safe)
}

/** Build an injection-config patch from CLI flags (empty if none given). */
export function injectionPatchFromArgs(args) {
  const patch = {};
  const mm = numFlag(args, "--max-memory");      if (mm !== undefined) patch.maxEntries    = mm;
  const mc = numFlag(args, "--max-commits");     if (mc !== undefined) patch.maxCommits    = mc;
  const me = numFlag(args, "--max-entry-chars"); if (me !== undefined) patch.maxEntryChars = me;
  if (args.includes("--no-protocol")) patch.includeProtocol = false;
  if (args.includes("--protocol"))    patch.includeProtocol = true;
  const ps = strFlag(args, "--protocol-style");
  if (ps && ["compact", "full", "off"].includes(ps)) patch.protocolStyle = ps;
  const tg = strFlag(args, "--targets");
  if (tg) {
    patch.targets = tg === "auto"
      ? resolveAutoTargets()
      : tg.split(",").map(s => s.trim()).filter(Boolean);
  }
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
  // Transparency: when targets are set (esp. `--targets auto`), show the choice
  // so the user knows which files will carry the block and which get stripped.
  if (patch.targets && !jsonOut) {
    const lean = patch.targets.length < 3;
    console.log("\n  " + green("✔") + gray(" memory block → ") + cyan(patch.targets.join(", ")) +
      (lean ? gray("  (other rule files' blocks are stripped — no double-load)") : ""));
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
