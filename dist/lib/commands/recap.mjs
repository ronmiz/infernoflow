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
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

const INFERNO_DIR   = "inferno";
const SESSIONS_FILE = path.join(INFERNO_DIR, "sessions.jsonl");
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
    if (!isNaN(parsed)) return parsed;
  }

  // Find last handoff entry
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === "handoff") {
      const ts = new Date(entries[i].ts || 0);
      const dayAgo = new Date(Date.now() - 86400000);
      // Use whichever is more recent
      return ts > dayAgo ? ts : dayAgo;
    }
  }

  // Default: last 24h
  return new Date(Date.now() - 86400000);
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
 * Score 0-100 based on what types were logged this session.
 * A "healthy" session has at least one gotcha or decision.
 */
function sessionHealth(entries) {
  const types = new Set(entries.map(e => e.type));
  let score = 0;
  const checks = [];

  if (entries.length > 0) {
    score += 20;
    checks.push({ ok: true, label: `${entries.length} entr${entries.length !== 1 ? "ies" : "y"} logged` });
  } else {
    checks.push({ ok: false, label: "nothing logged this session" });
  }

  if (types.has("gotcha")) {
    score += 35;
    checks.push({ ok: true, label: "gotchas captured" });
  } else {
    checks.push({ ok: false, label: "no gotchas (most valuable — log landmines!)" });
  }

  if (types.has("decision")) {
    score += 25;
    checks.push({ ok: true, label: "decisions recorded" });
  } else {
    checks.push({ ok: false, label: "no decisions recorded" });
  }

  if (types.has("attempt")) {
    score += 10;
    checks.push({ ok: true, label: "attempts tracked" });
  }

  if (types.has("preference")) {
    score += 10;
    checks.push({ ok: true, label: "preferences noted" });
  }

  return { score: Math.min(score, 100), checks };
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

  if (!fs.existsSync(path.join(cwd, INFERNO_DIR))) {
    if (!jsonMode) console.error(red("  ✘ inferno/ not found — run: infernoflow init\n"));
    process.exit(1);
  }

  // Load all sessions
  const allEntries = [];
  const sessPath = path.join(cwd, SESSIONS_FILE);
  if (fs.existsSync(sessPath)) {
    fs.readFileSync(sessPath, "utf8").split("\n").filter(Boolean).forEach(l => {
      try { allEntries.push(JSON.parse(l)); } catch {}
    });
  }

  // Find session start
  const sessionStart   = findSessionStart(allEntries, sinceArg);
  const sessionEntries = allEntries.filter(e => new Date(e.ts || 0) > sessionStart);

  // Git changes in this window
  const changedFiles    = gitChangedFiles(sessionStart);
  const unloggedTopics  = inferUnloggedTopics(changedFiles, sessionEntries);

  // Health score
  const { score, checks } = sessionHealth(sessionEntries);

  const contract = readJSON(path.join(cwd, CONTRACT_FILE));

  if (jsonMode) {
    console.log(JSON.stringify({
      sessionStart:   sessionStart.toISOString(),
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
  if (contract?.policyId) console.log(gray(`  Project: ${contract.policyId}`));
  const sinceStr = sessionStart.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  console.log(gray(`  Session since: ${sinceStr}`));
  console.log(SEP);

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

  // Nudge if health is low
  if (score < 60) {
    console.log();
    console.log(gray("  To improve: log at least one gotcha and one decision per session."));
    console.log(gray("  Gotchas are the highest-value entries — they prevent repeated mistakes."));
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
