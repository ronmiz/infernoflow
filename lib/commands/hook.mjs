/**
 * `infernoflow hook <event>` — entry points for AI-tool hooks (0.46.0).
 * Called by .claude/hooks/infernoflow-session.mjs; not meant to be run by hand.
 *
 *   session-start   print fresh project memory as session context (D6)
 *   session-end     leave a LOCAL resume point for "where were we" (D7)
 *   pre-commit      list memory about the staged files (git hook, 0.48.0; never blocks)
 *
 * stdin: the hook payload JSON from Claude Code (transcript_path, reason, …).
 */
import * as fs   from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { appendEntry, readEntries, deleteEntry, ampPaths, readConfig } from "../amp/io.mjs";
import { buildSessionContext, openAttempts, visibleEntries } from "../memoryView.mjs";
import { findProjectRoot } from "../projectRoot.mjs";
import { isMisfiredHookEntry } from "./curate.mjs";
import { humanText, saveSignal } from "../frustration.mjs";
import { maintenanceSettings, maintenanceSuggestions, runAutoMaintenance, shouldShowHint, markHintShown, renderMaintenanceSection } from "../maintenance.mjs";

const AUTO_TAG = "auto-handoff";
const KEEP_AUTO_HANDOFFS = 5;

function readStdinJson() {
  try {
    if (process.stdin.isTTY) return {};
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function projectDir() {
  const start = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try { return findProjectRoot(start); } catch { return start; }
}

/** Last real user message in a Claude Code transcript (JSONL), or null. */
function lastUserRequest(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== "string") return null;
  let text;
  try {
    const st = fs.statSync(transcriptPath);
    // Only the tail matters; cap the read for very long sessions.
    const fd = fs.openSync(transcriptPath, "r");
    const len = Math.min(st.size, 2_000_000);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch { return null; }
  const lines = text.split("\n").reverse();
  for (const line of lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "user" || !o.message) continue;
    const c = o.message.content;
    const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter(p => p && p.type === "text").map(p => p.text).join(" ") : "";
    const clean = String(t || "").replace(/\s+/g, " ").trim();
    if (clean && !clean.startsWith("<")) return clean.slice(0, 400);
  }
  return null;
}

// ── Unsaved decisions / findings (0.49.0) ───────────────────────────────────
// At session end, look through the transcript for prompts where the user asked
// to remember something, stated a decision or described a finding, and no
// memory write (amp_write / amp_bookmark / `infernoflow log|bookmark`) followed.
// They are kept on this machine only (.ai-memory/.hook-state.json, gitignored)
// and offered once at the next session start, for the agent to ask about.
const SAVE_TOOL = /(^|__)amp_(write|bookmark)$/;
const SAVE_CMD = /\binfernoflow\s+(log|bookmark)\b/;
const MAX_SUGGESTIONS = 3;
function readTail(file, max = 4_000_000) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  const len = Math.min(st.size, max);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, st.size - len);
  fs.closeSync(fd);
  return buf.toString("utf8");
}
export function unsavedSignals(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== "string") return [];
  let text; try { text = readTail(transcriptPath); } catch { return []; }
  let pending = [];
  for (const line of text.split("\n")) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const c = o && o.message && o.message.content;
    if (o.type === "user") {
      const raw = typeof c === "string" ? c : Array.isArray(c) ? c.filter(p => p && p.type === "text").map(p => p.text).join("\n") : "";
      const h = humanText(raw);
      const kind = h ? saveSignal(h) : null;
      if (kind) pending.push({ kind, text: h.length > 220 ? h.slice(0, 219) + "…" : h });
    } else if (o.type === "assistant" && Array.isArray(c)) {
      const saved = c.some(p => p && p.type === "tool_use" && (SAVE_TOOL.test(String(p.name || "")) ||
        (p.input && typeof p.input.command === "string" && SAVE_CMD.test(p.input.command))));
      if (saved) pending = [];          // the agent saved after these prompts
    }
  }
  return pending.slice(-MAX_SUGGESTIONS);
}
function hookStatePath(cwd) { return path.join(cwd, ".ai-memory", ".hook-state.json"); }
function readHookState(cwd) { try { return JSON.parse(fs.readFileSync(hookStatePath(cwd), "utf8")) || {}; } catch { return {}; } }
function writeHookState(cwd, patch) {
  try { fs.writeFileSync(hookStatePath(cwd), JSON.stringify({ ...readHookState(cwd), ...patch })); } catch { /* best effort */ }
}
/** Session-start section for the suggestions left by the last session end (shown once). */
function takeSuggestionsSection(cwd) {
  const st = readHookState(cwd);
  const s = st.saveSuggestions;
  if (!s || !Array.isArray(s.items) || !s.items.length) return "";
  writeHookState(cwd, { saveSuggestions: null });
  if (Date.now() - (Number(s.at) || 0) > 7 * 86400_000) return "";
  const label = { remember: "asked to remember", decision: "decision", discovery: "finding" };
  return [
    "## Possibly unsaved from the last session",
    "",
    "The user said these last session and nothing was saved to project memory after them:",
    "",
    ...s.items.map(i => `- ${label[i.kind] || i.kind}: "${String(i.text).replace(/"/g, "'")}"`),
    "",
    "_If one still holds and is worth keeping for the team, offer once to save it as one sentence in your own words (`amp_write`). Ask first; don't save quotes._",
  ].join("\n");
}

function gitStatus(root) {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 5000 })
      .split("\n").map(s => s.trimEnd()).filter(Boolean);
  } catch { return []; }
}

function sessionStart() {
  const cwd = projectDir();
  if (!fs.existsSync(path.join(cwd, ".ai-memory"))) return;
  readStdinJson(); // drain
  // Auto maintenance first (at most once a day), so the context shows the cleaned memory.
  let autoResult = null, settings = null;
  try { settings = maintenanceSettings(readConfig(cwd)); autoResult = runAutoMaintenance(cwd, { settings }); } catch { /* never break session start */ }
  let text = "";
  try { text = buildSessionContext(cwd); } catch { /* never break session start */ }
  // Maintenance hint: at most once a day, only when there's something to say.
  try {
    if (settings && settings.mode !== "off" && (autoResult || shouldShowHint(cwd))) {
      const section = renderMaintenanceSection(maintenanceSuggestions(cwd, { settings }), autoResult);
      if (section) { text += (text ? "\n\n" : "") + section; markHintShown(cwd); }
    }
  } catch { /* never break session start */ }
  try {
    const sug = takeSuggestionsSection(cwd);
    if (sug) text += (text ? "\n\n" : "") + sug;
  } catch { /* never break session start */ }
  if (text) process.stdout.write(text + "\n");
}

function sessionEnd(args = []) {
  const cwd = projectDir();
  if (!fs.existsSync(path.join(cwd, ".ai-memory"))) return;
  // The hook passes payload fields as arguments (stdin also accepted).
  const flag = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };
  const payload = flag("--transcript") || flag("--reason")
    ? { transcript_path: flag("--transcript"), reason: flag("--reason") }
    : readStdinJson();
  try {
    const items = unsavedSignals(payload.transcript_path);
    writeHookState(cwd, { saveSuggestions: items.length ? { at: Date.now(), items } : null });
  } catch { /* best effort */ }
  const request = lastUserRequest(payload.transcript_path);
  const changed = gitStatus(cwd);
  if (!request && !changed.length) return;          // nothing happened — no noise
  // Machine text the old prompt hooks logged as "frustration" (subagent
  // hand-backs, tool output) is not a dead end: don't copy it into the snapshot.
  const attempts = openAttempts(visibleEntries(cwd)).filter(e => !isMisfiredHookEntry(e)).slice(-5);
  const when = new Date().toISOString().slice(0, 16).replace("T", " ");
  const body = [
    `# Session ended — ${when}${payload.reason ? ` (${payload.reason})` : ""}`,
    "",
    request ? `**Last request:** ${request}` : null,
    changed.length ? `\n**Uncommitted changes (${changed.length}):**\n${changed.slice(0, 25).map(l => "- `" + l + "`").join("\n")}` : null,
    attempts.length ? `\n**Open dead ends:**\n${attempts.map(e => "- " + (e.summary || e.msg)).join("\n")}` : null,
  ].filter(Boolean).join("\n");
  appendEntry(cwd, {
    ts: new Date().toISOString(),
    type: "note",
    summary: `Session ended — ${when}`,
    tags: ["bookmark", AUTO_TAG],
    agent: "hook",
    source: "session-end",
    detail: body,
    detailLocal: true,   // body: gitignored local store
    localOnly: true,     // entry: gitignored sessions.jsonl only — never committed
  });
  // Keep only the newest few automatic resume points.
  const autos = readEntries(cwd).filter(e => Array.isArray(e.tags) && e.tags.includes(AUTO_TAG))
    .sort((a, b) => (Number(b.ts) || Date.parse(b.ts) || 0) - (Number(a.ts) || Date.parse(a.ts) || 0));
  for (const e of autos.slice(KEEP_AUTO_HANDOFFS)) { try { deleteEntry(cwd, e.id); } catch { /* best effort */ } }
}

// ── pre-commit (0.48.0) ─────────────────────────────────────────────────────
// Called from .git/hooks/pre-commit. Prints gotchas, failed attempts and
// decisions about the staged files to stderr, so whoever commits (a person or
// an AI agent running `git commit`) sees them before the mistake ships again.
// Always exits 0. Turn off with "preCommit": "off" in .ai-memory/amp.json.
const PRECOMMIT_TYPES = new Set(["gotcha", "attempt", "decision"]);
const PRECOMMIT_MAX = 6;
function preCommit() {
  const here = process.cwd();
  const git = (args) => execFileSync("git", args, { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 5000 });
  let top, staged;
  try {
    top = path.resolve(git(["rev-parse", "--show-toplevel"]).trim());
    staged = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]).split("\0").filter(Boolean);
  } catch { return; }
  if (!staged.length) return;
  const norm = (f) => String(f).replace(/\\/g, "/").replace(/^\.\//, "");
  // Group staged files by the project (.ai-memory folder) they belong to: the
  // memory may live at the top level or in a package of a monorepo.
  const rootOf = new Map();
  const projectFor = (abs) => {
    let d = path.dirname(abs);
    for (;;) {
      if (rootOf.has(d)) return rootOf.get(d);
      if (fs.existsSync(path.join(d, ".ai-memory"))) { rootOf.set(d, d); return d; }
      if (d === top || path.dirname(d) === d) { rootOf.set(d, null); return null; }
      d = path.dirname(d);
    }
  };
  const byProject = new Map();
  for (const f of staged) {
    const abs = path.join(top, f);
    const root = projectFor(abs);
    if (!root) continue;
    if (!byProject.has(root)) byProject.set(root, new Set());
    byProject.get(root).add(norm(path.relative(root, abs)));
  }
  const tsOf = (e) => Number(e.ts) || Date.parse(e.ts) || 0;
  const hits = [];
  for (const [root, files] of byProject) {
    let cfg = null; try { cfg = readConfig(root); } catch { /* defaults */ }
    if (cfg && cfg.config && cfg.config.preCommit === "off") continue;
    let entries = [];
    try { entries = visibleEntries(root); } catch { continue; }
    for (const e of entries) if (PRECOMMIT_TYPES.has(e.type) && e.file && files.has(norm(e.file))) hits.push(e);
  }
  if (!hits.length) return;
  hits.sort((a, b) => tsOf(b) - tsOf(a));
  const icon = { gotcha: "⚠", attempt: "✗", decision: "✓" };
  const one = (t, n) => { const x = String(t || "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
  const lines = ["", "infernoflow: project memory about files in this commit (check it still holds):"];
  for (const e of hits.slice(0, PRECOMMIT_MAX)) {
    const by = e.meta && e.meta.author ? ` — ${one(e.meta.author, 40)}` : "";
    lines.push(`  ${icon[e.type] || "·"} ${e.type} ${norm(e.file)}: ${one(e.summary || e.msg, 140)}${by}`);
  }
  if (hits.length > PRECOMMIT_MAX) lines.push(`  … ${hits.length - PRECOMMIT_MAX} more: infernoflow ask --file <file>`);
  lines.push("");
  process.stderr.write(lines.join("\n") + "\n");
}

export async function hookCommand(args) {
  const event = (args || [])[1];
  try {
    if (event === "session-start") return sessionStart();
    if (event === "session-end")   return sessionEnd(args);
    if (event === "pre-commit")    return preCommit();
  } catch { /* hooks must never fail the AI tool or the commit */ }
  if (!["session-start", "session-end", "pre-commit"].includes(event)) {
    process.stderr.write("usage: infernoflow hook session-start|session-end|pre-commit   (called by AI-tool and git hooks)\n");
    process.exitCode = 1;
  }
}

// Exported for tests.
export { lastUserRequest as _lastUserRequest, ampPaths as _ampPaths };
