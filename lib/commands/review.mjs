/**
 * infernoflow review
 *
 * AI-powered capability impact review for staged (or recent) git changes.
 * Reads git diff, identifies which capabilities are affected, then asks
 * your configured AI provider to write a capability impact summary.
 *
 * Usage:
 *   infernoflow review              Review staged changes (git diff --staged)
 *   infernoflow review --unstaged   Review all working-tree changes
 *   infernoflow review --last       Review last commit (git diff HEAD~1)
 *   infernoflow review --dry-run    Print the AI prompt only — no API call
 *   infernoflow review --json       Machine-readable output
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ─── helpers ─────────────────────────────────────────────────────────────────

function runGit(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function loadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return null; }
}

/** Tokenise a string into lowercase words */
function tokenise(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_\-/.]+/)
    .filter(t => t.length > 2);
}

/** Return capability IDs mentioned in or matched by the diff text */
function findAffectedCaps(diff, capabilities) {
  const diffLower = diff.toLowerCase();
  const affected  = new Set();

  for (const cap of capabilities) {
    const tokens = [
      ...tokenise(cap.id   || ""),
      ...tokenise(cap.name || ""),
      ...(cap.tags || []).flatMap(tokenise),
    ];
    // Direct ID mention (e.g. "auth-login" appears in diff)
    if (diffLower.includes((cap.id || "").toLowerCase())) {
      affected.add(cap.id);
      continue;
    }
    // Token overlap — need ≥2 matching tokens to avoid false positives
    const matches = tokens.filter(t => t.length > 3 && diffLower.includes(t));
    if (matches.length >= 2) affected.add(cap.id);
  }

  return [...affected];
}

/** Trim diff to a reasonable size for the prompt */
function trimDiff(diff, maxChars = 8000) {
  if (diff.length <= maxChars) return diff;
  const half = Math.floor(maxChars / 2);
  return diff.slice(0, half) + "\n\n[… diff truncated …]\n\n" + diff.slice(-half);
}

// ─── prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(diff, affectedCaps, capabilities) {
  const capDetails = capabilities
    .filter(c => affectedCaps.includes(c.id))
    .map(c => `  • ${c.id}: ${c.name}${c.description ? " — " + c.description : ""}`)
    .join("\n");

  const capList = affectedCaps.length > 0
    ? `Affected capabilities detected:\n${capDetails}`
    : "No specific capabilities were matched — review the entire contract.";

  return `You are a senior software architect reviewing a code change for capability drift.

${capList}

Git diff:
\`\`\`diff
${trimDiff(diff)}
\`\`\`

Write a concise capability impact summary covering:
1. Which capabilities are changed, added, or removed
2. Whether the contract (capabilities.json) needs updating
3. Any risks or side-effects (breaking changes, auth/security concerns, API contract violations)
4. Recommended follow-up actions (one sentence each)

Keep the tone professional and brief. Use bullet points only where genuinely helpful.
Do NOT repeat the diff back.`;
}

// ─── reporters ────────────────────────────────────────────────────────────────

function printReport(affectedCaps, summary, capabilities, source) {
  console.log();
  console.log(bold(cyan("  ✦ Capability Impact Review")));
  console.log(gray(`  Source: ${source}`));
  console.log();

  if (affectedCaps.length === 0) {
    console.log(yellow("  No capabilities directly matched — reviewing full diff."));
  } else {
    console.log(bold("  Affected capabilities:"));
    for (const id of affectedCaps) {
      const cap = capabilities.find(c => c.id === id);
      console.log(`    ${green("▸")} ${id}${cap ? gray(" — " + cap.name) : ""}`);
    }
  }

  console.log();
  console.log(bold("  AI Impact Summary"));
  console.log(gray("  ─────────────────────────────────────────────────────────────"));
  // Indent each line
  for (const line of summary.split("\n")) {
    console.log("  " + line);
  }
  console.log();
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function reviewCommand(rawArgs) {
  const args      = rawArgs || [];
  const dryRun    = args.includes("--dry-run");
  const jsonMode  = args.includes("--json");
  const unstaged  = args.includes("--unstaged");
  const lastCommit = args.includes("--last");

  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  // Load capabilities
  const capsPath = path.join(infernoDir, "capabilities.json");
  if (!fs.existsSync(capsPath)) {
    console.error(red("✗ inferno/capabilities.json not found — run `infernoflow init` first."));
    process.exit(1);
  }
  const capabilities = loadJson(capsPath);
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    console.log(yellow("No capabilities found — nothing to review."));
    process.exit(0);
  }

  // Get diff
  let diffCmd, diffSource;
  if (lastCommit) {
    diffCmd    = "git diff HEAD~1";
    diffSource = "last commit (HEAD~1)";
  } else if (unstaged) {
    diffCmd    = "git diff";
    diffSource = "unstaged changes";
  } else {
    diffCmd    = "git diff --staged";
    diffSource = "staged changes";
  }

  let diff = runGit(diffCmd, cwd);

  // Fallback: if staged is empty, try unstaged
  if (!diff && !lastCommit && !unstaged) {
    diff       = runGit("git diff", cwd);
    diffSource = "unstaged changes (no staged changes found)";
  }

  if (!diff) {
    console.log(yellow("No changes found to review."));
    console.log(gray("  Tip: stage some files first (`git add -p`) or use --last / --unstaged"));
    process.exit(0);
  }

  // Identify affected capabilities
  const affectedCaps = findAffectedCaps(diff, capabilities);

  // Build prompt
  const prompt = buildPrompt(diff, affectedCaps, capabilities);

  if (dryRun) {
    console.log(gray("── Prompt (--dry-run) ────────────────────────────────────────────────"));
    console.log(prompt);
    process.exit(0);
  }

  // Call AI
  if (!jsonMode) process.stdout.write(gray("  Calling AI provider…"));

  let aiResult = null;
  try {
    const { callAI } = await import("../ai/providerRouter.mjs");
    aiResult = await callAI(prompt, { cwd, maxTokens: 600 });
  } catch (e) {
    // provider router import failure is non-fatal — we degrade gracefully
  }

  if (!jsonMode) process.stdout.write("\r" + " ".repeat(30) + "\r");

  if (!aiResult) {
    console.log();
    console.log(yellow("  ⚠  No AI provider available."));
    console.log(gray("  Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY,"));
    console.log(gray("  or run Ollama locally. See `infernoflow doctor` for details."));
    console.log();
    console.log(bold("  Affected capabilities (unanswered):"));
    for (const id of affectedCaps) console.log(`    ▸ ${id}`);
    console.log();
    process.exit(0);
  }

  const summary = aiResult.text || "(empty response)";

  if (jsonMode) {
    console.log(JSON.stringify({
      source: diffSource,
      provider: aiResult.provider,
      model: aiResult.model,
      affectedCapabilities: affectedCaps,
      summary,
    }, null, 2));
  } else {
    printReport(affectedCaps, summary, capabilities, diffSource);
    console.log(gray(`  Provider: ${aiResult.provider}  Model: ${aiResult.model}`));
    console.log();
  }
}
