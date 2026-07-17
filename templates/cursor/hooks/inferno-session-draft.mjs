#!/usr/bin/env node
/**
 * Cursor hook: capture agent output for infernoflow.
 *
 * Two jobs in one:
 *   1. Always append agent text to inferno/CONTEXT.draft.md (existing behaviour)
 *   2. When infernoflow is waiting (inferno/agent-prompt.md exists),
 *      extract the JSON block from the agent reply and write it to
 *      inferno/agent-response.json so infernoflow picks it up automatically.
 *
 * Trigger in .cursor/hooks.json:
 *   afterAgentResponse → { text }
 *   stop              → { status, loop_count, ... }  (--agent-stop flag)
 *
 * Never fail closed: errors go to stderr; stdout is {} for Cursor.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

/** Keep in sync with templates/scripts/inferno-promote-draft.mjs */
const DRAFT_HEADER = `# CONTEXT draft (gitignored)
Auto-captured by Cursor hooks (\`.cursor/hooks/inferno-session-draft.mjs\`). **Not product truth** — review, then run \`npm run inferno:promote-draft\` or \`infernoflow context\`.
---
`;

const MAX_MESSAGE_CHARS = 120_000;
const MAX_FILE_BYTES = 280_000;

// ── paths ──────────────────────────────────────────────────────────────────

function projectRoot() {
  return process.cwd();
}

function draftPath() {
  return path.join(projectRoot(), "inferno", "CONTEXT.draft.md");
}

function agentPromptPath() {
  return path.join(projectRoot(), "inferno", "agent-prompt.md");
}

function agentResponsePath() {
  return path.join(projectRoot(), "inferno", "agent-response.json");
}

// ── CONTEXT.draft.md helpers ───────────────────────────────────────────────

function ensureDraftFile(file) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, DRAFT_HEADER, "utf8");
  }
}

function trimFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  if (Buffer.byteLength(raw, "utf8") <= MAX_FILE_BYTES) return;
  const keep = raw.slice(-Math.floor(MAX_FILE_BYTES * 0.85));
  const idx = keep.indexOf("\n### ");
  const body = idx === -1 ? keep : keep.slice(idx);
  fs.writeFileSync(
    file,
    `${DRAFT_HEADER}\n_(older capture trimmed for size)_\n\n${body}`,
    "utf8",
  );
}

function appendBlock(file, block) {
  ensureDraftFile(file);
  fs.appendFileSync(file, block, "utf8");
  trimFile(file);
}

// ── JSON extraction ────────────────────────────────────────────────────────

function extractJsonFromText(text) {
  // 1. fenced code block
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const candidate = fenceMatch[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  // 2. largest bare JSON object in the text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      JSON.parse(jsonMatch[0]);
      return jsonMatch[0];
    } catch {}
  }

  return null;
}

// ── bridge: write agent-response.json if infernoflow is waiting ────────────

function maybeWriteAgentResponse(text) {
  const promptFile = agentPromptPath();
  const responseFile = agentResponsePath();

  if (!fs.existsSync(promptFile)) return false;

  const json = extractJsonFromText(text);
  if (!json) {
    process.stderr.write(
      "[inferno-session-draft] infernoflow waiting but no JSON found in agent reply\n",
    );
    return false;
  }

  fs.writeFileSync(responseFile, json, "utf8");
  try {
    fs.unlinkSync(promptFile);
  } catch {}

  process.stderr.write(
    "[inferno-session-draft] ✔ agent-response.json written — infernoflow will continue\n",
  );
  return true;
}

// ── stdin ──────────────────────────────────────────────────────────────────

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// ── Deterministic trigger capture (beforeSubmitPrompt) ──────────────────────
// Cursor's beforeSubmitPrompt hook hands us the USER's prompt text before it
// goes to the model. The Memory-protocol block already asks the AI to log on
// these signals, but the AI doesn't always obey — so this is a deterministic
// backstop: if the prompt itself contains a trouble signal (!!, retry, "not
// working", …) we write an `attempt` entry ourselves. Bounded hard against
// noise: a 90s cooldown + identical-prompt dedupe, so a frustrated burst of
// "still broken!! retry!!" produces ONE entry, not ten.
const TRIGGER_RES = [
  /(?:^|\s)!!+/,
  /\bretry(?:ing)?\b/i,
  /\bnot working\b/i,
  /\bstill (?:broken|failing|not working|doesn['’]?t)\b/i,
  /\bsame (?:error|issue|problem)\b/i,
  /\bno change\b/i,
  /\bdoesn['’]?t work\b/i,
];

// Deterministic BOOKMARK triggers — an explicit "bookmark this" is an intentional
// resume point (not a trouble signal), so it takes precedence and drops a real
// bookmark (which auto-captures the session transcript). No AI cooperation needed.
const BOOKMARK_RES = [
  /\bbookmark (?:this|it|here)(?: point)?\b/i,
  /\bmark this (?:point|spot|moment|here)\b/i,
  /\bsave (?:this )?(?:point|checkpoint|resume point)\b/i,
];

/** Strip the trigger phrase to reuse the rest of the prompt as the bookmark label. */
function deriveBookmarkLabel(prompt) {
  const label = prompt
    .replace(/\bbookmark (?:this|it|here)(?: point)?\b/ig, "")
    .replace(/\bmark this (?:point|spot|moment|here)\b/ig, "")
    .replace(/\bsave (?:this )?(?:point|checkpoint|resume point)\b/ig, "")
    .replace(/[\s:.!,–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (label.slice(0, 80).trim()) || "Session bookmark";
}

function memoryRootExists() {
  return fs.existsSync(path.join(projectRoot(), ".ai-memory")) ||
         fs.existsSync(path.join(projectRoot(), "inferno"));
}

function triggerStatePath() {
  return path.join(projectRoot(), ".ai-memory", ".trigger-state.json");
}

function cheapHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function handleBookmarkTrigger(prompt) {
  const now = Date.now();
  const stateFile = triggerStatePath();
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
  const h = cheapHash(prompt.slice(0, 200));
  if (state.lastBmHash === h) return;              // same prompt — don't double-fire

  const label = deriveBookmarkLabel(prompt);
  let wrote = false;
  try {
    // The `bookmark` command (no --marker) auto-captures the session transcript
    // as the resume point. Needs infernoflow >= 0.44.10 on PATH; if the global
    // CLI is older / missing, this no-ops and the AI's amp_bookmark path covers it.
    const bin = process.platform === "win32" ? "infernoflow.cmd" : "infernoflow";
    const r = spawnSync(bin, ["bookmark", label], {
      cwd: projectRoot(), encoding: "utf8", timeout: 12000, shell: process.platform === "win32",
    });
    wrote = r.status === 0;
  } catch { /* CLI unavailable — skip */ }

  if (wrote) {
    try { fs.writeFileSync(stateFile, JSON.stringify({ ...state, lastBmHash: h }), "utf8"); } catch {}
    process.stderr.write("[inferno-session-draft] auto-bookmarked resume point\n");
  }
}

function handleUserPrompt(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  if (!memoryRootExists()) return;                 // only inside infernoflow projects

  // Bookmark trigger takes precedence — "bookmark this" is intentional, not trouble.
  if (BOOKMARK_RES.some((re) => re.test(trimmed))) { handleBookmarkTrigger(trimmed); return; }

  if (!TRIGGER_RES.some((re) => re.test(trimmed))) return;

  const now = Date.now();
  const stateFile = triggerStatePath();
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
  const h = cheapHash(trimmed.slice(0, 200));
  const COOLDOWN_MS = 90_000;
  if (state.lastHash === h) return;                // exact same prompt — skip
  if (state.lastTs && now - state.lastTs < COOLDOWN_MS) return; // rate-limit

  const msg = "Auto-trigger — user signalled trouble: " +
    trimmed.replace(/\s+/g, " ").slice(0, 180);

  // Prefer the CLI (correct id / branch routing / AMP shape); fall back to a
  // direct sessions.jsonl append so capture still works without a global CLI.
  let wrote = false;
  try {
    const bin = process.platform === "win32" ? "infernoflow.cmd" : "infernoflow";
    const r = spawnSync(bin, ["log", msg, "--type", "attempt", "--source", "cursor-trigger", "--tags", "auto-trigger"], {
      cwd: projectRoot(), encoding: "utf8", timeout: 8000, shell: process.platform === "win32",
    });
    wrote = r.status === 0;
  } catch { /* fall through to direct write */ }
  if (!wrote) {
    try {
      const sess = path.join(projectRoot(), ".ai-memory", "sessions.jsonl");
      fs.mkdirSync(path.dirname(sess), { recursive: true });
      const entry = { type: "attempt", msg, ts: now, id: "amp_hook_" + now.toString(36), source: "cursor-trigger", tags: ["auto-trigger"], meta: { agent: "cursor-hook" } };
      fs.appendFileSync(sess, JSON.stringify(entry) + "\n", "utf8");
      wrote = true;
    } catch { /* best effort */ }
  }

  if (wrote) {
    try { fs.writeFileSync(stateFile, JSON.stringify({ ...state, lastTs: now, lastHash: h }), "utf8"); } catch {}
    process.stderr.write("[inferno-session-draft] auto-captured trigger to memory\n");
  }
}

// ── main ───────────────────────────────────────────────────────────────────

function main() {
  const agentStop = process.argv.includes("--agent-stop");

  readStdin()
    .then((raw) => {
      let data = {};
      try {
        data = raw.trim() ? JSON.parse(raw) : {};
      } catch (e) {
        console.error("[inferno-session-draft] stdin JSON parse:", e.message);
        console.log("{}");
        process.exit(0);
        return;
      }

      // beforeSubmitPrompt: deterministic trigger capture on the USER's prompt.
      if (process.argv.includes("--user-prompt")) {
        const t = typeof data.prompt === "string" ? data.prompt
                : typeof data.text === "string"   ? data.text : "";
        try { handleUserPrompt(t); } catch (e) { console.error("[inferno-session-draft] trigger:", e?.message); }
        console.log("{}");
        process.exit(0);
        return;
      }

      const file = draftPath();

      if (agentStop) {
        const status = data.status ?? "unknown";
        const loop = data.loop_count ?? 0;
        appendBlock(
          file,
          `\n### _agent stop_ (${new Date().toISOString()})\n\nstatus: \`${status}\` · loop_count: ${loop}\n\n---\n`,
        );
        console.log("{}");
        process.exit(0);
        return;
      }

      const text = typeof data.text === "string" ? data.text : "";
      if (!text.trim()) {
        console.log("{}");
        process.exit(0);
        return;
      }

      // Job 2: feed infernoflow's file-based bridge if it is waiting
      maybeWriteAgentResponse(text);

      // Job 1: always append to CONTEXT.draft.md
      const clipped =
        text.length > MAX_MESSAGE_CHARS
          ? `${text.slice(0, MAX_MESSAGE_CHARS)}\n\n_…trimmed (${text.length - MAX_MESSAGE_CHARS} chars omitted)_\n`
          : text;

      appendBlock(
        file,
        `\n### Assistant message (${new Date().toISOString()})\n\n${clipped}\n\n---\n`,
      );

      console.log("{}");
      process.exit(0);
    })
    .catch((e) => {
      console.error("[inferno-session-draft]", e);
      console.log("{}");
      process.exit(0);
    });
}

main();
