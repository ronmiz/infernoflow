/**
 * AI-summarized session sweep.
 *
 * Reads .ai-memory/CONTEXT.draft.md (the raw transcript written by Cursor /
 * Copilot hooks), asks an AI provider to extract structured memory entries
 * (gotchas / decisions / failed attempts / notes), shows the candidates in
 * a multi-select quick-pick, and saves only the ones the user approves.
 *
 * Provider strategy (first one that works wins):
 *   1. VS Code LM API — uses the user's Copilot subscription (zero config
 *      if Copilot is signed in).
 *   2. Shell out to `infernoflow ai-summarize` (CLI fallback) — uses
 *      whatever the CLI's AI provider is configured for.
 *
 * If neither works, we surface a friendly message pointing the user at
 * `infernoflow ai setup`.
 *
 * Each candidate the user approves becomes a real memory entry written via
 * ampIO.write() — same path as manual logging, so the rest of the system
 * (sidebar, CodeLens, rule-file injection) reacts the same way.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { ampIO } from "./amp";
import type { EntryType } from "infernoflow-amp";

interface CandidateEntry {
  type: EntryType;
  msg:  string;
  file?: string;
  line?: number;
}

/** Try VS Code LM API first (Copilot), then CLI shellout. Returns [] on any failure. */
async function summarizeViaProvider(transcript: string): Promise<CandidateEntry[]> {
  // Path 1 — VS Code LM API (Copilot).
  try {
    const lm = (vscode as unknown as { lm?: { selectChatModels?: (sel: object) => Promise<Array<{ sendRequest: (msgs: unknown[], opts?: object, tok?: vscode.CancellationToken) => Promise<{ text: AsyncIterable<string> }> }>> } }).lm;
    if (lm?.selectChatModels) {
      const models = await lm.selectChatModels({ vendor: "copilot" });
      if (models && models.length > 0) {
        const model = models[0];
        const prompt = buildPrompt(transcript);
        const messages = [
          { role: "user", content: prompt },
        ];
        const res = await model.sendRequest(messages);
        let out = "";
        for await (const chunk of res.text) out += chunk;
        const parsed = parseAiResponse(out);
        if (parsed.length > 0) return parsed;
      }
    }
  } catch { /* fall through to CLI */ }

  // Path 2 — CLI shellout. Requires the user has run `infernoflow ai setup`.
  try {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return [];
    const cli = vscode.workspace.getConfiguration("infernoflow").get<string>("cliPath", "infernoflow");
    const result = spawnSync(cli, ["context", "--summarize", "--json"], {
      cwd,
      encoding: "utf8",
      env:      { ...process.env, NO_COLOR: "1" },
      timeout:  60_000,
      shell:    process.platform === "win32",
    });
    if (result.status === 0 && result.stdout) {
      const parsed = parseAiResponse(result.stdout);
      if (parsed.length > 0) return parsed;
    }
  } catch { /* nothing to fall back to */ }

  return [];
}

/** Build the AI prompt asking for structured memory entries. */
function buildPrompt(transcript: string): string {
  // Cap transcript at 8000 chars — most LLM contexts can take more, but we
  // want a focused view of the session, not the entire chat history.
  const trimmed = transcript.slice(-8000);
  return `You are extracting structured memory entries from an AI coding session transcript.
Output ONLY a JSON array (no markdown fences, no commentary). Each entry has:
  - type: "gotcha" (a landmine future devs should avoid) | "decision" (an architectural choice) | "attempt" (something tried that didn't work) | "note" (general context worth remembering)
  - msg:  one sentence, ≤ 200 chars, action-oriented
  - file: optional file path if mentioned
  - line: optional line number if mentioned

Extract 1–6 entries that are genuinely worth remembering across future sessions. Skip routine work, skip the obvious. If nothing notable happened, return [].

TRANSCRIPT:
${trimmed}

OUTPUT (JSON array only):`;
}

/** Parse the AI response — accept JSON arrays even if wrapped in code fences. */
function parseAiResponse(raw: string): CandidateEntry[] {
  if (!raw) return [];
  // Strip markdown fences if present
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = cleaned.indexOf("[");
  const end   = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  const slice = cleaned.slice(start, end + 1);
  try {
    const arr = JSON.parse(slice);
    if (!Array.isArray(arr)) return [];
    const valid: EntryType[] = ["gotcha", "decision", "attempt", "note"];
    return arr
      .filter((e): e is CandidateEntry =>
        e && typeof e.msg === "string" && e.msg.trim().length > 0 &&
        typeof e.type === "string" && (valid as string[]).includes(e.type),
      )
      .map(e => ({
        type: e.type as EntryType,
        msg:  e.msg.trim(),
        file: typeof e.file === "string" ? e.file : undefined,
        line: typeof e.line === "number" ? e.line : undefined,
      }));
  } catch {
    return [];
  }
}

/** The full sweep flow: read draft → summarize → preview → save selected. */
export async function summarizeSessionCommand(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showInformationMessage("Open a workspace folder first.");
    return;
  }
  if (!ampIO.isInitialised()) {
    vscode.window.showInformationMessage("infernoflow not initialised. Run `infernoflow init` first.");
    return;
  }

  const candidates = [
    path.join(root, ".ai-memory", "CONTEXT.draft.md"),
    path.join(root, "inferno",    "CONTEXT.draft.md"),
  ];
  let draftPath: string | undefined;
  for (const p of candidates) if (fs.existsSync(p)) { draftPath = p; break; }
  if (!draftPath) {
    const choice = await vscode.window.showInformationMessage(
      "No CONTEXT.draft.md found. Install hooks to capture agent conversation.",
      "Install Cursor hooks",
    );
    if (choice === "Install Cursor hooks") {
      vscode.commands.executeCommand("infernoflow.cliInstallCursor");
    }
    return;
  }

  const transcript = fs.readFileSync(draftPath, "utf8");
  if (transcript.trim().length < 50) {
    vscode.window.showInformationMessage("Draft is empty or very short — nothing to summarize yet.");
    return;
  }

  // Run the summarization with progress UI
  const entries = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title:    "infernoflow: summarizing session…",
      cancellable: false,
    },
    () => summarizeViaProvider(transcript),
  );

  if (entries.length === 0) {
    const choice = await vscode.window.showWarningMessage(
      "No entries extracted. The AI provider may not be configured, or there may be nothing notable in this session.",
      "Run `infernoflow ai setup`",
    );
    if (choice) vscode.commands.executeCommand("infernoflow.cliAiSetup");
    return;
  }

  // Show in multi-select quick-pick — user approves which to save
  const ICON: Record<string, string> = {
    gotcha: "$(warning)", decision: "$(check)", attempt: "$(error)", note: "$(note)",
  };
  type PickItem = vscode.QuickPickItem & { entry: CandidateEntry };
  const items: PickItem[] = entries.map(e => ({
    label:       `${ICON[e.type] || "$(circle-small)"} ${e.msg}`,
    description: e.file ? `${e.file}${e.line ? ":" + e.line : ""}` : "",
    detail:      e.type,
    picked:      true,   // pre-select all — user unticks anything they don't want
    entry:       e,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title:       `Summarize session — ${entries.length} entries proposed by AI. Tick to keep, untick to skip.`,
    placeHolder: "Confirm with Enter. Cancel with Escape.",
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail:      true,
  });
  if (!picked || picked.length === 0) return;

  // Save approved entries via ampIO.write (same path as manual logging)
  let saved = 0;
  for (const p of picked) {
    const w = ampIO.write({
      type: p.entry.type,
      msg:  p.entry.msg,
      file: p.entry.file,
      line: p.entry.line,
      source: "ai-summarize",
    });
    if (w) saved++;
  }
  vscode.window.showInformationMessage(
    `🧠 Saved ${saved}/${picked.length} AI-summarized entr${saved === 1 ? "y" : "ies"}.`,
  );
}
