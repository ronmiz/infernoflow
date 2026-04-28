/**
 * infernoflow ask
 *
 * Query session memory by keyword, topic, or type.
 * The killer use case: before an AI agent tries something, it asks
 * "what have we already tried for this?" — avoiding repeated mistakes.
 *
 * Ranking:
 *   1. gotcha   (highest — these are landmines, must surface first)
 *   2. decision (architectural choices)
 *   3. attempt  (things tried, especially failed ones)
 *   4. preference
 *   5. theme
 *   6. note / error / handoff
 *
 * Usage:
 *   infernoflow ask "auth"                  Search all entries containing "auth"
 *   infernoflow ask "upload flow"           Multi-word fuzzy search
 *   infernoflow ask --type gotcha           All gotchas, no filter
 *   infernoflow ask "s3" --type attempt     Attempts mentioning S3
 *   infernoflow ask --recent                Last 10 entries regardless of type
 *   infernoflow ask "stripe" --json         Machine-readable results
 *
 * MCP use (agent-facing):
 *   infernoflow_ask({ query: "what did we try for payments?" })
 *   → Returns relevant entries so the agent avoids repeating failed work
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

const INFERNO_DIR   = "inferno";
const SESSIONS_FILE = path.join(INFERNO_DIR, "sessions.jsonl");

// ── Type priority (lower = shown first) ──────────────────────────────────────

const TYPE_PRIORITY = {
  gotcha:     0,
  decision:   1,
  attempt:    2,
  preference: 3,
  theme:      4,
  note:       5,
  error:      5,
  handoff:    6,
};

const TYPE_ICONS = {
  gotcha:     "⚠",
  decision:   "✓",
  attempt:    "↺",
  preference: "♦",
  theme:      "🎨",
  note:       "·",
  error:      "✗",
  handoff:    "→",
};

const TYPE_COLORS = {
  gotcha:     yellow,
  decision:   green,
  attempt:    cyan,
  preference: cyan,
  theme:      cyan,
  note:       gray,
  error:      red,
  handoff:    gray,
};

// ── Tokeniser for fuzzy matching ──────────────────────────────────────────────

function tokenise(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * Score an entry against a query.
 * Returns 0 if no match, >0 otherwise.
 * Higher score = more relevant.
 */
function scoreEntry(entry, queryTokens) {
  const text = [entry.summary || "", entry.type || ""].join(" ").toLowerCase();
  const entryTokens = tokenise(text);

  let score = 0;
  for (const qt of queryTokens) {
    // Exact substring match in summary (strongest signal)
    if ((entry.summary || "").toLowerCase().includes(qt)) {
      score += 3;
    }
    // Token in entry text
    if (entryTokens.includes(qt)) {
      score += 1;
    }
    // Partial prefix match (e.g. "auth" matches "authentication")
    if (entryTokens.some(et => et.startsWith(qt) || qt.startsWith(et))) {
      score += 0.5;
    }
  }

  return score;
}

// ── formatters ────────────────────────────────────────────────────────────────

function fmtRelDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function printEntry(entry, highlight) {
  const type     = entry.type || "note";
  const icon     = TYPE_ICONS[type]  || "·";
  const colorFn  = TYPE_COLORS[type] || gray;
  const result   = entry.result ? gray(` [${entry.result}]`) : "";
  const agent    = entry.agent ? gray(` — ${entry.agent}`) : "";
  const date     = gray(` (${fmtRelDate(entry.ts)})`);

  let summary = entry.summary || "";

  // Bold the matched keyword in the summary
  if (highlight) {
    for (const word of highlight) {
      const re = new RegExp(`(${word})`, "gi");
      summary = summary.replace(re, (m) => bold(m));
    }
  }

  console.log(`  ${colorFn(icon + " " + type.padEnd(11))}${result}${agent}${date}`);
  console.log(`    ${summary}`);
}

// ── load + search ─────────────────────────────────────────────────────────────

function loadSessions(cwd) {
  const p = path.join(cwd, SESSIONS_FILE);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8")
    .split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function search(entries, queryTokens, typeFilter, limit) {
  let candidates = entries;

  // Filter by type if specified
  if (typeFilter) {
    candidates = candidates.filter(e => (e.type || "note") === typeFilter);
  }

  // Score and filter
  let scored;
  if (queryTokens.length > 0) {
    scored = candidates
      .map(e => ({ entry: e, score: scoreEntry(e, queryTokens) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
        // Primary: score descending
        if (b.score !== a.score) return b.score - a.score;
        // Secondary: type priority
        const pa = TYPE_PRIORITY[a.entry.type] ?? 9;
        const pb = TYPE_PRIORITY[b.entry.type] ?? 9;
        if (pa !== pb) return pa - pb;
        // Tertiary: newest first
        return new Date(b.entry.ts || 0) - new Date(a.entry.ts || 0);
      });
  } else {
    // No query — sort by type priority then newest
    scored = candidates
      .map(e => ({ entry: e, score: 1 }))
      .sort((a, b) => {
        const pa = TYPE_PRIORITY[a.entry.type] ?? 9;
        const pb = TYPE_PRIORITY[b.entry.type] ?? 9;
        if (pa !== pb) return pa - pb;
        return new Date(b.entry.ts || 0) - new Date(a.entry.ts || 0);
      });
  }

  return scored.slice(0, limit || 20);
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function askCommand(rawArgs = []) {
  const args = rawArgs;

  // Parse flags
  const typeIdx   = args.indexOf("--type");
  const typeFilter = typeIdx !== -1 ? args[typeIdx + 1] : null;
  const limitIdx  = args.indexOf("--limit") !== -1 ? args.indexOf("--limit") : args.indexOf("-n");
  const limit     = limitIdx !== -1 ? parseInt(args[limitIdx + 1] || "20", 10) : 15;
  const jsonMode  = args.includes("--json");
  const recentMode = args.includes("--recent") || args.includes("-r");

  // Query = all non-flag args joined
  const queryWords = args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    if (i > 0 && args[i - 1].startsWith("--")) return false; // flag value
    return true;
  });
  const queryStr    = queryWords.join(" ").trim();
  const queryTokens = recentMode ? [] : tokenise(queryStr);

  const cwd      = process.cwd();
  const sessions = loadSessions(cwd);

  if (sessions.length === 0) {
    if (jsonMode) { console.log(JSON.stringify({ results: [], total: 0 })); return; }
    console.log(gray("\n  No session memory yet."));
    console.log(gray("  Run: infernoflow log \"<what happened>\" --type gotcha\n"));
    return;
  }

  // For --recent: just return last N entries without scoring
  const results = recentMode
    ? sessions.slice(-limit).reverse().map(e => ({ entry: e, score: 1 }))
    : search(sessions, queryTokens, typeFilter, limit);

  if (jsonMode) {
    console.log(JSON.stringify({
      query:   queryStr,
      type:    typeFilter,
      total:   sessions.length,
      matched: results.length,
      results: results.map(({ entry, score }) => ({ ...entry, relevanceScore: score })),
    }, null, 2));
    return;
  }

  // ── Header ──────────────────────────────────────────────────────────────
  console.log();
  if (queryStr) {
    console.log(`  ${bold("🔥 infernoflow ask")} ${cyan(`"${queryStr}"`)}${typeFilter ? gray(` [${typeFilter}]`) : ""}`);
  } else if (recentMode) {
    console.log(`  ${bold("🔥 infernoflow ask")} ${gray("— recent entries")}`);
  } else {
    console.log(`  ${bold("🔥 infernoflow ask")} ${gray("— all entries")}${typeFilter ? gray(` [${typeFilter}]`) : ""}`);
  }
  console.log(gray(`  ${"─".repeat(52)}`));

  if (results.length === 0) {
    console.log();
    if (queryStr) {
      console.log(gray(`  No entries found for "${queryStr}"`));
      if (typeFilter) console.log(gray(`  Try removing --type ${typeFilter} to widen the search`));
    } else {
      console.log(gray("  No entries found."));
    }
    console.log();
    return;
  }

  // ── Group by type for display ────────────────────────────────────────────
  const byType = new Map();
  for (const { entry, score } of results) {
    const t = entry.type || "note";
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push({ entry, score });
  }

  // Print in priority order
  const typeOrder = Object.keys(TYPE_PRIORITY).sort((a, b) => TYPE_PRIORITY[a] - TYPE_PRIORITY[b]);

  let printed = 0;
  for (const type of typeOrder) {
    const group = byType.get(type);
    if (!group?.length) continue;

    console.log();
    const colorFn = TYPE_COLORS[type] || gray;
    console.log(colorFn(`  ${TYPE_ICONS[type]} ${type.toUpperCase()}S (${group.length})`));
    console.log(gray("  " + "─".repeat(50)));

    for (const { entry } of group) {
      console.log();
      printEntry(entry, queryTokens);
      printed++;
    }
  }

  console.log();
  console.log(gray(`  ${printed} result${printed !== 1 ? "s" : ""} from ${sessions.length} total entries`));
  if (results.length === limit && sessions.length > limit) {
    console.log(gray(`  Use --limit N to see more`));
  }
  console.log();
}
