/**
 * Transcript harvest — turn the AI session that's already on disk into a
 * bookmark's captured context, with zero cooperation from the AI.
 *
 * The pain this solves: a session ends (often abruptly on a token wall) and the
 * whole back-and-forth — the analysis, the dead ends, the decisions — is lost.
 * But Claude Code already writes the entire session to disk as JSONL. This
 * module finds that transcript for the current project, distills the recent
 * turns into a markdown snapshot, and hands it back so `bookmark` can store it
 * as a Tier-2 detail. Deterministic; no model call.
 *
 * Supported today: Claude Code (~/.claude/projects/<encoded-cwd>/*.jsonl).
 * Other IDEs degrade gracefully — harvestSnapshot returns null and the caller
 * falls back to a marker-only bookmark.
 */

import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

/**
 * Claude Code encodes a project's absolute path into its transcript dir name by
 * replacing every non-alphanumeric character with "-". e.g.
 *   C:\Ron\projects\infernotest_01  →  C--Ron-projects-infernotest-01
 */
export function claudeProjectDir(cwd) {
  const enc = path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", enc);
}

/** Absolute path to the most-recently-modified transcript for this project, or null. */
export function findLatestTranscript(cwd) {
  const dir = claudeProjectDir(cwd);
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const files = names
    .filter(n => n.endsWith(".jsonl"))
    .map(n => { const p = path.join(dir, n); try { return { p, mtime: fs.statSync(p).mtimeMs }; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].p : null;
}

/** Pull plain text out of a Claude message `content` (string or block array). */
function extractText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(c => (typeof c === "string" ? c : c && c.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Distill the current session transcript into a markdown snapshot.
 *
 * @param {string} cwd
 * @param {object} [opts]
 * @param {number} [opts.maxMessages=40]  How many of the most recent turns to keep.
 * @param {number} [opts.maxCharsPerMsg=1500] Per-message truncation.
 * @returns {string|null}  Markdown snapshot, or null if no transcript / no text.
 */
export function harvestSnapshot(cwd, opts = {}) {
  const maxMessages   = Number.isInteger(opts.maxMessages)   ? opts.maxMessages   : 40;
  const maxCharsPerMsg = Number.isInteger(opts.maxCharsPerMsg) ? opts.maxCharsPerMsg : 1500;

  const tp = findLatestTranscript(cwd);
  if (!tp) return null;

  let lines;
  try { lines = fs.readFileSync(tp, "utf8").split("\n").filter(Boolean); } catch { return null; }

  const msgs = [];
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const role = o.type || (o.message && o.message.role);
    if (role !== "user" && role !== "assistant") continue;
    const text = extractText(o.message ? o.message.content : o.content);
    if (text && text.trim()) msgs.push({ role, text: text.trim() });
  }
  if (msgs.length === 0) return null;

  const recent = msgs.slice(-maxMessages);
  const out = [
    "# 🔖 Session snapshot",
    "",
    `_Auto-captured ${recent.length} recent turn${recent.length === 1 ? "" : "s"} from the Claude Code transcript._`,
    "",
  ];
  for (const m of recent) {
    const who = m.role === "user" ? "You" : "AI";
    const body = m.text.length > maxCharsPerMsg ? m.text.slice(0, maxCharsPerMsg).trimEnd() + " …" : m.text;
    out.push(`**${who}:** ${body}`, "");
  }
  return out.join("\n");
}
