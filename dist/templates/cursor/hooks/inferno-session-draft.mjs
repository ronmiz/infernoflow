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
