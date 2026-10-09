#!/usr/bin/env node
// infernoflow memory-keeper guard (PreToolUse on Bash, scoped to that subagent).
// infernoflow-hook-version: 5
// The memory-keeper reads transcripts — content it must treat as data. To keep
// a hostile transcript from turning it into a general shell, its Bash calls may
// only be a single read/log `infernoflow …` command. Anything with pipes,
// redirects, chaining, substitution, variables or another program is denied.
import { readFileSync } from "node:fs";

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
const cmd = String((input.tool_input && input.tool_input.command) || "").trim();

// Read-and-log subcommands only. No setup/init/sync/uninstall/move/curate/
// context: a hostile transcript must not be able to reconfigure the user's
// memory, push code or rewrite other projects through this agent.
const ALLOWED = new Set(["status", "log", "ask", "resume", "bookmark", "transcript"]);   // not recap: it marks entries reviewed

function allowed(c) {
  if (!c || c.length > 4000) return false;
  // One plain command: no chaining, pipes, redirects, subshells, variables or
  // line breaks. (Use --project <dir> to target another repo, never `cd`.)
  if (/[;&|<>`\n\r]|\$[({A-Za-z_]/.test(c)) return false;
  const m = /^infernoflow\s+([a-z-]+)(\s|$)/.exec(c);
  if (!m || !ALLOWED.has(m[1])) return false;
  if (m[1] === "bookmark" && /^infernoflow\s+bookmark\s+rm\b/.test(c)) return false;   // no deleting
  return true;
}

if (allowed(cmd)) process.exit(0);
process.stderr.write("memory-keeper may only run single `infernoflow status|log|ask|resume|bookmark|transcript …` commands (use --project <dir>, not cd). Blocked: " + cmd.slice(0, 200) + "\n");
process.exit(2);
