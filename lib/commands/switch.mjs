/**
 * infernoflow switch
 *
 * Generates a handoff summary when switching between AI agents
 * (Copilot → Cursor → Claude → Windsurf → etc.).
 *
 * Captures the full session state — what was tried, what worked, what's
 * in progress, the design system, and the capability context — into a
 * single pasteable block so the next agent picks up exactly where you left off.
 *
 * Session boundary detection (same logic as `infernoflow recap`):
 *   - All entries since the last `handoff` entry, or the last 24h — whichever is more recent
 *   - Use --since to override (e.g. --since 48h, --since 2026-04-20)
 *   - Use --all to include every entry ever logged
 *
 * Also writes .ai-memory/handoff.md (the AMP-layout handoff file).
 *
 * Usage:
 *   infernoflow switch                  Generate handoff + write HANDOFF.md
 *   infernoflow switch --to cursor      Label the handoff for a specific agent
 *   infernoflow switch --copy           Copy to clipboard
 *   infernoflow switch --show           Print current HANDOFF.md
 *   infernoflow switch --json           Output as JSON
 *   infernoflow switch --since 48h      Include entries from the last 48 hours
 *   infernoflow switch --all            Include all entries ever logged
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import * as os   from "node:os";
import { execSync } from "node:child_process";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import { ampPaths, readEntries as ampRead, appendEntry as ampAppend } from "../amp/io.mjs";

const INFERNO_DIR       = "inferno";
// HANDOFF.md and sessions.jsonl live under AMP layout (.ai-memory/) when
// available, falling back to the legacy inferno/ path. Resolved at call time.
function ampLayout() { return ampPaths(process.cwd()); }
const HANDOFF_FILE      = path.join(INFERNO_DIR, "HANDOFF.md");      // legacy path used as fallback
const SESSIONS_FILE     = path.join(INFERNO_DIR, "sessions.jsonl");  // legacy path used as fallback
const STATE_FILE        = path.join(INFERNO_DIR, "context-state.json");
const CONTRACT_FILE     = path.join(INFERNO_DIR, "contract.json");
const THEME_FILE        = path.join(INFERNO_DIR, "theme.json");
const ADOPTION_FILE     = path.join(INFERNO_DIR, "adoption_profile.json");

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }
function readFile(f) { try { return fs.readFileSync(f, "utf8"); } catch { return null; } }

function fmtDate(iso) {
  if (!iso) return "unknown";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(ms) {
  if (ms < 0) return "unknown";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getAllEntries() {
  // Route through AMP layer so entries arrive normalized to internal shape
  // (summary, ts as number/ISO, agent, etc.) regardless of on-disk format.
  return ampRead(process.cwd());
}

/**
 * Find the start of the "current session":
 *   - The timestamp of the last `handoff` entry, OR 24h ago — whichever is more recent
 *   - --since overrides both; --all returns epoch (everything)
 */
function findSessionStart(allEntries, sinceArg, allFlag) {
  if (allFlag) return new Date(0);

  if (sinceArg) {
    const hoursMatch = sinceArg.match(/^(\d+)h$/i);
    const daysMatch  = sinceArg.match(/^(\d+)d$/i);
    if (hoursMatch) return new Date(Date.now() - parseInt(hoursMatch[1]) * 3600000);
    if (daysMatch)  return new Date(Date.now() - parseInt(daysMatch[1]) * 86400000);
    const parsed = new Date(sinceArg);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const dayAgo = new Date(Date.now() - 86400000);

  // Same handoff-boundary logic as recap: a very recent handoff (<5 min) is
  // assumed to be the END of the just-finished session, not the start of the
  // current one. Anchor on the prior handoff (or 24h) in that case.
  const handoffs = [];
  for (const e of allEntries) {
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

function copyToClipboard(text) {
  try {
    const p = process.platform;
    if (p === "win32") execSync("clip", { input: text });
    else if (p === "darwin") execSync("pbcopy", { input: text });
    else { try { execSync("xclip -selection clipboard", { input: text }); } catch { execSync("xsel --clipboard --input", { input: text }); } }
    return true;
  } catch { return false; }
}

/** Detect current IDE from environment */
function detectIde() {
  if (process.env.CURSOR_SESSION)       return "Cursor";
  if (process.env.COPILOT_SESSION)      return "GitHub Copilot";
  if (process.env.CLAUDE_CODE_SESSION)  return "Claude Code";
  if (process.env.WINDSURF_SESSION)     return "Windsurf";
  if (process.env.TERM_PROGRAM === "vscode") return "VS Code";
  // Check adoption profile
  const profile = readJSON(ADOPTION_FILE);
  if (profile?.ide)  return profile.ide;
  return null;
}

/** Get git diff stat since last commit */
function getGitDiffStat() {
  try {
    const stat = execSync("git diff --stat HEAD 2>/dev/null || git diff --cached --stat 2>/dev/null", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!stat) {
      // Try HEAD~1 if nothing staged/unstaged
      const logStat = execSync("git log --stat -1 --pretty= 2>/dev/null", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return logStat || null;
    }
    return stat;
  } catch {
    return null;
  }
}

/** Get most-edited files from git this session */
function getHotFiles(since) {
  try {
    const sinceArg = since && since.getTime() > 0
      ? `--after="${since.toISOString()}"`
      : "-10";
    const raw = execSync(
      `git log ${sinceArg} --name-only --pretty=format: 2>/dev/null`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (!raw) return [];
    const counts = {};
    for (const line of raw.split("\n")) {
      const f = line.trim();
      if (f) counts[f] = (counts[f] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([file, edits]) => ({ file, edits }));
  } catch {
    return [];
  }
}

/** Get recent git commits in this session */
function getGitCommits(since) {
  try {
    const sinceArg = since ? `--after="${since.toISOString()}"` : "-5";
    const log = execSync(`git log ${sinceArg} --pretty=format:"%h %s" 2>/dev/null`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return log ? log.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Detect "open threads" — attempts without resolution + entries containing TODO/WIP markers */
function findOpenThreads(sessions) {
  const open = [];

  // Failed/partial attempts that were never followed by a worked attempt
  const attempts = sessions.filter(e => e.type === "attempt" && (e.result === "failed" || e.result === "partial" || !e.result));
  for (const a of attempts) {
    const followedByWorked = sessions.find(e =>
      e.type === "attempt" &&
      e.result === "worked" &&
      new Date(e.ts) > new Date(a.ts) &&
      e.summary.toLowerCase().includes(a.summary.split(" ")[0].toLowerCase())
    );
    if (!followedByWorked) {
      open.push({ text: a.summary, ts: a.ts, kind: "unresolved-attempt" });
    }
  }

  // Any entry explicitly marked TODO/WIP in summary
  for (const e of sessions) {
    if (/\b(TODO|WIP|FIXME|BLOCKED|pending)\b/i.test(e.summary)) {
      if (!open.find(o => o.text === e.summary)) {
        open.push({ text: e.summary, ts: e.ts, kind: "flagged" });
      }
    }
  }

  return open.slice(0, 8); // cap at 8
}

function buildHandoff(toAgent, sinceArg, allFlag) {
  const state      = readJSON(STATE_FILE)    || {};
  const contract   = readJSON(CONTRACT_FILE) || {};
  const theme      = readJSON(THEME_FILE);
  const adoption   = readJSON(ADOPTION_FILE);
  const allEntries = getAllEntries();
  const sessionStart = findSessionStart(allEntries, sinceArg, allFlag);
  const sessions   = allEntries.filter(e => new Date(e.ts || 0) > sessionStart);
  const recentFallback = allEntries.slice(-5);
  const now        = new Date();
  const nowStr     = now.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const projectId  = contract.policyId || path.basename(process.cwd());
  const version    = contract.policyVersion || "?";
  const caps       = (contract.capabilities || []).slice(0, 20);
  const ide        = detectIde();

  // Session metadata
  const sessionDurationMs = sessionStart.getTime() > 0 ? now.getTime() - sessionStart.getTime() : -1;
  const sessionDuration   = fmtDuration(sessionDurationMs);
  // Short session ID: hex of sessionStart ms
  const sessionId = sessionStart.getTime() > 0
    ? sessionStart.getTime().toString(16).slice(-6).toUpperCase()
    : "ALL";

  // Git data
  const commits    = getGitCommits(sessionStart.getTime() > 0 ? sessionStart : null);
  const diffStat   = getGitDiffStat();
  const hotFiles   = getHotFiles(sessionStart.getTime() > 0 ? sessionStart : null);

  // Memory pool
  const pool      = sessions.length > 0 ? sessions : recentFallback;
  const gotchas   = pool.filter(e => e.type === "gotcha");
  const decisions = pool.filter(e => e.type === "decision");
  const attempts  = pool.filter(e => e.type === "attempt").filter(e => e.result === "failed" || e.result === "partial");
  const prefs     = pool.filter(e => e.type === "preference");
  const recent    = pool.slice(-8);
  const openThreads = findOpenThreads(pool);

  const sinceStr = sessionStart.getTime() === 0
    ? "all time"
    : sessionStart.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  // ── Sources header ─────────────────────────────────────────────────────────
  const sourcesList = ["sessions.jsonl"];
  if (state.working || state.intent) sourcesList.push("context-state.json");
  if (theme)    sourcesList.push("theme.json");
  if (contract.capabilities?.length) sourcesList.push("contract.json");
  if (adoption) sourcesList.push("adoption_profile.json");
  if (commits.length) sourcesList.push("git log");

  // Health score — same formula as recap and AMP (max 100), notes term skipped
  // because switch doesn't materialise a notes filter; max achievable here is 90.
  const _g = gotchas.length, _d = decisions.length, _a = attempts.length;
  let _score = Math.min(_g * 20, 40) + Math.min(_d * 15, 30) + Math.min(_a * 15, 20);
  _score = Math.min(_score, 100);
  const _grade = _score >= 80 ? "A" : _score >= 60 ? "B" : _score >= 40 ? "C" : _score >= 20 ? "D" : "F";

  const lines = [
    `# 🔥 infernoflow Handoff — ${projectId}`,
    `> Generated: ${nowStr}${toAgent ? ` | Handing off to: **${toAgent}**` : ""}`,
    `> Session: **#${sessionId}** · ${sessionDuration} · **${sessions.length} entries** · Health: **${_grade}** (${_score}/100)`,
    `> Sources: ${sourcesList.join(" · ")}${ide ? ` · IDE: ${ide}` : ""}`,
    "",
    "---",
    "",
  ];

  // Current working state — only emitted if the user actually set one
  if (state.working || state.intent) {
    lines.push("## 🎯 Working on", "");
    if (state.working) lines.push(`**${state.working}**  _(${fmtDate(state.workingUpdated)})_`);
    if (state.intent)  lines.push(`Intent: ${state.intent}  _(${fmtDate(state.intentUpdated)})_`);
    lines.push("");
  }

  // ── Gotchas first — STOP banner, numbered, file path inline ───────────────
  if (gotchas.length) {
    lines.push(`## ⚠️ STOP — Read These Before Doing Anything (${gotchas.length} gotcha${gotchas.length === 1 ? "" : "s"})`, "");
    gotchas.forEach((e, i) => {
      lines.push(`${i + 1}. **${e.summary}**`);
      const file = e.file || e.source;
      if (file && /[\\/.]/.test(file)) {
        const fileWithLine = e.line ? `${file}:${e.line}` : file;
        lines.push(`   → File: \`${fileWithLine}\``);
      }
    });
    lines.push("");
  }

  // ── Decisions in effect — numbered, "follow these" framing ──────────────
  if (decisions.length) {
    lines.push("## ✓ Decisions In Effect — Follow These", "");
    decisions.forEach((e, i) => {
      const result = e.result ? ` → **${e.result}**` : "";
      lines.push(`${i + 1}. ${e.summary}${result}`);
    });
    lines.push("");
  }

  // ── Failed attempts — numbered, "don't repeat" framing ───────────────────
  if (attempts.length) {
    lines.push("## ❌ Already Tried — Don't Repeat", "");
    attempts.forEach((e, i) => {
      const file = e.file || e.source;
      const fileTag = file && /[\\/.]/.test(file) ? ` (\`${file}\`)` : "";
      lines.push(`${i + 1}. ${e.summary}${fileTag}  _(${fmtDate(e.ts)})_`);
    });
    lines.push("");
  }

  // ── Hot files — auto-detected from git ────────────────────────────────────
  if (hotFiles.length) {
    lines.push("## 📁 Hot Files This Session", "");
    for (const { file, edits } of hotFiles) {
      lines.push(`- \`${file}\` — ${edits} edit${edits !== 1 ? "s" : ""}`);
    }
    lines.push("");
  }

  // ── Preferences ───────────────────────────────────────────────────────────
  if (prefs.length) {
    lines.push("## Developer preferences", "");
    for (const e of prefs) {
      lines.push(`- ${e.summary}`);
    }
    lines.push("");
  }

  // ── Git activity this session ──────────────────────────────────────────────
  if (commits.length || diffStat) {
    lines.push("## Git activity this session", "");
    if (commits.length) {
      lines.push("**Commits:**");
      for (const c of commits) lines.push(`- \`${c}\``);
      lines.push("");
    }
    if (diffStat) {
      lines.push("**Uncommitted changes:**");
      lines.push("```");
      lines.push(diffStat.split("\n").slice(0, 15).join("\n")); // cap at 15 lines
      lines.push("```");
      lines.push("");
    }
  }

  // ── Design system ─────────────────────────────────────────────────────────
  if (theme) {
    lines.push("## Design system", "");
    if (theme.fonts?.primary) lines.push(`- **Font:** ${theme.fonts.primary}${theme.fonts.mono ? ` · mono: ${theme.fonts.mono}` : ""}`);
    if (theme.colors?.mode)   lines.push(`- **Mode:** ${theme.colors.mode}`);
    if (theme.colors?.palette) {
      const pal = Object.entries(theme.colors.palette).map(([k,v]) => `${k}=${v}`).join("  ");
      lines.push(`- **Palette:** ${pal}`);
    }
    if (theme.cssVars && Object.keys(theme.cssVars).length) {
      const top = Object.entries(theme.cssVars).slice(0, 6).map(([k,v]) => `${k}: ${v}`).join("  |  ");
      lines.push(`- **CSS vars:** ${top}`);
    }
    if (theme.framework) lines.push(`- **Framework:** ${theme.framework}`);
    lines.push("", "> ⚠ Always match these exactly. Do not introduce new colors or fonts.", "");
  }

  // ── Capabilities ──────────────────────────────────────────────────────────
  if (caps.length) {
    lines.push("## Capability contract", "");
    lines.push(`Project: **${projectId}** v${version}`);
    lines.push(`Capabilities: ${caps.join(", ")}`);
    lines.push("");
  }



  lines.push("---");
  lines.push(`_Session #${sessionId} · ${sessionDuration} · Generated by infernoflow._`);

  return lines.join("\n");
}

export async function switchCommand(args) {
  const has      = (f) => args.includes(f);
  const flag     = (f) => { const i = args.indexOf(f); return i !== -1 && args[i+1] ? args[i+1] : null; };
  const showOnly = has("--show") || has("-s");
  const copyFlag = has("--copy") || has("-c");
  const jsonFlag = has("--json");
  const allFlag  = has("--all");
  const sinceArg = flag("--since");
  const toAgent  = flag("--to") || args.find(a => !a.startsWith("-") && !["switch"].includes(a)) || null;

  console.log("\n  " + bold("🔥 infernoflow — switch"));
  console.log("  " + "─".repeat(50) + "\n");

  // Accept either layout — .ai-memory/ (AMP) or inferno/ (legacy)
  const ampDir = path.join(process.cwd(), ".ai-memory");
  if (!fs.existsSync(INFERNO_DIR) && !fs.existsSync(ampDir)) {
    console.error(red("  ✘ not initialized — run: infernoflow init\n"));
    process.exit(1);
  }

  // ── Show existing handoff ─────────────────────────────────────────────────
  if (showOnly) {
    // Prefer the AMP-layout handoff (.ai-memory/handoff.md); fall back to
    // the legacy inferno/HANDOFF.md for older projects.
    const existing = readFile(ampLayout().handoff) || readFile(HANDOFF_FILE);
    if (!existing) {
      console.log(yellow("  ⚠ No handoff yet — run: infernoflow switch\n"));
      return;
    }
    console.log(existing);
    return;
  }

  const handoff = buildHandoff(toAgent, sinceArg, allFlag);

  if (jsonFlag) {
    const state      = readJSON(STATE_FILE)    || {};
    const contract   = readJSON(CONTRACT_FILE) || {};
    const theme      = readJSON(THEME_FILE);
    const adoption   = readJSON(ADOPTION_FILE);
    const allEntries = getAllEntries();
    const sessionStart = findSessionStart(allEntries, sinceArg, allFlag);
    const sessions   = allEntries.filter(e => new Date(e.ts || 0) > sessionStart);
    const commits    = getGitCommits(sessionStart.getTime() > 0 ? sessionStart : null);
    const ide        = detectIde();
    console.log(JSON.stringify({
      state,
      contract: { policyId: contract.policyId, policyVersion: contract.policyVersion, capabilities: contract.capabilities },
      theme,
      adoption,
      sessions,
      commits,
      ide,
      sessionStart: sessionStart.toISOString(),
      sessionId: sessionStart.getTime() > 0 ? sessionStart.getTime().toString(16).slice(-6).toUpperCase() : "ALL",
      sessionDuration: fmtDuration(sessionStart.getTime() > 0 ? Date.now() - sessionStart.getTime() : -1),
      generatedAt: new Date().toISOString(),
    }, null, 2));
    return;
  }

  // Write HANDOFF.md
  fs.writeFileSync(ampLayout().handoff, handoff, "utf8");
  console.log(green("  ✔ Written → " + path.relative(process.cwd(), ampLayout().handoff) + "\n"));

  // ── Rich summary printout — calculate BEFORE appending handoff entry ──────
  // (appending handoff first would make findSessionStart think the session just
  //  started, showing 0 entries for the session that just ended)
  const allEntriesNow  = getAllEntries();
  const sessionStartNow = findSessionStart(allEntriesNow, sinceArg, allFlag);
  const sessionEntries = allEntriesNow.filter(e => new Date(e.ts || 0) > sessionStartNow);
  const state          = readJSON(STATE_FILE)    || {};
  const theme          = readJSON(THEME_FILE);
  const contract       = readJSON(CONTRACT_FILE) || {};
  const commits        = getGitCommits(sessionStartNow.getTime() > 0 ? sessionStartNow : null);
  const hotFilesNow    = getHotFiles(sessionStartNow.getTime() > 0 ? sessionStartNow : null);
  const ide            = detectIde();
  const pool           = sessionEntries.length > 0 ? sessionEntries : allEntriesNow.slice(-5);
  const openThreads    = findOpenThreads(pool);
  const sessionDuration = fmtDuration(sessionStartNow.getTime() > 0 ? Date.now() - sessionStartNow.getTime() : -1);
  const sessionId      = sessionStartNow.getTime() > 0
    ? sessionStartNow.getTime().toString(16).slice(-6).toUpperCase()
    : "ALL";

  // Print rich summary
  console.log("  " + bold("Handoff ready"));
  console.log("  " + "─".repeat(50));
  console.log("  " + gray("Session #" + sessionId + " · " + sessionDuration));
  if (state.working) console.log("  Working on    " + cyan(state.working));
  if (state.intent)  console.log("  Intent        " + cyan(state.intent));
  console.log("  Memory        " + sessionEntries.length + " entries this session  (total: " + allEntriesNow.length + ")");
  if (openThreads.length) console.log("  Open threads  " + yellow(openThreads.length + " unresolved"));
  if (commits.length)    console.log("  Git commits   " + commits.length + " this session");
  if (hotFilesNow.length) {
    console.log("  Hot files     " + hotFilesNow.map(f => cyan(f.file)).join(", "));
  }
  console.log("  Capabilities  " + (contract.capabilities || []).length + " registered");
  if (theme?.fonts?.primary) console.log("  Font          " + theme.fonts.primary);
  if (theme?.colors?.mode)   console.log("  Color mode    " + theme.colors.mode);
  if (ide)           console.log("  IDE           " + ide);
  if (toAgent)       console.log("  Handing off → " + cyan(toAgent));
  console.log();

  const handoffRel = path.relative(process.cwd(), ampLayout().handoff) || ".ai-memory/handoff.md";
  if (copyFlag) {
    const ok = copyToClipboard(handoff);
    console.log(ok
      ? green("  ✔ Copied to clipboard — paste at the start of your next AI session")
      : yellow("  ⚠ Clipboard failed — open " + handoffRel + " manually")
    );
  } else {
    console.log("  " + bold("Ready to use:"));
    console.log("  " + cyan("1.") + " Open    " + cyan(handoffRel));
    console.log("  " + cyan("2.") + " Copy all");
    console.log("  " + cyan("3.") + " Paste at the start of your next AI session");
    console.log("  " + gray("  tip: use --copy to skip steps 1-2 automatically"));
  }
  console.log();

  // Append the handoff entry AFTER printing summary — so next run's session
  // boundary is set correctly (starts after this handoff)
  if (fs.existsSync(ampLayout().sessions)) {
    const entry = {
      ts:      new Date().toISOString(),
      agent:   "infernoflow",
      type:    "handoff",
      summary: toAgent ? `Handed off to ${toAgent}` : "Handoff generated",
    };
    // Route through AMP so the handoff entry lands in .ai-memory/sessions.jsonl in AMP shape
    ampAppend(process.cwd(), entry);
  }
}
