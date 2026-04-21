/**
 * lib/learning/profile.mjs
 * Reads and writes inferno/developer-profile.json.
 *
 * The developer profile is built up over time by observing how a
 * developer uses infernoflow — naming conventions, session patterns,
 * feature clusters, etc. It is the foundation for personalized
 * suggestions and auto-generated skills.
 *
 * Schema:
 * {
 *   schemaVersion: 1,
 *   createdAt: ISO string,
 *   updatedAt: ISO string,
 *   sessionCount: number,
 *
 *   // Naming style detected from capability IDs used
 *   namingStyle: "PascalCase" | "camelCase" | "kebab-case" | "unknown",
 *   preferredVerbs: string[],          // e.g. ["Add", "Update", "Remove"]
 *
 *   // Commands the developer uses most
 *   commandUsage: { [command]: number },
 *
 *   // Capability clusters — groups of capabilities added together
 *   featureClusters: string[][],
 *
 *   // Session behavior
 *   avgSessionLength: number,          // minutes (estimated from command gaps)
 *   commitFrequency: "high"|"medium"|"low"|"unknown",
 *   changelogVerbosity: "detailed"|"brief"|"unknown",
 *
 *   // Project signals (from --adopt)
 *   stack: {
 *     language: string,
 *     framework: string,
 *     projectType: string,
 *   },
 * }
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const PROFILE_SCHEMA_VERSION = 1;

export function profilePath(infernoDir) {
  return path.join(infernoDir, "developer-profile.json");
}

/** Return a blank profile with all defaults. */
export function blankProfile() {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    sessionCount: 0,
    namingStyle: "unknown",
    preferredVerbs: [],
    commandUsage: {},
    featureClusters: [],
    avgSessionLength: 0,
    commitFrequency: "unknown",
    changelogVerbosity: "unknown",
    stack: {
      language: "unknown",
      framework: "unknown",
      projectType: "unknown",
    },
  };
}

/** Read the profile, returning a blank one if it doesn't exist yet. */
export function readProfile(infernoDir) {
  const filePath = profilePath(infernoDir);
  if (!fs.existsSync(filePath)) return blankProfile();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    // Migrate older schemas by merging with blank defaults
    return { ...blankProfile(), ...raw };
  } catch {
    return blankProfile();
  }
}

/** Write the profile back to disk. */
export function writeProfile(infernoDir, profile) {
  profile.updatedAt = new Date().toISOString();
  profile.schemaVersion = PROFILE_SCHEMA_VERSION;
  fs.mkdirSync(infernoDir, { recursive: true });
  fs.writeFileSync(profilePath(infernoDir), JSON.stringify(profile, null, 2) + "\n", "utf8");
}

/**
 * Record a command use. Call this every time a CLI command runs.
 * Returns the updated profile (does NOT write — call writeProfile to persist).
 */
export function recordCommandUse(profile, command) {
  if (!profile.commandUsage) profile.commandUsage = {};
  profile.commandUsage[command] = (profile.commandUsage[command] || 0) + 1;
  return profile;
}

/**
 * Detect naming style from a list of capability IDs.
 * "PascalCase"  → CreateItem, SearchResults
 * "camelCase"   → createItem, searchResults
 * "kebab-case"  → create-item, search-results
 */
export function detectNamingStyle(capabilityIds) {
  if (!capabilityIds || capabilityIds.length === 0) return "unknown";
  let pascal = 0, camel = 0, kebab = 0;
  for (const id of capabilityIds) {
    if (/^[A-Z][a-z]/.test(id)) pascal++;
    else if (/^[a-z].*[A-Z]/.test(id)) camel++;
    else if (id.includes("-")) kebab++;
  }
  const max = Math.max(pascal, camel, kebab);
  if (max === 0) return "unknown";
  if (pascal === max) return "PascalCase";
  if (camel === max) return "camelCase";
  return "kebab-case";
}

/**
 * Extract the most common verb prefixes from capability IDs.
 * e.g. ["CreateItem", "CreateTask", "UpdateItem"] → ["Create", "Update"]
 */
export function detectPreferredVerbs(capabilityIds) {
  const verbCounts = {};
  const verbPattern = /^(Create|Add|Update|Edit|Delete|Remove|Get|Read|List|Fetch|Search|Filter|Toggle|Set|Clear|Send|Upload|Download|Export|Import|Generate|Sync|Validate|Check|Run|Start|Stop|Enable|Disable|Show|Hide)/;
  for (const id of capabilityIds || []) {
    const m = id.match(verbPattern);
    if (m) verbCounts[m[1]] = (verbCounts[m[1]] || 0) + 1;
  }
  return Object.entries(verbCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([verb]) => verb);
}

/**
 * Seed a profile from adoption signals (run once during `infernoflow init --adopt`).
 * This gives the profile an immediate starting point without needing any sessions.
 */
export function seedProfileFromAdoption(infernoDir, signals, capabilities) {
  const profile = readProfile(infernoDir);

  // Stack
  if (signals?.developmentProfile) {
    profile.stack = {
      language: signals.developmentProfile.language || "unknown",
      framework: signals.developmentProfile.framework || "unknown",
      projectType: signals.developmentProfile.projectType || "unknown",
    };
  }

  // Naming style and verbs from detected capability IDs
  const capIds = (capabilities || []).map(c => c.id);
  if (capIds.length > 0) {
    profile.namingStyle = detectNamingStyle(capIds);
    profile.preferredVerbs = detectPreferredVerbs(capIds);
  }

  // Initial feature cluster from capabilities found together
  if (capIds.length > 1) {
    profile.featureClusters = [capIds];
  }

  writeProfile(infernoDir, profile);
  return profile;
}

/**
 * Add a new capability cluster observation.
 * Merges with existing clusters if there's significant overlap (>50%).
 */
export function recordCapabilityCluster(profile, capabilityIds) {
  if (!capabilityIds || capabilityIds.length < 2) return profile;
  if (!profile.featureClusters) profile.featureClusters = [];

  // Check if this cluster significantly overlaps an existing one
  for (let i = 0; i < profile.featureClusters.length; i++) {
    const existing = new Set(profile.featureClusters[i]);
    const newIds = new Set(capabilityIds);
    const intersection = [...newIds].filter(id => existing.has(id));
    const overlapRatio = intersection.length / Math.min(existing.size, newIds.size);
    if (overlapRatio > 0.5) {
      // Merge: add any new IDs to the existing cluster
      const merged = Array.from(new Set([...existing, ...newIds]));
      profile.featureClusters[i] = merged;
      return profile;
    }
  }

  // New cluster
  profile.featureClusters.push([...capabilityIds]);
  return profile;
}

/** Human-readable summary of the profile for display in status/context. */
export function summarizeProfile(profile) {
  if (!profile || profile.sessionCount === 0 && profile.namingStyle === "unknown") {
    return null; // Not enough data yet
  }
  const lines = [];
  if (profile.namingStyle !== "unknown") lines.push(`naming: ${profile.namingStyle}`);
  if (profile.preferredVerbs.length > 0) lines.push(`verbs: ${profile.preferredVerbs.slice(0, 3).join(", ")}`);
  if (profile.stack.framework !== "unknown") lines.push(`stack: ${profile.stack.framework} (${profile.stack.language})`);
  if (profile.sessionCount > 0) lines.push(`sessions: ${profile.sessionCount}`);
  return lines.join(" · ");
}
