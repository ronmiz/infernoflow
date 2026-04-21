/**
 * detect-drift.mjs
 * Compares git-changed files to capability source maps and returns
 * a list of capabilities that may need contract updates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

/**
 * Get files changed since the last commit (staged + unstaged),
 * or optionally since the last N commits.
 */
export function getChangedFiles(cwd, opts = {}) {
  const { sinceCommits = 1, includeStagedOnly = false } = opts;
  const changed = new Set();

  try {
    // Staged + unstaged modifications vs HEAD
    const unstaged = execSync("git diff --name-only HEAD", {
      cwd, encoding: "utf8", timeout: 10_000,
    });
    for (const f of unstaged.split("\n").map(l => l.trim()).filter(Boolean)) {
      changed.add(f);
    }
  } catch {}

  try {
    // Files changed in the last N commits
    const committed = execSync(`git diff --name-only HEAD~${sinceCommits} HEAD`, {
      cwd, encoding: "utf8", timeout: 10_000,
    });
    for (const f of committed.split("\n").map(l => l.trim()).filter(Boolean)) {
      changed.add(f);
    }
  } catch {}

  try {
    // Untracked new files
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd, encoding: "utf8", timeout: 10_000,
    });
    for (const f of untracked.split("\n").map(l => l.trim()).filter(Boolean)) {
      changed.add(f);
    }
  } catch {}

  return Array.from(changed).sort();
}

/**
 * Load capability-map.json if it exists.
 * Format: { "src/search/": ["SearchItems"], "src/auth/": ["Login"] }
 */
export function loadCapabilityMap(infernoDir) {
  const mapPath = path.join(infernoDir, "capability-map.json");
  if (!fs.existsSync(mapPath)) return null;
  try { return JSON.parse(fs.readFileSync(mapPath, "utf8")); } catch { return null; }
}

/**
 * Load adoption_profile.json (has sourceFiles per capability from --adopt).
 */
export function loadAdoptionProfile(infernoDir) {
  const profilePath = path.join(infernoDir, "adoption_profile.json");
  if (!fs.existsSync(profilePath)) return null;
  try { return JSON.parse(fs.readFileSync(profilePath, "utf8")); } catch { return null; }
}

/**
 * Load capabilities.json to get all registered capabilities.
 */
export function loadCapabilities(infernoDir) {
  const capsPath = path.join(infernoDir, "capabilities.json");
  if (!fs.existsSync(capsPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(capsPath, "utf8"));
    return data.capabilities || [];
  } catch { return []; }
}

/**
 * Main: detect which capabilities are affected by changed files.
 *
 * Returns:
 * {
 *   changedFiles: string[],
 *   affectedCapabilities: { id, title, matchedFiles: string[], confidence: "high"|"medium"|"low" }[],
 *   unmappedFiles: string[],           // changed files with no capability match
 *   hasCapabilityMap: boolean,
 * }
 */
export function detectDrift(cwd, opts = {}) {
  const infernoDir = path.join(cwd, "inferno");
  const changedFiles = getChangedFiles(cwd, opts);

  if (!changedFiles.length) {
    return { changedFiles: [], affectedCapabilities: [], unmappedFiles: [], hasCapabilityMap: false };
  }

  const capMap = loadCapabilityMap(infernoDir);
  const profile = loadAdoptionProfile(infernoDir);
  const capabilities = loadCapabilities(infernoDir);

  const capHits = new Map(); // capId → { id, title, matchedFiles: Set }

  const addHit = (cap, file) => {
    if (!capHits.has(cap.id)) {
      capHits.set(cap.id, { id: cap.id, title: cap.title || cap.id, matchedFiles: new Set() });
    }
    capHits.get(cap.id).matchedFiles.add(file);
  };

  const mappedFiles = new Set();

  // ── Strategy 1: capability-map.json (explicit, highest confidence) ────────
  if (capMap) {
    for (const changedFile of changedFiles) {
      for (const [prefix, capIds] of Object.entries(capMap)) {
        if (changedFile.startsWith(prefix.replace(/\\/g, "/"))) {
          for (const capId of capIds) {
            const cap = capabilities.find(c => c.id === capId) || { id: capId, title: capId };
            addHit(cap, changedFile);
            mappedFiles.add(changedFile);
          }
        }
      }
    }
  }

  // ── Strategy 2: adoption_profile sourceFiles (from --adopt) ──────────────
  // The profile doesn't directly store sourceFiles per cap (that's in capabilities.json via adopt).
  // We use the capabilities sourceFiles stored during writeAdoptionBaseline.
  // We re-read the raw capabilities with sourceFiles from the capabilities stored in inferno/.
  const capsWithFiles = [];
  if (profile) {
    // Try to load a richer version from capabilities.json that includes sourceFiles
    const capsPath = path.join(infernoDir, "capabilities.json");
    try {
      const raw = JSON.parse(fs.readFileSync(capsPath, "utf8"));
      for (const c of raw.capabilities || []) {
        if (c.sourceFiles && c.sourceFiles.length > 0) capsWithFiles.push(c);
      }
    } catch {}
  }

  if (capsWithFiles.length > 0) {
    for (const cap of capsWithFiles) {
      for (const srcFile of cap.sourceFiles || []) {
        const normalized = srcFile.replace(/\\/g, "/");
        for (const changedFile of changedFiles) {
          const changedNorm = changedFile.replace(/\\/g, "/");
          if (changedNorm === normalized || changedNorm.startsWith(path.dirname(normalized) + "/")) {
            addHit(cap, changedFile);
            mappedFiles.add(changedFile);
          }
        }
      }
    }
  }

  // ── Strategy 3: filename heuristics (fallback) ────────────────────────────
  const HEURISTIC_KEYWORDS = [
    { keywords: ["search"], capId: "SearchItems" },
    { keywords: ["filter"], capId: "FilterItems" },
    { keywords: ["auth", "login", "logout", "signin", "signup"], capId: "Authentication" },
    { keywords: ["create", "add", "new"], capId: "CreateItem" },
    { keywords: ["update", "edit"], capId: "UpdateItem" },
    { keywords: ["delete", "remove"], capId: "DeleteItem" },
    { keywords: ["read", "list", "view"], capId: "ReadItems" },
    { keywords: ["due", "deadline", "date"], capId: "SetDueDate" },
    { keywords: ["priority"], capId: "SetPriority" },
    { keywords: ["complete", "done", "toggle"], capId: "ToggleComplete" },
  ];

  for (const changedFile of changedFiles) {
    if (mappedFiles.has(changedFile)) continue;
    const lower = changedFile.toLowerCase();
    for (const rule of HEURISTIC_KEYWORDS) {
      if (rule.keywords.some(kw => lower.includes(kw))) {
        const cap = capabilities.find(c => c.id === rule.capId) || { id: rule.capId, title: rule.capId };
        addHit(cap, changedFile);
        mappedFiles.add(changedFile);
        break;
      }
    }
  }

  const unmappedFiles = changedFiles.filter(f => !mappedFiles.has(f));

  // Score confidence
  const affectedCapabilities = Array.from(capHits.values()).map(hit => ({
    id: hit.id,
    title: hit.title,
    matchedFiles: Array.from(hit.matchedFiles),
    confidence: hit.matchedFiles.size >= 3 ? "high"
              : hit.matchedFiles.size >= 1 ? "medium"
              : "low",
  }));

  return {
    changedFiles,
    affectedCapabilities,
    unmappedFiles,
    hasCapabilityMap: !!capMap,
  };
}
