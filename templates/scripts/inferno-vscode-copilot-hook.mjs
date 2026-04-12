#!/usr/bin/env node
/**
 * GitHub Copilot / VS Code agent hook (Preview): stdin JSON per
 * https://code.visualstudio.com/docs/copilot/customization/hooks
 *
 * - UserPromptSubmit: appends the user's prompt to inferno/CONTEXT.draft.md
 * - Stop: reads transcript_path (JSONL or session JSON), appends last assistant text if found
 *
 * Always prints {"continue":true} so the agent is never blocked. Errors → stderr only.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Keep in sync with inferno-promote-draft.mjs / inferno-session-draft.mjs */
const DRAFT_HEADER = `# CONTEXT draft (gitignored)

Auto-captured by VS Code / Copilot hooks. **Not product truth** — review, then run \`npm run inferno:promote-draft\` or \`infernoflow context\`.

---
`;

const MAX_APPEND = 120_000;
const MAX_FILE_BYTES = 280_000;

function draftPath(root) {
  return path.join(root, "inferno", "CONTEXT.draft.md");
}

function ensureDraft(file) {
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

function append(root, block) {
  const file = draftPath(root);
  ensureDraft(file);
  fs.appendFileSync(file, block, "utf8");
  trimFile(file);
}

function readStdinSync() {
  /** Prefer readSync: on some Windows shells, readFileSync(0) returns empty for piped hook stdin. */
  const buf = Buffer.alloc(16 * 1024 * 1024);
  let n = 0;
  try {
    n = fs.readSync(0, buf, 0, buf.length, null);
  } catch {
    return "";
  }
  return buf.slice(0, n).toString("utf8");
}

function flattenResponse(resp) {
  if (!resp) return "";
  if (typeof resp === "string") return resp.slice(0, MAX_APPEND);
  if (typeof resp.markdown === "string") return resp.markdown;
  if (typeof resp.text === "string") return resp.text;
  if (Array.isArray(resp.parts)) {
    const bits = resp.parts
      .map((p) => (typeof p === "string" ? p : p?.text || p?.content || p?.value || ""))
      .filter(Boolean);
    if (bits.length) return bits.join("\n").slice(0, MAX_APPEND);
  }
  if (resp.message && typeof resp.message.text === "string") return resp.message.text;
  return "";
}

function lastAssistantFromSessionJson(data) {
  const reqs = data.requests;
  if (!Array.isArray(reqs)) return "";
  for (let i = reqs.length - 1; i >= 0; i--) {
    const t = flattenResponse(reqs[i]?.response);
    if (t && t.trim()) return t.slice(0, MAX_APPEND);
  }
  return "";
}

function extractFromJsonlLine(obj) {
  if (!obj || typeof obj !== "object") return "";
  const a = obj.assistant;
  if (a && typeof a.message === "string" && a.message.trim()) return a.message.slice(0, MAX_APPEND);
  if (a && typeof a.text === "string" && a.text.trim()) return a.text.slice(0, MAX_APPEND);
  if ((obj.role === "assistant" || obj.type === "assistant") && typeof obj.message === "string")
    return obj.message.slice(0, MAX_APPEND);
  if ((obj.role === "assistant" || obj.type === "assistant") && typeof obj.content === "string")
    return obj.content.slice(0, MAX_APPEND);
  if (obj.assistantMessage && typeof obj.assistantMessage === "string")
    return obj.assistantMessage.slice(0, MAX_APPEND);
  return "";
}

function lastAssistantFromTranscriptFile(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return "";
  const raw = fs.readFileSync(transcriptPath, "utf8").trim();
  if (!raw) return "";

  if (raw.startsWith("{")) {
    try {
      const data = JSON.parse(raw);
      const fromReq = lastAssistantFromSessionJson(data);
      if (fromReq) return fromReq;
    } catch {
      /* fall through */
    }
  }

  let last = "";
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t[0] !== "{") continue;
    try {
      const v = extractFromJsonlLine(JSON.parse(t));
      if (v) last = v;
    } catch {
      /* skip line */
    }
  }
  return last;
}

function main() {
  let data = {};
  try {
    const s = readStdinSync().trim();
    if (s) data = JSON.parse(s);
  } catch (e) {
    console.error("[inferno-vscode-copilot-hook] stdin JSON:", e.message);
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
    return;
  }

  const root = data.cwd || process.cwd();
  const hook = String(data.hookEventName || data.hook_event_name || "")
    .replace(/\s+/g, "")
    .toLowerCase();

  try {
    if (hook === "userpromptsubmit") {
      const prompt = data.prompt || data.Prompt || "";
      if (typeof prompt === "string" && prompt.trim()) {
        append(
          root,
          `\n### User prompt (${new Date().toISOString()})\n\n${prompt.slice(0, MAX_APPEND)}\n\n---\n`
        );
      }
    } else if (hook === "stop") {
      const tp = data.transcript_path || data.transcriptPath;
      const assistant = lastAssistantFromTranscriptFile(tp);
      const stopActive = data.stop_hook_active ?? data.stopHookActive;
      if (assistant) {
        append(
          root,
          `\n### Assistant (from transcript) (${new Date().toISOString()})\n\n${assistant}\n\n---\n`
        );
      } else {
        append(
          root,
          `\n### _Copilot Stop_ (${new Date().toISOString()})\n\nstop_hook_active: ${Boolean(stopActive)}${
            tp ? ` · transcript: ${tp}` : " · (no transcript_path or empty parse)"
          }\n\n---\n`
        );
      }
    }
  } catch (e) {
    console.error("[inferno-vscode-copilot-hook]", e);
  }

  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

main();
