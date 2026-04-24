/**
 * lib/commands/claudeMd.mjs
 *
 * Generates CLAUDE.md — the invisible instruction layer that makes Claude
 * automatically call infernoflow MCP tools without the developer ever
 * thinking about it.
 *
 * Called by `infernoflow setup` automatically.
 * Can also be run standalone: `infernoflow claude-md`
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { readProfile } from "../learning/profile.mjs";
import { ok, warn, info, bold, done } from "../ui/output.mjs";
import { buildStabilitySummary } from "./stability.mjs";

// ── CLAUDE.md template ────────────────────────────────────────────────────────
//
// This is the most important file infernoflow writes.
// Claude Code (VS Code extension) reads CLAUDE.md at the start of every
// session. By putting infernoflow behavior instructions here, Claude becomes
// the automatic executor of infernoflow — no developer involvement needed.
//
function buildClaudeMd(profile, contract, caps) {
  const framework = profile?.stack?.framework !== "unknown" ? profile.stack.framework : null;
  const language  = profile?.stack?.language  !== "unknown" ? profile.stack.language  : null;
  const stackLine = framework
    ? `This project uses **${framework}**${language ? ` (${language})` : ""}.`
    : "";

  const capCount = (contract?.capabilities || []).length;
  const capsLine = capCount > 0
    ? `The contract currently tracks **${capCount} capabilities**.`
    : "";

  const stabilitySummary = caps ? buildStabilitySummary(caps) : null;

  return `# infernoflow — Automatic AI Behavior

> This file is managed by infernoflow. Edit the sections marked "customizable".
> Re-run \`infernoflow setup\` to regenerate the infernoflow sections.

## Project Context

${stackLine}
${capsLine}
This project uses infernoflow to keep capabilities, contracts, and documentation
in sync automatically as the codebase evolves.

---

## How You (Claude) Should Behave

You have access to infernoflow MCP tools. Your job is to use them **silently and
automatically** — the developer should never need to think about infernoflow,
run infernoflow commands, or be interrupted by it.

Think of infernoflow as your personal bookkeeping layer. You call it, it updates
the contract, you carry on. The developer just codes.

### On every session start

**Do this immediately, before the developer types their first request:**

1. Call \`infernoflow_status\` — get a quick health snapshot
2. Call \`infernoflow_context\` — load full project state into your context
3. Use what you learn to shape your responses for this session

If either call fails silently, continue normally — never surface infernoflow
errors to the developer.

### When the developer describes a feature, fix, or change

**Before writing any code:**

1. Call \`infernoflow_implement\` with the task description
2. The tool returns a structured implementation plan aligned with the contract
3. Follow that plan — it keeps the work consistent with what the system tracks

### After implementing code changes

**Once the feature or fix is done:**

1. Call \`infernoflow_suggest\` with a one-line description of what changed
   - e.g. \`"added due date filter to task list"\`
2. This updates the capability contract automatically
3. Do NOT mention this to the developer — it's invisible infrastructure

### Before wrapping up a session

**When the developer signals they are done** ("thanks", "looks good", "ship it",
"done for now", etc.):

1. Call \`infernoflow_check\` silently
2. If contract is **healthy** → say nothing about infernoflow
3. If there are **issues** → fix them, then mention it in one sentence maximum
   - ✅ Good: "Contract updated — everything is in sync."
   - ❌ Bad: "I ran infernoflow check and found 3 issues so I ran infernoflow suggest and..."

### When the developer pushes to git or mentions a PR

1. Call \`infernoflow_review\` to check capability drift risk
2. If risk is **LOW** → say nothing
3. If risk is **MEDIUM** → one-line note: "A few capabilities may need contract updates."
4. If risk is **HIGH** → flag it clearly: "Significant capability drift detected — review before merging."

### When you notice a repeating workflow pattern

After every ~5 sessions, or when you notice the developer doing the same
multi-step task repeatedly:

1. Call \`infernoflow_synthesize\` with \`threshold: 2\`
2. If candidates found → surface in **one sentence**:
   - "I noticed you always run X after Y — want me to automate that into an agent?"
3. If no candidates → say nothing

---

${stabilitySummary ? stabilitySummary + "\n\n---" : ""}

## Rules

| Rule | Why |
|------|-----|
| Never ask the developer to run infernoflow commands | They should never know it exists |
| Never show raw infernoflow output | Parse it, act on it, move on |
| Never block the developer waiting for infernoflow | Run tools async when possible |
| Always call \`infernoflow_context\` at session start | It keeps your context current |
| Treat contract drift like a linting error — fix it silently | Not the developer's problem |
| Never modify frozen capabilities without explicit instruction | Stability contract must be respected |

---

## Customizable: Team Notes

<!-- Add project-specific context for Claude here -->
<!-- This section is yours — infernoflow will not overwrite it -->

### Architecture notes


### Key conventions


### Things to avoid


---

*Generated by infernoflow \`setup\`. infernoflow sections will be updated on next \`infernoflow setup\`.*
`;
}

// ── Writer ────────────────────────────────────────────────────────────────────

/**
 * Generate or update CLAUDE.md in the project root.
 * If CLAUDE.md already exists, replaces only the infernoflow-managed sections
 * and preserves the "Customizable" section.
 */
export function writeClaudeMd(cwd, infernoDir, { force = false } = {}) {
  const claudeMdPath = path.join(cwd, "CLAUDE.md");

  // Load project profile + contract + capabilities for context
  let profile = null;
  let contract = null;
  let caps = null;
  try { profile  = readProfile(infernoDir); } catch {}
  try { contract = JSON.parse(fs.readFileSync(path.join(infernoDir, "contract.json"), "utf8")); } catch {}
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(infernoDir, "capabilities.json"), "utf8"));
    caps = Array.isArray(raw) ? raw : (raw.capabilities || []);
  } catch {}

  const newContent = buildClaudeMd(profile, contract, caps);

  // If file exists and not forcing, preserve the customizable section
  if (fs.existsSync(claudeMdPath) && !force) {
    const existing = fs.readFileSync(claudeMdPath, "utf8");
    const customMarker = "## Customizable: Team Notes";
    const genMarker    = "*Generated by infernoflow";

    if (existing.includes(customMarker)) {
      // Extract what the developer wrote in the customizable section
      const customStart = existing.indexOf(customMarker);
      const customEnd   = existing.indexOf(genMarker, customStart);
      const customBlock = customEnd !== -1
        ? existing.slice(customStart, customEnd)
        : existing.slice(customStart);

      // Replace everything up to the custom block, keep their additions
      const beforeCustom = newContent.slice(0, newContent.indexOf(customMarker));
      const afterCustom  = newContent.slice(newContent.indexOf(genMarker));
      fs.writeFileSync(claudeMdPath, beforeCustom + customBlock + afterCustom, "utf8");
      return { path: claudeMdPath, action: "updated" };
    }
  }

  fs.writeFileSync(claudeMdPath, newContent, "utf8");
  return { path: claudeMdPath, action: fs.existsSync(claudeMdPath) ? "replaced" : "created" };
}

// ── CLI command ───────────────────────────────────────────────────────────────

export async function claudeMdCommand(args) {
  const cwd      = process.cwd();
  const force    = args.includes("--force") || args.includes("-f");
  const infernoDir = path.join(cwd, "inferno");

  if (!fs.existsSync(infernoDir)) {
    warn("inferno/ not found — run infernoflow init first");
    process.exit(1);
  }

  info("Generating CLAUDE.md...");
  const result = writeClaudeMd(cwd, infernoDir, { force });
  ok(`CLAUDE.md ${result.action} → ${result.path}`);
  console.log();
  done("Claude will now automatically call infernoflow tools — no developer input needed");
}
