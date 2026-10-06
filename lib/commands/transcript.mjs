/**
 * `infernoflow transcript [--last N]` — print the current Claude Code session
 * transcript for this project as plain "USER:/AI:" lines (0.46.0).
 * Used by the memory-keeper agent, whose Bash access is limited to
 * `infernoflow` commands. Secrets are redacted in the output.
 */
import * as fs from "node:fs";
import { findLatestTranscript } from "../transcript.mjs";
import { redactSecrets } from "../security/redact.mjs";

export async function transcriptCommand(args = []) {
  const li = args.indexOf("--last");
  const last = Math.max(1, Math.min(2000, parseInt(li !== -1 ? args[li + 1] : "400", 10) || 400));
  const file = findLatestTranscript(process.cwd());
  if (!file) { console.error("no Claude Code transcript found for this project"); process.exitCode = 1; return; }
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").slice(-last);
  for (const x of lines) {
    let o; try { o = JSON.parse(x); } catch { continue; }
    if (o.type !== "user" && o.type !== "assistant") continue;
    const c = o.message && o.message.content;
    const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter(p => p && p.type === "text").map(p => p.text).join(" ") : "";
    if (!t.trim() || t.startsWith("<")) continue;
    console.log((o.type === "user" ? "USER: " : "AI: ") + redactSecrets(t.replace(/\s+/g, " ").slice(0, 600)).text);
  }
}
