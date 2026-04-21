/**
 * lib/learning/adapt.mjs
 * Uses developer-profile.json to personalise infernoflow prompts.
 *
 * Called by suggest/run before generating AI prompts so the AI
 * receives instructions that match how this developer actually works.
 */

import { readProfile, summarizeProfile } from "./profile.mjs";

/**
 * Build a personalisation block to inject into any AI prompt.
 * Returns an empty string if the profile doesn't have enough data yet.
 *
 * @param {string} infernoDir
 * @returns {string}
 */
export function buildPersonalisationBlock(infernoDir) {
  let profile;
  try { profile = readProfile(infernoDir); } catch { return ""; }

  const lines = [];

  // Only inject once there's real data (at least 1 session or seeded from adopt)
  const hasData =
    profile.namingStyle !== "unknown" ||
    profile.preferredVerbs.length > 0 ||
    profile.stack.framework !== "unknown";

  if (!hasData) return "";

  lines.push("## Developer profile (personalise your response to match these preferences)");

  if (profile.namingStyle !== "unknown") {
    lines.push(`- Capability naming style: **${profile.namingStyle}** — use this for all new capability IDs`);
  }

  if (profile.preferredVerbs.length > 0) {
    lines.push(`- Preferred action verbs: ${profile.preferredVerbs.slice(0, 5).join(", ")} — prefer these when naming new capabilities`);
  }

  if (profile.stack.framework !== "unknown") {
    lines.push(`- Stack: ${profile.stack.framework} / ${profile.stack.language} (${profile.stack.projectType})`);
  }

  if (profile.changelogVerbosity !== "unknown") {
    const hint = profile.changelogVerbosity === "brief"
      ? "Keep changelog entries short (one line, action-focused)"
      : "Write detailed changelog entries (include context and impact)";
    lines.push(`- Changelog style: ${hint}`);
  }

  if (profile.featureClusters.length > 0) {
    const topCluster = profile.featureClusters[0];
    if (topCluster.length >= 2) {
      lines.push(`- Common capability cluster: [${topCluster.slice(0, 4).join(", ")}] — if the task touches one of these, consider whether others need updating too`);
    }
  }

  if (profile.sessionCount >= 10) {
    lines.push(`- Experienced user (${profile.sessionCount} sessions) — skip basic explanations, be direct`);
  }

  return lines.join("\n");
}

/**
 * Inject personalisation into an existing prompt string.
 * Inserts the block just before the "## Instructions" section if present,
 * otherwise appends it near the end.
 *
 * @param {string} prompt
 * @param {string} infernoDir
 * @returns {string}
 */
export function personalisePrompt(prompt, infernoDir) {
  const block = buildPersonalisationBlock(infernoDir);
  if (!block) return prompt;

  // Insert before ## Instructions if that section exists
  if (prompt.includes("## Instructions")) {
    return prompt.replace("## Instructions", block + "\n\n## Instructions");
  }

  // Fallback: append before the closing JSON instructions
  if (prompt.includes("Respond with ONLY")) {
    return prompt.replace("Respond with ONLY", block + "\n\n---\nRespond with ONLY");
  }

  return prompt + "\n\n" + block;
}

/**
 * Return a short status line for display in infernoflow status / context.
 * e.g. "naming: PascalCase · verbs: Add, Update · stack: angular / ts · sessions: 12"
 */
export function profileStatusLine(infernoDir) {
  try {
    const profile = readProfile(infernoDir);
    return summarizeProfile(profile) || null;
  } catch {
    return null;
  }
}
