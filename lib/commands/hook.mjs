/**
 * `infernoflow hook <event>` — entry points for AI-tool hooks (0.46.0).
 * Called by .claude/hooks/infernoflow-session.mjs; not meant to be run by hand.
 *
 *   session-start   print fresh project memory as session context (D6)
 *   session-end     leave a LOCAL resume point for "where were we" (D7)
 *
 * stdin: the hook payload JSON from Claude Code (transcript_path, reason, …).
 */
import * as fs   from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { appendEntry, readEntries, deleteEntry, ampPaths } from "../amp/io.mjs";
import { buildSessionContext, openAttempts, visibleEntries } from "../memoryView.mjs";
import { findProjectRoot } from "../projectRoot.mjs";

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
  try { process.stdout.write(buildSessionContext(cwd) + "\n"); } catch { /* never break session start */ }
}

function sessionEnd(args = []) {
  const cwd = projectDir();
  if (!fs.existsSync(path.join(cwd, ".ai-memory"))) return;
  // The hook passes payload fields as arguments (stdin also accepted).
  const flag = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };
  const payload = flag("--transcript") || flag("--reason")
    ? { transcript_path: flag("--transcript"), reason: flag("--reason") }
    : readStdinJson();
  const request = lastUserRequest(payload.transcript_path);
  const changed = gitStatus(cwd);
  if (!request && !changed.length) return;          // nothing happened — no noise
  const attempts = openAttempts(visibleEntries(cwd)).slice(-5);
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

export async function hookCommand(args) {
  const event = (args || [])[1];
  try {
    if (event === "session-start") return sessionStart();
    if (event === "session-end")   return sessionEnd(args);
  } catch { /* hooks must never fail the AI tool */ }
  if (!["session-start", "session-end"].includes(event)) {
    process.stderr.write("usage: infernoflow hook session-start|session-end   (called by AI-tool hooks)\n");
    process.exitCode = 1;
  }
}

// Exported for tests.
export { lastUserRequest as _lastUserRequest, ampPaths as _ampPaths };
