#!/usr/bin/env node
/**
 * Cursor hook: append agent output to inferno/CONTEXT.draft.md (gitignored).
 * - Default stdin: afterAgentResponse → { text }
 * - --agent-stop stdin: stop → { status, loop_count, ... }
 * Never fail closed: errors go to stderr; stdout is {} for Cursor.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Keep in sync with templates/scripts/inferno-promote-draft.mjs (split at first \\n---\\n). */
const DRAFT_HEADER = `# CONTEXT draft (gitignored)

Auto-captured by Cursor hooks (\`.cursor/hooks/inferno-session-draft.mjs\`). **Not product truth** — review, then run \`npm run inferno:promote-draft\` or \`infernoflow context\`.

---
`;

const MAX_MESSAGE_CHARS = 120_000;
const MAX_FILE_BYTES = 280_000;

function projectRoot() {
  return process.cwd();
}

function draftPath() {
  return path.join(projectRoot(), "inferno", "CONTEXT.draft.md");
}

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
  fs.writeFileSync(file, `${DRAFT_HEADER}\n_(older capture trimmed for size)_\n\n${body}`, "utf8");
}

function appendBlock(file, block) {
  ensureDraftFile(file);
  fs.appendFileSync(file, block, "utf8");
  trimFile(file);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

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
          `\n### _agent stop_ (${new Date().toISOString()})\n\nstatus: \`${status}\` · loop_count: ${loop}\n\n---\n`
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

      const clipped =
        text.length > MAX_MESSAGE_CHARS
          ? `${text.slice(0, MAX_MESSAGE_CHARS)}\n\n_…trimmed (${text.length - MAX_MESSAGE_CHARS} chars omitted)_\n`
          : text;

      appendBlock(
        file,
        `\n### Assistant message (${new Date().toISOString()})\n\n${clipped}\n\n---\n`
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
