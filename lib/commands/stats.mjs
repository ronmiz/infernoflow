/**
 * infernoflow stats
 *
 * Value dashboard — answers "is infernoflow actually saving me time?"
 *
 * Shows:
 *   • Session memory  — total entries + breakdown by type
 *   • Context size    — estimated tokens injected per session start
 *   • Coverage        — % of capabilities that have code analysis
 *   • HTTP chains     — resolved end-to-end call chains
 *   • Design system   — what's captured in theme.json
 *   • Savings estimate— tokens saved by not re-discovering recorded entries
 *
 * Usage:
 *   infernoflow stats              Interactive dashboard
 *   infernoflow stats --json       Machine-readable output
 *   infernoflow stats --brief      One-line summary (for CI / scripts)
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import { ampPaths, readEntries as ampRead } from "../amp/io.mjs";

const INFERNO_DIR  = "inferno";
function sessionsPath() { return ampPaths(process.cwd()).sessions; }
const CONTEXT_FILE  = path.join(INFERNO_DIR, "CONTEXT.md");
const THEME_FILE    = path.join(INFERNO_DIR, "theme.json");
const SCAN_FILE     = path.join(INFERNO_DIR, "scan.json");
const CONTRACT_FILE = path.join(INFERNO_DIR, "contract.json");
const CAPS_FILE     = path.join(INFERNO_DIR, "capabilities.json");

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }

/**
 * Rough token estimator: ~1 token per 4 characters (GPT-style).
 * Conservative — actual savings are often higher with tool/system prompt overhead.
 */
function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

/**
 * Per-entry-type token savings heuristic.
 * Each captured entry avoids N tokens of back-and-forth rediscovery.
 *
 * Gotcha:    ~400 tokens (agent tries wrong thing, gets error, explains, retries)
 * Decision:  ~200 tokens (agent asks why, developer explains)
 * Attempt:   ~250 tokens (agent attempts failed approach, error, pivot)
 * Preference:~150 tokens (agent does it wrong, developer corrects)
 * Note:      ~100 tokens (minor context the agent would have to infer)
 * Theme:     ~300 tokens (agent uses wrong colors/fonts, developer corrects)
 */
const SAVINGS_PER_TYPE = {
  gotcha:     400,
  decision:   200,
  attempt:    250,
  preference: 150,
  note:       100,
  theme:      300,
  handoff:    500,  // full handoff = avoided a "catch me up" conversation
  error:      200,
};

function collectStats(cwd) {
  const stats = {
    ok: false,
    memory: {
      total: 0,
      byType: {},
      oldestEntry: null,
      newestEntry: null,
      sessionsTracked: 0,
    },
    context: {
      sizeBytes: 0,
      estimatedTokens: 0,
      hasIntent: false,
      hasWorking: false,
    },
    theme: {
      captured: false,
      fonts: 0,
      colors: 0,
      cssVars: 0,
      framework: null,
    },
    coverage: {
      total: 0,
      withAnalysis: 0,
      pct: 0,
    },
    chains: {
      total: 0,
      resolved: 0,
    },
    contract: {
      policyId: null,
      capabilities: 0,
      isLite: false,
    },
    savings: {
      estimatedTokens: 0,
      breakdown: {},
    },
  };

  // ── contract ──────────────────────────────────────────────────────────────
  const contract = readJSON(path.join(cwd, CONTRACT_FILE));
  if (contract) {
    stats.contract.policyId     = contract.policyId;
    stats.contract.capabilities = (contract.capabilities || []).length;
    stats.contract.isLite       = !!contract.lite;
    stats.ok = true;
  }

  // ── capabilities coverage ─────────────────────────────────────────────────
  const caps = readJSON(path.join(cwd, CAPS_FILE));
  if (caps) {
    const list = Array.isArray(caps) ? caps : (caps.capabilities || []);
    stats.coverage.total        = list.length;
    stats.coverage.withAnalysis = list.filter(c => c.codeAnalysis).length;
    stats.coverage.pct          = stats.coverage.total
      ? Math.round((stats.coverage.withAnalysis / stats.coverage.total) * 100)
      : 0;
  }

  // ── session memory ────────────────────────────────────────────────────────
  const sessPath = sessionsPath();
  if (fs.existsSync(sessPath)) {
    const entries = ampRead(process.cwd());

    stats.memory.total = entries.length;

    for (const e of entries) {
      const t = e.type || "note";
      stats.memory.byType[t] = (stats.memory.byType[t] || 0) + 1;

      // Savings
      const saved = SAVINGS_PER_TYPE[t] || 100;
      stats.savings.estimatedTokens += saved;
      stats.savings.breakdown[t] = (stats.savings.breakdown[t] || 0) + saved;
    }

    if (entries.length) {
      stats.memory.oldestEntry = entries[0].ts;
      stats.memory.newestEntry = entries[entries.length - 1].ts;
    }

    // Count unique sessions (group by day)
    const days = new Set(entries.map(e => {
      const t = e.ts;
      if (typeof t === "number") return new Date(t).toISOString().slice(0, 10);
      return (t || "").slice(0, 10);
    }));
    stats.memory.sessionsTracked = days.size;
  }

  // ── context size ──────────────────────────────────────────────────────────
  const ctxPath = path.join(cwd, CONTEXT_FILE);
  if (fs.existsSync(ctxPath)) {
    const ctxText = fs.readFileSync(ctxPath, "utf8");
    stats.context.sizeBytes       = Buffer.byteLength(ctxText, "utf8");
    stats.context.estimatedTokens = estimateTokens(ctxText);
    stats.context.hasIntent       = ctxText.includes("## Intent");
    stats.context.hasWorking      = ctxText.includes("## Working on");
  }

  // ── theme / design system ─────────────────────────────────────────────────
  const theme = readJSON(path.join(cwd, THEME_FILE));
  if (theme) {
    stats.theme.captured   = true;
    stats.theme.fonts      = Object.keys(theme.fonts || {}).filter(k => theme.fonts[k]).length;
    stats.theme.colors     = Object.keys(theme.colors?.palette || {}).length;
    stats.theme.cssVars    = Object.keys(theme.cssVars || {}).length;
    stats.theme.framework  = theme.framework || null;
  }

  // ── HTTP chains (from scan.json) ──────────────────────────────────────────
  const scan = readJSON(path.join(cwd, SCAN_FILE));
  if (scan?.httpChains) {
    const allSteps = Object.values(scan.httpChains).flat();
    stats.chains.total    = allSteps.length;
    stats.chains.resolved = allSteps.filter(s => s.resolved).length;
  }

  return stats;
}

// ── bar chart helper ──────────────────────────────────────────────────────────

function bar(value, max, width = 20) {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pctColor(pct) {
  if (pct >= 80) return green;
  if (pct >= 40) return yellow;
  return red;
}

// ── formatter ─────────────────────────────────────────────────────────────────

function fmtRelDate(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function fmtTokens(n) {
  if (n >= 1000) return `~${Math.round(n / 100) / 10}k`;
  return `~${n}`;
}

// ── print dashboard ───────────────────────────────────────────────────────────

function printDashboard(stats) {
  const SEP = gray("  " + "─".repeat(52));

  console.log();
  console.log("  " + bold("🔥 infernoflow stats"));
  if (stats.contract.policyId) {
    console.log(gray(`  Project: ${stats.contract.policyId}${stats.contract.isLite ? " (lite)" : ""}`));
  }
  console.log(SEP);

  // ── Session memory ──────────────────────────────────────────────────────
  console.log();
  console.log("  " + bold("Session memory") + gray("  (" + path.relative(process.cwd(), sessionsPath()) + ")"));
  console.log();

  const total = stats.memory.total;
  if (total === 0) {
    console.log(gray("  No entries yet — run: infernoflow log \"<what happened>\" --type gotcha"));
  } else {
    const typeOrder = ["gotcha", "decision", "attempt", "preference", "theme", "note", "handoff", "error"];
    const maxCount  = Math.max(...Object.values(stats.memory.byType));

    for (const type of typeOrder) {
      const count = stats.memory.byType[type] || 0;
      if (count === 0) continue;
      const b = bar(count, maxCount, 16);
      const label = type.padEnd(12);
      console.log(`  ${gray(label)} ${cyan(b)} ${count}`);
    }

    console.log();
    console.log(gray(`  Total entries:    `) + bold(total));
    console.log(gray(`  Sessions tracked: `) + stats.memory.sessionsTracked);
    if (stats.memory.newestEntry) {
      console.log(gray(`  Last entry:       `) + fmtRelDate(stats.memory.newestEntry));
    }
  }

  // ── Context injection ───────────────────────────────────────────────────
  console.log();
  console.log(SEP);
  console.log();
  console.log("  " + bold("Context injection") + gray("  (per session start)"));
  console.log();

  if (stats.context.sizeBytes === 0) {
    console.log(gray("  No CONTEXT.md yet — run: infernoflow context"));
  } else {
    console.log(gray(`  Size:   `) + `${Math.round(stats.context.sizeBytes / 1024 * 10) / 10} KB`);
    console.log(gray(`  Tokens: `) + bold(fmtTokens(stats.context.estimatedTokens)) + gray(" injected into every session"));
    if (stats.context.hasIntent)  console.log(gray(`  `) + green("✔") + gray(" Intent captured"));
    if (stats.context.hasWorking) console.log(gray(`  `) + green("✔") + gray(" Working state captured"));
  }

  // ── Capability coverage ─────────────────────────────────────────────────
  console.log();
  console.log(SEP);
  console.log();
  console.log("  " + bold("Capability coverage") + gray("  (code analysis via infernoflow scan)"));
  console.log();

  if (stats.coverage.total === 0) {
    console.log(gray("  No capabilities yet — run: infernoflow init"));
  } else {
    const colorFn = pctColor(stats.coverage.pct);
    const b = bar(stats.coverage.withAnalysis, stats.coverage.total, 24);
    console.log(`  ${colorFn(b)} ${bold(stats.coverage.pct + "%")} (${stats.coverage.withAnalysis}/${stats.coverage.total})`);

    if (stats.coverage.pct < 100) {
      const uncovered = stats.coverage.total - stats.coverage.withAnalysis;
      console.log(gray(`\n  ${uncovered} capabilities without code analysis`));
      console.log(gray(`  Run: infernoflow scan  to enrich them`));
    }
  }

  // ── HTTP chains ─────────────────────────────────────────────────────────
  if (stats.chains.total > 0) {
    console.log();
    console.log(SEP);
    console.log();
    console.log("  " + bold("HTTP call chains") + gray("  (end-to-end resolution)"));
    console.log();
    const resPct = Math.round((stats.chains.resolved / stats.chains.total) * 100);
    const colorFn = pctColor(resPct);
    const b = bar(stats.chains.resolved, stats.chains.total, 20);
    console.log(`  ${colorFn(b)} ${bold(resPct + "%")} resolved  (${stats.chains.resolved}/${stats.chains.total} call chains)`);
    if (stats.chains.resolved < stats.chains.total) {
      console.log(gray(`\n  Unresolved calls may be to external services or missing route files`));
    }
  }

  // ── Design system ───────────────────────────────────────────────────────
  console.log();
  console.log(SEP);
  console.log();
  console.log("  " + bold("Design system") + gray("  (inferno/theme.json)"));
  console.log();

  if (!stats.theme.captured) {
    console.log(gray("  Not captured yet — run: infernoflow theme"));
  } else {
    const checks = [];
    if (stats.theme.fonts)   checks.push(`${stats.theme.fonts} font${stats.theme.fonts !== 1 ? "s" : ""}`);
    if (stats.theme.colors)  checks.push(`${stats.theme.colors} colors`);
    if (stats.theme.cssVars) checks.push(`${stats.theme.cssVars} CSS vars`);
    if (stats.theme.framework) checks.push(`${stats.theme.framework}`);
    console.log(gray("  ") + green("✔") + "  " + checks.join("  ·  "));
    console.log(gray("  AI agents always use the correct fonts and colors for this project"));
  }

  // ── Estimated savings ───────────────────────────────────────────────────
  console.log();
  console.log(SEP);
  console.log();
  console.log("  " + bold("Estimated token savings") + gray("  (vs re-discovering from scratch)"));
  console.log();

  const saved = stats.savings.estimatedTokens;
  if (saved === 0) {
    console.log(gray("  No session entries yet — start logging to track savings"));
  } else {
    const sessions = Math.max(stats.memory.sessionsTracked, 1);
    const perSession = Math.round(saved / sessions);

    console.log(`  Total saved:      ` + bold(green(fmtTokens(saved) + " tokens")));
    console.log(`  Per session:      ` + bold(fmtTokens(perSession) + " tokens"));
    console.log();
    console.log(gray("  Breakdown:"));

    const typeOrder = ["gotcha", "handoff", "attempt", "decision", "theme", "preference", "note", "error"];
    for (const type of typeOrder) {
      const tokens = stats.savings.breakdown[type];
      if (!tokens) continue;
      const count = stats.memory.byType[type] || 0;
      console.log(gray(`    ${type.padEnd(12)} ${count}× × ${SAVINGS_PER_TYPE[type] || 100} = `) + cyan(fmtTokens(tokens)));
    }

    console.log();
    console.log(gray("  * Estimates based on typical back-and-forth cost per entry type."));
    console.log(gray("    Actual savings vary with model, project complexity, and session length."));
  }

  console.log();
  console.log(SEP);
  console.log();
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function statsCommand(args = []) {
  const jsonMode  = args.includes("--json");
  const briefMode = args.includes("--brief");

  const cwd = process.cwd();

  if (!fs.existsSync(path.join(cwd, INFERNO_DIR)) && !fs.existsSync(path.join(cwd, ".ai-memory"))) {
    console.error(red("  ✘ not initialized — run: infernoflow init\n"));
    process.exit(1);
  }

  const stats = collectStats(cwd);

  if (jsonMode) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  if (briefMode) {
    const parts = [];
    if (stats.memory.total)           parts.push(`${stats.memory.total} memory entries`);
    if (stats.context.estimatedTokens) parts.push(`${fmtTokens(stats.context.estimatedTokens)} tokens/session`);
    if (stats.coverage.total)          parts.push(`${stats.coverage.pct}% capability coverage`);
    if (stats.savings.estimatedTokens) parts.push(`${fmtTokens(stats.savings.estimatedTokens)} tokens saved`);
    console.log(parts.join("  ·  ") || "No data yet — run infernoflow init + infernoflow log");
    return;
  }

  printDashboard(stats);
}
