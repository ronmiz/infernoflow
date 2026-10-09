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
import { spawnSync, execFileSync } from "node:child_process";

// infernoflow-hook-version: 5
// SECURITY (0.44.20): the CLI is run as `node infernoflow.mjs ...` with NO
// shell. Before 0.44.20 this hook used spawnSync("infernoflow.cmd", args,
// { shell: true }) on Windows, which hands the prompt text to cmd.exe
// unquoted — a prompt containing `&` or `|` ran as a command.
function findCliMjs() {
  let hits = [];
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    hits = execFileSync(finder, ["infernoflow"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 10_000 })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {}
  // `where` (Windows) searches the current folder first — never use a
  // launcher that lives inside the project (a cloned repo could plant one).
  const proj = path.resolve(projectRoot()).toLowerCase();
  const inProject = (p) => { const r = path.resolve(p).toLowerCase(); return r === proj || r.startsWith(proj + path.sep); };
  for (const c of hits) {
    if (inProject(c)) continue;
    try { const real = fs.realpathSync(c); if (/\.m?js$/i.test(real) && !inProject(real)) return real; } catch {}
    const d = path.dirname(c);
    for (const pkg of [path.join(d, "node_modules", "infernoflow"), path.join(d, "..", "lib", "node_modules", "infernoflow")]) {
      for (const f of [path.join(pkg, "dist", "bin", "infernoflow.mjs"), path.join(pkg, "bin", "infernoflow.mjs")]) {
        if (fs.existsSync(f)) return f;
      }
    }
  }
  return null;
}

/** Run the infernoflow CLI without a shell. Returns the spawnSync result or null. */
function runCli(args, opts) {
  const cli = findCliMjs();
  if (!cli) return null;
  return spawnSync(process.execPath, [cli, ...args], { ...opts, windowsHide: true, shell: false });
}

/** Text that becomes a CLI argument must never look like a flag. */
const asCliText = (v) => String(v ?? "").replace(/^[\s-]+/, "");

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
// 0.46.3: only text the human typed counts (pasted logs, code, quotes and
// machine-generated messages are ignored). Identical copy of lib/frustration.mjs
// — tests/frustration.test.mjs keeps them in sync.
function humanText(prompt) {
  if (typeof prompt !== "string") return "";
  if (/^\s*<(agent-message|system-reminder|task-notification|command-|local-command|user-prompt-submit-hook|bash-|tool-|function_)/i.test(prompt)) return "";
  if (/^\s*\[(?:Subagent hand-back|Request interrupted)/i.test(prompt)) return "";
  if (/^\s*Caveat: The messages below were generated/i.test(prompt)) return "";
  // Bound the work: this runs on every prompt. A huge paste keeps its start
  // and end, where a person's own words usually are.
  let p = prompt.length > 20000 ? prompt.slice(0, 10000) + "\n" + prompt.slice(-10000) : prompt;
  // Line-anchored patterns use [ \t]*, never \s* — with the m flag \s* also
  // eats newlines and backtracks badly over blank lines.
  p = p
    .replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")     // <tag>…</tag> blocks
    .replace(/```[\s\S]*?(?:```|$)/g, " ")                            // fenced code (closed or not)
    .replace(/^(?: {4}|\t).*$/gm, " ")                                // indented code
    .replace(/^[ \t]*>.*$/gm, " ")                                    // quoted lines
    .replace(/^[ \t]*(?:at [\w.$<>\[\]]+ \(.*\)|at \S+:\d+|(?:[A-Z]\w*)?(?:Error|Exception)\b[^\n]*:|Traceback \(|File "[^"\n]*", line \d).*$/gm, " ") // stack traces
    .replace(/\s+/g, " ")
    .trim();
  // What a person types is short; keep both ends of anything longer.
  return p.length > 500 ? p.slice(0, 250) + " … " + p.slice(-250) : p;
}
function isFrustration(text) {
  if (typeof text !== "string" || !text) return false;
  const PHRASES = [
    /\bnot working\b/i,
    /\bstill (?:broken|failing|fails|crashing|crashes|the same|nothing|doesn['’]?t work)\b/i,
    /\bstill not (?:working|fixed|compiling|building|loading|passing|running|showing)\b/i,
    /\bdoes(?:n['’]?t| not) work\b/i,
    /\b(?:it|this|that|is|are|it['’]?s)\s+(?:still\s+|totally\s+|completely\s+)?broken\b/i,
    /\bbroken again\b/i,
    /\bsame (?:error|issue|problem)\b/i,
    /\bno change\b/i,
  ];
  if (PHRASES.some((re) => re.test(text))) return true;
  // Noisy signals only in a short prompt: "!!" ending a word ("fix it!!",
  // "why!!", "!!") but not code like "!!value"; "retry".
  const short = text.length <= 200;
  return short && (/!{2,}(?=\s|$)/.test(text) || /\bretry(?:ing)?\b/i.test(text));
}

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
    const r = runCli(["bookmark", asCliText(label)], {
      cwd: projectRoot(), encoding: "utf8", timeout: 12000,
    });
    wrote = !!r && r.status === 0;
  } catch { /* CLI unavailable — skip */ }

  if (wrote) {
    try { fs.writeFileSync(stateFile, JSON.stringify({ ...state, lastBmHash: h }), "utf8"); } catch {}
    process.stderr.write("[inferno-session-draft] auto-bookmarked resume point\n");
  }
}

function handleUserPrompt(text) {
  const trimmed = humanText(text || "");
  if (!trimmed) return;
  if (!memoryRootExists()) return;                 // only inside infernoflow projects

  // Bookmark trigger takes precedence — "bookmark this" is intentional, not trouble.
  if (BOOKMARK_RES.some((re) => re.test(trimmed))) { handleBookmarkTrigger(trimmed); return; }

  if (!isFrustration(trimmed)) return;

  const now = Date.now();
  const stateFile = triggerStatePath();
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
  const h = cheapHash(trimmed.slice(0, 200));
  const COOLDOWN_MS = 90_000;
  if (state.lastHash === h) return;                // exact same prompt — skip
  if (state.lastTs && now - state.lastTs < COOLDOWN_MS) return; // rate-limit

  const msg = "Auto-trigger — user signalled trouble: " +
    trimmed.replace(/^[\s-]+/, "").slice(0, 60);   // R5.2: keep only a short prefix of the prompt

  // Prefer the CLI (correct id / branch routing / AMP shape); fall back to a
  // direct sessions.jsonl append so capture still works without a global CLI.
  let wrote = false;
  try {
    const r = runCli(["log", asCliText(msg), "--type", "attempt", "--source", "cursor-trigger", "--agent", "cursor-hook", "--tags", "auto-trigger"], {
      cwd: projectRoot(), encoding: "utf8", timeout: 15000,
    });
    wrote = !!r && r.status === 0;
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
