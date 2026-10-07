/**
 * infernoflow recap
 *
 * End-of-session summary. Answers "what did infernoflow capture today?"
 * and "what git changes might be worth logging?"
 *
 * The feedback loop that makes the habit stick:
 *   - You see what was captured this session
 *   - You see what git changes happened but weren't logged
 *   - You get a session health score
 *   - You get one-line nudges to log what's missing
 *
 * "Session" = entries since the last `handoff` entry, or the last 24h,
 *              whichever is more recent. Use --since to override.
 *
 * Usage:
 *   infernoflow recap                   Full session summary
 *   infernoflow recap --since 48h       Look back 48 hours
 *   infernoflow recap --since 2026-04-20  Since a specific date
 *   infernoflow recap --json            Machine-readable output
 *   infernoflow recap --brief           One-line health score only
 *   infernoflow recap --mark-reviewed   Mark shown "new from git" entries reviewed even without a terminal
 */

import { describeStore } from "../amp/io.mjs";
import * as fs   from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import { ampPaths, readEntries as ampRead } from "../amp/io.mjs";
import { unreviewedFromTeammates, markReviewed, formatEntryLine, safeId, reviewBaseline } from "../memoryView.mjs";

const INFERNO_DIR   = "inferno";
// (sessionsPath helper removed in v0.44.1 — recap reads via ampRead which
//  merges legacy sessions.jsonl + global.jsonl + branches/<branch>.jsonl.)
const CONTRACT_FILE = path.join(INFERNO_DIR, "contract.json");

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }

// ── Session boundary detection ────────────────────────────────────────────────

/**
 * Find the start of the "current session":
 *   - The timestamp of the last `handoff` entry (switching to a new agent = new session)
 *   - OR 24 hours ago — whichever is more recent
 *   - --since flag overrides both
 */
function findSessionStart(entries, sinceArg) {
  if (sinceArg) {
    // e.g. "48h", "7d", "2026-04-20"
    const hoursMatch = sinceArg.match(/^(\d+)h$/i);
    const daysMatch  = sinceArg.match(/^(\d+)d$/i);
    if (hoursMatch) return new Date(Date.now() - parseInt(hoursMatch[1]) * 3600000);
    if (daysMatch)  return new Date(Date.now() - parseInt(daysMatch[1]) * 86400000);
    const parsed = new Date(sinceArg);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const dayAgo = new Date(Date.now() - 86400000);

  // Collect handoffs chronologically. A handoff marks a session boundary.
  // If the latest handoff is brand-new (<5 min old) the user almost certainly
  // just ran `infernoflow switch` and now wants a recap of the session that
  // just ended — so anchor on the PRIOR handoff instead of the fresh one.
  // Otherwise the latest handoff marks the *start* of the current session
  // (user ran switch hours ago, has been working since).
  const handoffs = [];
  for (const e of entries) {
    if (e.type === "handoff") {
      const ts = new Date(e.ts || 0);
      if (!isNaN(ts.getTime())) handoffs.push(ts);
    }
  }
  if (handoffs.length === 0) return dayAgo;

  const FRESH_HANDOFF_MS = 5 * 60 * 1000;
  const last = handoffs[handoffs.length - 1];
  const lastIsFresh = Date.now() - last.getTime() < FRESH_HANDOFF_MS;

  if (lastIsFresh) {
    if (handoffs.length >= 2) {
      const prev = handoffs[handoffs.length - 2];
      return prev > dayAgo ? prev : dayAgo;
    }
    return dayAgo;
  }
  return last > dayAgo ? last : dayAgo;
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function gitChangedFiles(since) {
  const cwd = process.cwd();
  const run = (cmd) => {
    try { return execSync(cmd, { cwd, encoding: "utf8", timeout: 5000, stdio: ["pipe","pipe","pipe"] }).trim(); }
    catch { return ""; }
  };

  const sinceIso = since.toISOString().slice(0, 19);
  const staged    = run("git diff --cached --name-only");
  const unstaged  = run("git diff --name-only");
  const committed = run(`git log --since="${sinceIso}" --name-only --pretty=format:""`);

  const all = new Set([
    ...staged.split("\n"),
    ...unstaged.split("\n"),
    ...committed.split("\n"),
  ].map(f => f.trim()).filter(Boolean));

  return [...all];
}

/**
 * From a list of changed files, infer what topics might need logging.
 * Returns: [{ topic, files, suggestedType }]
 */
function inferUnloggedTopics(changedFiles, sessionEntries) {
  const TOPIC_RULES = [
    { keywords: ["auth", "login", "logout", "session", "jwt", "token", "password"], topic: "authentication" },
    { keywords: ["stripe", "payment", "checkout", "billing", "subscription"],       topic: "payments" },
    { keywords: ["upload", "file", "s3", "storage", "bucket", "cdn"],               topic: "file handling" },
    { keywords: ["email", "sendgrid", "ses", "smtp", "nodemailer", "twilio"],        topic: "notifications" },
    { keywords: ["db", "database", "prisma", "mongoose", "postgres", "mysql", "migration"], topic: "database" },
    { keywords: ["deploy", "docker", "ci", "workflow", "action", "kubernetes"],     topic: "deployment" },
    { keywords: ["cache", "redis", "memcache"],                                     topic: "caching" },
    { keywords: ["test", "spec", "jest", "vitest", "cypress", "playwright"],        topic: "testing" },
    { keywords: ["config", "env", ".env", "environment", "secret"],                 topic: "configuration" },
    { keywords: ["api", "route", "endpoint", "controller", "handler"],              topic: "API routes" },
    { keywords: ["ui", "component", "style", "css", "tailwind", "theme"],           topic: "UI/styles" },
  ];

  // Build set of topics already mentioned in session entries
  const loggedText = sessionEntries.map(e => (e.summary || "").toLowerCase()).join(" ");

  const candidates = [];
  const seen = new Set();

  for (const rule of TOPIC_RULES) {
    if (seen.has(rule.topic)) continue;

    const matchingFiles = changedFiles.filter(f =>
      rule.keywords.some(kw => f.toLowerCase().includes(kw))
    );
    if (!matchingFiles.length) continue;

    // Check if session already has entries about this topic
    const alreadyLogged = rule.keywords.some(kw => loggedText.includes(kw));
    if (alreadyLogged) continue;

    seen.add(rule.topic);
    candidates.push({
      topic:         rule.topic,
      files:         matchingFiles.slice(0, 3),
      suggestedType: "gotcha", // prompt for the most valuable type
    });
  }

  return candidates;
}

// ── Session health score ──────────────────────────────────────────────────────

/**
 * D15 (0.46.0): score the session against what actually HAPPENED, not
 * against an ideal quota. A read-only investigation (no code changes, no
 * failures) is a healthy session even with nothing logged; what costs points
 * is work that would be lost — changed code whose topics weren't logged, or
 * frustration signals with no distilled lesson.
 *
 * @param {object[]} entries        entries logged this session
 * @param {string[]} changedFiles   files changed this session (git)
 * @param {object[]} unloggedTopics topics changed but not logged
 */
function sessionHealth(entries, changedFiles = [], unloggedTopics = []) {
  const checks = [];
  const types = new Set(entries.map(e => e.type));
  const rawFrustration = entries.filter(e => e.source === "hook" && /^User frustration:/.test(e.summary || ""));
  const distilledAttempts = entries.filter(e => e.type === "attempt" && e.source !== "hook");
  let score = 100;

  if (!changedFiles.length && !rawFrustration.length) {
    checks.push({ ok: true, label: entries.length
      ? `${entries.length} entr${entries.length !== 1 ? "ies" : "y"} logged`
      : "no code changes or failures this session — nothing needed logging" });
  } else {
    if (changedFiles.length) {
      if (unloggedTopics.length) {
        score -= Math.min(45, 15 * unloggedTopics.length);
        checks.push({ ok: false, label: `${unloggedTopics.length} changed topic${unloggedTopics.length !== 1 ? "s" : ""} not logged` });
      } else {
        checks.push({ ok: true, label: "changed areas are covered by memory" });
      }
      if (!entries.length) {
        score -= 25;
        checks.push({ ok: false, label: `${changedFiles.length} file${changedFiles.length !== 1 ? "s" : ""} changed but nothing logged` });
      }
    }
    if (rawFrustration.length && !distilledAttempts.length) {
      score -= 20;
      checks.push({ ok: false, label: "frustration signals with no distilled dead end (log what was tried and why it failed)" });
    }
  }
  if (types.has("gotcha"))   checks.push({ ok: true, label: "gotchas captured" });
  if (types.has("decision")) checks.push({ ok: true, label: "decisions recorded" });
  if (distilledAttempts.length) checks.push({ ok: true, label: "dead ends recorded" });

  return { score: Math.max(0, Math.min(score, 100)), checks };
}

// ── formatters ────────────────────────────────────────────────────────────────

function fmtRelDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const TYPE_ICONS = { gotcha:"⚠", decision:"✓", attempt:"↺", preference:"♦", theme:"◈", note:"·", error:"✗", handoff:"→" };
const TYPE_COLORS = { gotcha: yellow, decision: green, attempt: cyan, preference: cyan, theme: cyan, note: gray, error: red, handoff: gray };

function printEntry(e) {
  const colorFn = TYPE_COLORS[e.type] || gray;
  const icon    = TYPE_ICONS[e.type] || "·";
  const result  = e.result ? gray(` [${e.result}]`) : "";
  const date    = gray(` (${fmtRelDate(e.ts)})`);
  console.log(`  ${colorFn(icon + " " + (e.type || "note").padEnd(11))}${result}${date}`);
  console.log(`    ${e.summary}`);
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function recapCommand(rawArgs = []) {
  const args       = rawArgs;
  const jsonMode   = args.includes("--json");
  const briefMode  = args.includes("--brief");
  const sinceIdx   = args.indexOf("--since");
  const sinceArg   = sinceIdx !== -1 ? args[sinceIdx + 1] : null;

  const cwd = process.cwd();

  if (!fs.existsSync(path.join(cwd, INFERNO_DIR)) && !fs.existsSync(path.join(cwd, ".ai-memory"))) {
    if (!jsonMode) console.error(red("  ✘ not initialized — run: infernoflow init\n"));
    process.exit(1);
  }

  // Load all sessions via AMP layer — translates AMP shape (msg, Unix ms ts)
  // back to internal shape (summary, ISO/numeric ts) used downstream.
  const allEntries = ampRead(cwd);

  // Find session start
  const sessionStart   = findSessionStart(allEntries, sinceArg);
  const sessionEntries = allEntries.filter(e => new Date(e.ts || 0) > sessionStart);

  // Git changes in this window
  const changedFiles    = gitChangedFiles(sessionStart);
  const unloggedTopics  = inferUnloggedTopics(changedFiles, sessionEntries);

  // Health score
  const { score, checks } = sessionHealth(sessionEntries, changedFiles, unloggedTopics);

  const contract = readJSON(path.join(cwd, CONTRACT_FILE));

  // R3.7: shared entries other people added that this machine hasn't reviewed.
  let fromTeammates = [];
  try { fromTeammates = unreviewedFromTeammates(cwd); } catch { /* best effort */ }

  if (jsonMode) {
    console.log(JSON.stringify({
      sessionStart:   sessionStart.toISOString(),
      fromTeammates:      fromTeammates.slice(0, 15),
      fromTeammatesCount: fromTeammates.length,
      entries:        sessionEntries,
      changedFiles,
      unloggedTopics,
      health:         { score, checks },
    }, null, 2));
    return;
  }

  if (briefMode) {
    const grade = score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D";
    const colorFn = score >= 60 ? green : score >= 40 ? yellow : red;
    console.log(colorFn(`Session health: ${grade} (${score}/100)`) + gray(` — ${sessionEntries.length} entries logged`));
    if (unloggedTopics.length) {
      console.log(yellow(`  ${unloggedTopics.length} topic${unloggedTopics.length !== 1 ? "s" : ""} changed but not logged: `) + unloggedTopics.map(t => t.topic).join(", "));
    }
    return;
  }

  // ── Full dashboard ─────────────────────────────────────────────────────────
  const SEP = gray("  " + "─".repeat(52));

  console.log();
  console.log("  " + bold("🔥 infernoflow recap"));
  console.log("  " + gray(describeStore(cwd)));
  if (contract?.policyId) console.log(gray(`  Project: ${contract.policyId}`));
  const sinceStr = sessionStart.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  console.log(gray(`  Session since: ${sinceStr}`));
  console.log(SEP);

  // ── New from git (R3.7) ───────────────────────────────────────────────────
  if (fromTeammates.length) {
    const shown = fromTeammates.slice(0, 15);
    console.log();
    console.log("  " + bold(`New from git (${fromTeammates.length})`) + gray("  — not written on this machine; your AI sees these too"));
    console.log();
    for (const e of shown) {
      console.log("  " + formatEntryLine(e, { projectRoot: ampPaths(cwd).projectRoot, showAuthor: true }).replace(/^- /, "") + gray(`  ${safeId(e.id)}`));
    }
    if (fromTeammates.length > shown.length) console.log(gray(`  …and ${fromTeammates.length - shown.length} more — run recap again to see them`));
    console.log();
    console.log(gray("  The author shown is what each entry claims. Wrong or suspicious? ") + cyan("infernoflow resolve <id>") + gray(" removes it from AI context."));
    // Only a person marks entries reviewed: a terminal, or an explicit flag.
    // (An AI tool or agent runs recap with piped output.)
    if (process.stdout.isTTY || args.includes("--mark-reviewed")) {
      markReviewed(cwd, shown);   // only what was shown
      console.log(gray("  Marked as reviewed on this machine."));
    } else {
      console.log(gray("  Not marked as reviewed (not a terminal) — run recap yourself, or add --mark-reviewed."));
    }
    console.log(SEP);
  }
  const baseline = reviewBaseline(cwd);
  if (baseline && baseline.count) {
    console.log(gray(`  Review tracking started ${baseline.at.slice(0, 10)}; ${baseline.count} entries that existed then were accepted without review.`));
  }

  // ── This session's entries ────────────────────────────────────────────────
  console.log();
  console.log("  " + bold("Captured this session"));
  console.log();

  if (sessionEntries.length === 0) {
    console.log(gray("  Nothing logged yet this session."));
  } else {
    // Group by type, priority order
    const typeOrder = ["gotcha", "decision", "attempt", "preference", "theme", "note", "error"];
    const byType    = new Map();
    for (const e of sessionEntries) {
      const t = e.type || "note";
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(e);
    }
    for (const t of typeOrder) {
      const group = byType.get(t);
      if (!group?.length) continue;
      for (const e of group) { console.log(); printEntry(e); }
    }
  }

  // ── Unlogged changes ──────────────────────────────────────────────────────
  if (unloggedTopics.length > 0) {
    console.log();
    console.log(SEP);
    console.log();
    console.log("  " + bold("Changed but not logged") + gray("  (git diff since session start)"));
    console.log();

    for (const { topic, files } of unloggedTopics) {
      console.log(yellow(`  ? ${topic}`));
      for (const f of files) console.log(gray(`      ${f}`));
    }

    console.log();
    console.log(gray("  Any gotchas or decisions from these areas worth capturing?"));
    console.log(gray("  Run: ") + cyan(`infernoflow log "<what happened>" --type gotcha`));
  } else if (changedFiles.length > 0) {
    console.log();
    console.log(SEP);
    console.log();
    console.log(green("  ✔ ") + gray(`${changedFiles.length} changed files — all topics appear to be logged`));
  }

  // ── Session health score ──────────────────────────────────────────────────
  console.log();
  console.log(SEP);
  console.log();
  console.log("  " + bold("Session health"));
  console.log();

  const grade   = score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D";
  const colorFn = score >= 60 ? green : score >= 40 ? yellow : red;
  console.log(`  ${colorFn(bold(`${grade}`))} ${colorFn(`${score}/100`)}`);
  console.log();

  for (const { ok, label } of checks) {
    const icon = ok ? green("  ✔") : yellow("  ·");
    console.log(`${icon}  ${ok ? label : gray(label)}`);
  }

  // Actionable improvement tips
  {
    const gotchaCount   = sessionEntries.filter(e => e.type === "gotcha").length;
    const decisionCount = sessionEntries.filter(e => e.type === "decision").length;
    const tips = [];

    if (gotchaCount === 0) {
      tips.push(cyan("infernoflow log \"...\" --type gotcha") + gray("  — adds 35 pts"));
    } else if (gotchaCount < 3 && score < 80) {
      tips.push(gray(`  ${3 - gotchaCount} more gotcha(s) would push you higher`));
    }
    if (decisionCount === 0) {
      tips.push(cyan("infernoflow log \"...\" --type decision") + gray("  — adds 25 pts"));
    }
    if (score >= 60 && score < 80) {
      tips.push(gray("  Almost B! One more entry gets you there."));
    }
    if (score >= 80) {
      tips.push(green("  Great session — your handoff will be excellent."));
    }

    if (tips.length) {
      console.log();
      console.log(gray("  How to improve:"));
      for (const t of tips) console.log("  " + t);
    }
  }

  // ── Next session tip ──────────────────────────────────────────────────────
  if (sessionEntries.length > 0 || unloggedTopics.length > 0) {
    console.log();
    console.log(SEP);
    console.log();
    console.log(gray("  Before your next session:"));
    console.log(gray("  ") + cyan("infernoflow switch") + gray(" — generate a handoff summary for the next AI agent"));
    console.log(gray("  ") + cyan("infernoflow ask --recent") + gray(" — review what's in memory before starting"));
  }

  console.log();
}
