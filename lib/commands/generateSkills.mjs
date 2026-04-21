/**
 * infernoflow generate-skills
 *
 * Reads inferno/developer-profile.json and generates personalised skill files:
 *   - inferno/generated-skills/cursor-rules.md      → copy to .cursor/rules/infernoflow.md
 *   - inferno/generated-skills/quick-restore.md     → session startup skill
 *   - inferno/generated-skills/naming-guide.md      → detected naming conventions
 *   - inferno/generated-skills/feature-scaffold.md  → personal feature checklist
 *
 * Run: infernoflow generate-skills [--cursor] [--force]
 *   --cursor   Also copy generated rules to .cursor/rules/infernoflow.md
 *   --force    Overwrite existing generated files
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readProfile } from "../learning/profile.mjs";
import { header, ok, warn, done, nextSteps, cyan, yellow, bold, gray } from "../ui/output.mjs";

const SKILLS_DIR = path.join("inferno", "generated-skills");

function write(filePath, content, force) {
  if (fs.existsSync(filePath) && !force) {
    warn(`Already exists (use --force to overwrite): ${path.relative(process.cwd(), filePath)}`);
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  ok(`Generated: ${path.relative(process.cwd(), filePath)}`);
  return true;
}

function buildCursorRules(profile, contract) {
  const naming = profile.namingStyle !== "unknown" ? profile.namingStyle : "PascalCase";
  const verbs = profile.preferredVerbs.length > 0 ? profile.preferredVerbs.slice(0, 5).join(", ") : "Add, Update, Remove";
  const framework = profile.stack?.framework || "unknown";
  const clusters = profile.featureClusters.slice(0, 3);
  const sessionStyle = profile.sessionCount >= 20 ? "experienced" : profile.sessionCount >= 5 ? "intermediate" : "new";

  const clusterRules = clusters.map(cluster =>
    `- When touching [${cluster.slice(0, 3).join(", ")}], check whether related capabilities also need updating`
  ).join("\n");

  return `# infernoflow — Cursor Rules (auto-generated)
# Project: ${contract?.policyId || "unknown"} | Stack: ${framework}
# Regenerate with: infernoflow generate-skills --cursor

## Contract awareness
- This project uses infernoflow to track capability contracts
- After implementing any feature, always call \`infernoflow_run\` then \`infernoflow_apply\`
- Run \`infernoflow_check\` before every commit
- Current capabilities: [${(contract?.capabilities || []).join(", ")}]

## Naming conventions (detected from this developer's history)
- Capability IDs use **${naming}** (e.g. ${verbs.split(", ").slice(0, 2).map(v => v + "Item").join(", ")})
- Preferred action verbs: ${verbs}
- Match this style when suggesting new capability names

## Feature clusters (capabilities this developer adds together)
${clusterRules || "- No clusters detected yet — build more features to train this"}

## Session style (${sessionStyle})
${sessionStyle === "experienced"
  ? "- Skip basic explanations — this developer knows the codebase well\n- Be direct and minimal in responses"
  : "- Include brief context for non-obvious decisions\n- Explain infernoflow commands when used"}

## Workflow reminders
- Start sessions with: \`infernoflow context --show\`
- Use \`infernoflow_git_drift\` to check what's changed before starting work
- Use \`infernoflow_implement\` to get a structured coding prompt before writing code
- Changelog entries should be ${profile.changelogVerbosity === "detailed" ? "detailed (include context and impact)" : "brief (one line, action-focused)"}
`;
}

function buildQuickRestore(profile, contract) {
  const working = ""; // will be filled at runtime from context-state.json
  const framework = profile.stack?.framework || "unknown";
  const capabilities = (contract?.capabilities || []).slice(0, 6);

  return `# Quick Restore — ${contract?.policyId || "this project"}
# Paste this at the start of any new AI session to restore context instantly.
# Regenerate with: infernoflow generate-skills

## Project snapshot
- **Project:** ${contract?.policyId || "unknown"}
- **Stack:** ${framework} / ${profile.stack?.language || "unknown"} (${profile.stack?.projectType || "unknown"})
- **Capabilities:** ${capabilities.join(", ")}${(contract?.capabilities || []).length > 6 ? ` +${(contract?.capabilities || []).length - 6} more` : ""}

## How to start a session
1. Run: \`infernoflow context --show\`
2. Check \`inferno/CONTEXT.md\` for current intent
3. Run: \`infernoflow_git_drift\` to see what changed since last session
4. Pick up where you left off

## infernoflow tools available (in Cursor / VS Code Agent mode)
- \`infernoflow_run\` — generate a contract update prompt
- \`infernoflow_apply\` — apply a JSON response
- \`infernoflow_implement\` — get a structured coding prompt
- \`infernoflow_git_drift\` — see what capabilities may have drifted
- \`infernoflow_check\` — validate contract is in sync
- \`infernoflow_status\` — quick health check

## Definition of done (every feature branch)
- [ ] Code works as intended
- [ ] \`infernoflow_run\` → \`infernoflow_apply\` completed
- [ ] \`infernoflow_check\` passes
- [ ] Commit message references the capability changed
`;
}

function buildNamingGuide(profile) {
  const naming = profile.namingStyle !== "unknown" ? profile.namingStyle : "PascalCase";
  const verbs = profile.preferredVerbs.length > 0 ? profile.preferredVerbs : ["Create", "Read", "Update", "Delete", "Search"];

  const examples = verbs.slice(0, 5).map(v => {
    if (naming === "PascalCase") return `  - ${v}Item, ${v}Task, ${v}User`;
    if (naming === "camelCase")  return `  - ${v.toLowerCase()}Item, ${v.toLowerCase()}Task`;
    return `  - ${v.toLowerCase()}-item, ${v.toLowerCase()}-task`;
  }).join("\n");

  return `# Naming Guide — auto-generated from your capability history

## Detected style: ${naming}

### Your preferred action verbs
${verbs.map(v => `- **${v}**`).join("\n")}

### Examples matching your style
${examples}

### Rules
- All capability IDs in \`inferno/contract.json\` must follow this style
- New capabilities suggested by AI should match — reject any that don't
- If you rename a capability, update contract.json + capabilities.json + any scenarios

### When naming a new capability, ask:
1. Does it describe a single, discrete behavior? (If not, split it)
2. Does it start with one of your preferred verbs?
3. Is it in ${naming}?
4. Is it unique — not already in contract.json?
`;
}

function buildFeatureScaffold(profile, contract) {
  const clusters = profile.featureClusters.slice(0, 2);
  const topCluster = clusters[0] || [];
  const framework = profile.stack?.framework || "unknown";

  const clusterChecks = topCluster.slice(0, 4).map(id =>
    `- [ ] Does **${id}** need updating? (check inferno/capabilities.json)`
  ).join("\n");

  return `# Feature Scaffold — ${framework} project
# Use this checklist whenever starting a new feature.
# Regenerate with: infernoflow generate-skills

## Before you start
- [ ] Run \`infernoflow context --show\` to load current state
- [ ] Run \`infernoflow_git_drift\` to see any pending drift
- [ ] Set intent: \`infernoflow context --intent "what I'm building"\`

## Implementation checklist
- [ ] Create feature branch
- [ ] Implement the feature
- [ ] Write / update tests
- [ ] Verify it works end-to-end

## Capability cluster check
${clusterChecks || "- [ ] Review existing capabilities — do any need updating?"}

## Contract update (required before merge)
- [ ] Run \`infernoflow_run\` with a description of what changed
- [ ] Review the suggested JSON
- [ ] Run \`infernoflow_apply\` with the JSON
- [ ] Run \`infernoflow_check\` — must pass

## Commit message
- Reference the capability: "feat: add SearchItems endpoint (#42)"
- Update CHANGELOG.md if not auto-updated

## Done when
- [ ] Feature works
- [ ] \`infernoflow_check\` passes
- [ ] PR description mentions which capabilities changed
`;
}

export async function generateSkillsCommand(args) {
  const cwd = process.cwd();
  const force = args.includes("--force") || args.includes("-f");
  const installCursor = args.includes("--cursor");

  header("generate-skills");

  const infernoDir = path.join(cwd, "inferno");
  if (!fs.existsSync(infernoDir)) {
    console.error("  ✘ inferno/ not found — run: infernoflow init\n");
    process.exit(1);
  }

  const profile = readProfile(infernoDir);
  let contract = null;
  try { contract = JSON.parse(fs.readFileSync(path.join(infernoDir, "contract.json"), "utf8")); } catch {}

  const skillsDir = path.join(cwd, SKILLS_DIR);

  // Generate all four skill files
  write(path.join(skillsDir, "cursor-rules.md"),    buildCursorRules(profile, contract), force);
  write(path.join(skillsDir, "quick-restore.md"),   buildQuickRestore(profile, contract), force);
  write(path.join(skillsDir, "naming-guide.md"),    buildNamingGuide(profile), force);
  write(path.join(skillsDir, "feature-scaffold.md"), buildFeatureScaffold(profile, contract), force);

  // Optionally install cursor rules
  if (installCursor) {
    const rulesDir = path.join(cwd, ".cursor", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    const src = path.join(skillsDir, "cursor-rules.md");
    const dst = path.join(rulesDir, "infernoflow.md");
    fs.copyFileSync(src, dst);
    ok(`Installed to: .cursor/rules/infernoflow.md`);
  }

  const profileSummary = [
    profile.namingStyle !== "unknown" ? `naming: ${profile.namingStyle}` : null,
    profile.stack?.framework !== "unknown" ? `stack: ${profile.stack.framework}` : null,
    profile.sessionCount > 0 ? `sessions: ${profile.sessionCount}` : null,
  ].filter(Boolean).join(" · ");

  done(`Skills generated${profileSummary ? ` (${profileSummary})` : ""}`);

  nextSteps([
    `Review files in ${yellow(SKILLS_DIR + "/")}`,
    `Copy to Cursor: ${cyan("infernoflow generate-skills --cursor")}`,
    `Re-run any time to refresh after more sessions: ${cyan("infernoflow generate-skills --force")}`,
    profile.sessionCount < 5
      ? `Run more commands to improve personalisation (${profile.sessionCount} sessions so far)`
      : `Profile has ${profile.sessionCount} sessions — personalisation is well-trained`,
  ]);
}
