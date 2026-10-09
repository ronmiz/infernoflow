/**
 * detect-drift.mjs
 * Compares git-changed files to capability source maps and returns
 * a list of capabilities that may need contract updates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Get files changed since the last commit (staged + unstaged),
 * or optionally since the last N commits.
 *
 * 0.46.3: git runs without a shell, and a failure no longer looks like "no
 * changes" — no commits yet → every file counts; fewer than N commits →
 * compared with the start of history; a shallow clone → compared with the
 * oldest fetched commit. Not a repository → null (callers can tell it apart
 * from "no changes").
 */
export function getChangedFiles(cwd, opts = {}) {
  const { sinceCommits = 1 } = opts;
  const n = Number.isInteger(sinceCommits) && sinceCommits >= 1 ? sinceCommits : 1;
  const changed = new Set();
  const git = (args, input) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000, input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"], windowsHide: true });
    } catch { return null; }
  };
  const add = (out) => { for (const f of (out || "").split("\n").map(l => l.trim()).filter(Boolean)) changed.add(f); };

  if ((git(["rev-parse", "--is-inside-work-tree"]) || "").trim() !== "true") return null;
  if (git(["rev-parse", "--verify", "-q", "HEAD"]) === null) {
    add(git(["ls-files"]));                               // no commits yet
  } else {
    let base = `HEAD~${n}`;
    if (git(["rev-parse", "--verify", "-q", `HEAD~${n}^{commit}`]) === null) {
      base = (git(["rev-parse", "--is-shallow-repository"]) || "").trim() === "true"
        ? ((git(["rev-list", "--max-parents=0", "HEAD"]) || "").trim().split("\n")[0] || "").trim()   // shallow clone: oldest fetched commit
        : (git(["hash-object", "-t", "tree", "--stdin"], "") || "").trim();                              // fewer commits: start of history
    }
    add(git(["diff", "--name-only", "HEAD"]));            // staged + unstaged
    if (base) add(git(["diff", "--name-only", base, "HEAD"]));
  }
  add(git(["ls-files", "--others", "--exclude-standard"])); // untracked
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
  const found = getChangedFiles(cwd, opts);
  if (found === null) {
    return { changedFiles: [], affectedCapabilities: [], unmappedFiles: [], hasCapabilityMap: false, gitUnavailable: true };
  }
  const changedFiles = found;

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
