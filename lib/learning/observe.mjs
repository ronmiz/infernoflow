/**
 * lib/learning/observe.mjs
 * Silent behavior recorder — called at the start of every CLI command.
 *
 * Records:
 *  - Which command was run (commandUsage counts)
 *  - When it was run (session detection)
 *  - New capabilities introduced via suggest/run (updates naming style + verbs + clusters)
 *
 * Never throws — all observation is best-effort so it never breaks the real command.
 */

import * as path from "node:path";
import {
  readProfile,
  writeProfile,
  recordCommandUse,
  detectNamingStyle,
  detectPreferredVerbs,
  recordCapabilityCluster,
} from "./profile.mjs";

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes = new session

/**
 * Call this at the very start of every command handler.
 *
 * @param {string} infernoDir  — path to the inferno/ directory
 * @param {string} command     — the CLI command name (e.g. "suggest", "run", "check")
 */
export function observeCommandStart(infernoDir, command) {
  try {
    const profile = readProfile(infernoDir);

    // Record command usage
    recordCommandUse(profile, command);

    // Detect new session (gap > 30 min since last command)
    const now = Date.now();
    const lastTs = profile._lastCommandTs || 0;
    if (now - lastTs > SESSION_GAP_MS) {
      profile.sessionCount = (profile.sessionCount || 0) + 1;
    }
    profile._lastCommandTs = now;

    writeProfile(infernoDir, profile);
  } catch {
    // Silent — never break the real command
  }
}

/**
 * Call this after a suggest/run/apply that added new capabilities.
 * Updates naming style, preferred verbs, and feature clusters in the profile.
 *
 * @param {string}   infernoDir      — path to inferno/
 * @param {string[]} newCapabilityIds — capability IDs that were just added
 */
export function observeCapabilitiesAdded(infernoDir, newCapabilityIds) {
  if (!newCapabilityIds || newCapabilityIds.length === 0) return;
  try {
    const profile = readProfile(infernoDir);

    // Update naming style (weighted: new observations vs existing preference)
    const detectedStyle = detectNamingStyle(newCapabilityIds);
    if (detectedStyle !== "unknown") {
      // If we have enough sessions to be confident, lock it in
      if (profile.sessionCount >= 3 || profile.namingStyle === "unknown") {
        profile.namingStyle = detectedStyle;
      }
    }

    // Update preferred verbs
    const newVerbs = detectPreferredVerbs(newCapabilityIds);
    if (newVerbs.length > 0) {
      const combined = [...new Set([...profile.preferredVerbs, ...newVerbs])];
      profile.preferredVerbs = combined.slice(0, 8); // keep top 8
    }

    // Record as a feature cluster if multiple capabilities were added together
    if (newCapabilityIds.length >= 2) {
      recordCapabilityCluster(profile, newCapabilityIds);
    }

    writeProfile(infernoDir, profile);
  } catch {
    // Silent
  }
}

/**
 * Record changelog verbosity from a changelog entry string.
 * Helps infernoflow learn whether this developer writes brief or detailed changelogs.
 */
export function observeChangelogEntry(infernoDir, entry) {
  if (!entry) return;
  try {
    const profile = readProfile(infernoDir);
    const wordCount = String(entry).trim().split(/\s+/).length;
    const verbosity = wordCount >= 15 ? "detailed" : "brief";

    // Use running average: weight new observation against history
    if (profile.changelogVerbosity === "unknown") {
      profile.changelogVerbosity = verbosity;
    } else if (profile.sessionCount >= 5) {
      // After enough sessions, trust the pattern
      profile.changelogVerbosity = verbosity;
    }

    writeProfile(infernoDir, profile);
  } catch {
    // Silent
  }
}
