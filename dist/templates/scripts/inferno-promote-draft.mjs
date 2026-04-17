#!/usr/bin/env node
/**
 * Merge inferno/CONTEXT.draft.md into inferno/CONTEXT.md under ## Decisions & notes,
 * or clear the draft. Draft is gitignored; CONTEXT.md is the promoted source of truth.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const root = process.cwd();
const draftFile = path.join(root, "inferno", "CONTEXT.draft.md");
const contextFile = path.join(root, "inferno", "CONTEXT.md");

/** Keep in sync with .cursor/hooks/inferno-session-draft.mjs (getDraftBody splits at first \\n---\\n). */
const DRAFT_HEADER = `# CONTEXT draft (gitignored)

Auto-captured by IDE hooks (Cursor and/or VS Code + Copilot). **Not product truth** — review, then run \`npm run inferno:promote-draft\` or \`infernoflow context\`.

---
`;

const DECISIONS_ANCHOR = "## Decisions & notes";
const PASTE_FOOTER_ANCHOR = "\n---\n_Paste this block at the start of any new AI session._";

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function write(p, s) {
  fs.writeFileSync(p, s, "utf8");
}

function getDraftBody() {
  if (!fs.existsSync(draftFile)) return "";
  const full = read(draftFile);
  const sep = full.indexOf("\n---\n");
  if (sep === -1) return full.trim();
  const after = full.slice(sep + "\n---\n".length).trim();
  return after;
}

function clearDraft() {
  fs.mkdirSync(path.dirname(draftFile), { recursive: true });
  write(draftFile, DRAFT_HEADER);
  console.log("Cleared inferno/CONTEXT.draft.md (header only).");
}

function appendNotes() {
  if (!fs.existsSync(contextFile)) {
    console.error("Missing inferno/CONTEXT.md");
    process.exit(1);
  }
  const body = getDraftBody();
  if (!body) {
    console.error("Nothing to promote: inferno/CONTEXT.draft.md is empty after the header.");
    process.exit(1);
  }

  const ctx = read(contextFile);
  const i = ctx.indexOf(DECISIONS_ANCHOR);
  if (i === -1) {
    console.error(`Could not find "${DECISIONS_ANCHOR}" in inferno/CONTEXT.md`);
    process.exit(1);
  }
  const j = ctx.indexOf(PASTE_FOOTER_ANCHOR, i);
  if (j === -1) {
    console.error("Could not find paste footer block in inferno/CONTEXT.md");
    process.exit(1);
  }

  const before = ctx.slice(0, i + DECISIONS_ANCHOR.length);
  const decisionsAndFooter = ctx.slice(i + DECISIONS_ANCHOR.length, j);
  const after = ctx.slice(j);

  let middle = decisionsAndFooter;
  if (middle.includes("_No decisions recorded_")) {
    middle = middle.replace("_No decisions recorded_", "").replace(/\n\n\n+/g, "\n\n");
  }

  const stamp = new Date().toISOString().slice(0, 19);
  const indented = body.split("\n").map((line) => `    ${line}`).join("\n");
  const block = `\n\n### Captured from agent draft (${stamp})\n\n${indented}\n`;

  write(contextFile, `${before}${middle}${block}${after}`);
  clearDraft();
  console.log("Appended draft under ## Decisions & notes in inferno/CONTEXT.md and cleared the draft.");
  console.log("Next: edit wording if needed, then run infernoflow check when contract/changelog should match.");
}

const args = process.argv.slice(2);
if (args.includes("--clear")) {
  clearDraft();
  process.exit(0);
}
if (args.includes("--append-notes")) {
  appendNotes();
  process.exit(0);
}

const body = getDraftBody();
if (!body) {
  console.log("inferno/CONTEXT.draft.md has no captured content yet (after the header).");
  console.log("Use the Agent chat; each assistant reply appends via the afterAgentResponse hook.");
  process.exit(0);
}

console.log("--- inferno/CONTEXT.draft.md (excerpt, first 2000 chars) ---\n");
console.log(body.slice(0, 2000) + (body.length > 2000 ? "\n…" : ""));
console.log("\n---");
console.log("Promote into CONTEXT.md under Decisions:");
console.log("  npm run inferno:promote-draft -- --append-notes");
console.log("Or set working/intent via CLI:");
console.log('  npm exec -- infernoflow context --working "..." --intent "..."');
console.log("Clear draft without merging:");
console.log("  npm run inferno:promote-draft -- --clear");
