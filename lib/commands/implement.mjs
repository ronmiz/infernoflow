import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { header, section, info, warn, cyan, gray, errorAndExit } from "../ui/output.mjs";
import {
  loadImplementContext,
  buildCursorImplementPrompt,
  buildGenericImplementPrompt,
} from "../ui/prompts.mjs";

function getFlagValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

function extractTask(args) {
  const skipNextFor = new Set(["--mode"]);
  const parts = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith("-")) {
      if (skipNextFor.has(token)) i += 1;
      continue;
    }
    if (i === 0) continue; // command name
    parts.push(token);
  }
  return parts.join(" ").trim();
}

function copyToClipboard(text) {
  try {
    const p = process.platform;
    if (p === "win32") execSync("clip", { input: text });
    else if (p === "darwin") execSync("pbcopy", { input: text });
    else {
      try { execSync("xclip -selection clipboard", { input: text }); }
      catch { execSync("xsel --clipboard --input", { input: text }); }
    }
    return true;
  } catch {
    return false;
  }
}

export async function implementCommand(args = []) {
  header("implement");

  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  if (!fs.existsSync(infernoDir)) {
    errorAndExit("inferno/ not found", "Run: infernoflow init");
  }

  const mode = (getFlagValue(args, "--mode") || "both").toLowerCase();
  const copyFlag = args.includes("--copy") || args.includes("-c");
  if (!["cursor", "generic", "both"].includes(mode)) {
    errorAndExit("Invalid --mode value", "Use: --mode cursor|generic|both");
  }

  const rawTask = extractTask(args);
  if (!rawTask) {
    errorAndExit("No task provided", 'Usage: infernoflow implement "your task description"');
  }

  const context = loadImplementContext(cwd);
  const cursorPrompt = buildCursorImplementPrompt({ task: rawTask, ...context });
  const genericPrompt = buildGenericImplementPrompt({ task: rawTask, ...context });

  info(`Task: ${cyan(rawTask)}`);
  info(`Mode: ${cyan(mode)}`);
  warn("If you hit model high-load/resource-exhausted, retry with Auto/another model.");

  if (mode === "cursor" || mode === "both") {
    section("Cursor Agent Prompt");
    console.log();
    console.log(gray("─".repeat(50)));
    console.log(cursorPrompt);
    console.log(gray("─".repeat(50)));
  }

  if (mode === "generic" || mode === "both") {
    section("Generic Agent Prompt");
    console.log();
    console.log(gray("─".repeat(50)));
    console.log(genericPrompt);
    console.log(gray("─".repeat(50)));
  }

  if (copyFlag) {
    const textToCopy =
      mode === "cursor"
        ? cursorPrompt
        : mode === "generic"
          ? genericPrompt
          : `## Cursor Agent Prompt\n\n${cursorPrompt}\n\n## Generic Agent Prompt\n\n${genericPrompt}`;
    const ok = copyToClipboard(textToCopy);
    if (ok) info(`Copied ${mode} prompt${mode === "both" ? "s" : ""} to clipboard.`);
    else warn("Clipboard copy failed. Copy from terminal output.");
  }

  console.log();
}
