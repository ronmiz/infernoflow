/**
 * Command handlers — log gotcha/decision/attempt/note, ask, switch, recap.
 *
 * Reads/writes go through the AMP I/O wrapper (native, no shelling).
 * `switch` and `recap` shell out to the CLI for the heavy formatting and
 * the handoff-file write — those flows are richer in the CLI than worth
 * re-implementing here.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import { ampIO } from "./amp";
import type { EntryType } from "infernoflow-amp";

// ── Helpers ──────────────────────────────────────────────────────────────────

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function notify(msg: string): void {
  const cfg = vscode.workspace.getConfiguration("infernoflow");
  const level = cfg.get<string>("notifications", "important");
  if (level === "none") return;
  vscode.window.showInformationMessage(msg);
}

function notifyImportant(msg: string): void {
  const cfg = vscode.workspace.getConfiguration("infernoflow");
  const level = cfg.get<string>("notifications", "important");
  if (level === "none") return;
  vscode.window.showInformationMessage(msg);
}

/** Capture the active editor's file/line at command-invocation time. */
function activeFileContext(): { file?: string; line?: number } {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return {};
  const root = workspaceRoot();
  const abs  = editor.document.uri.fsPath;
  const file = root ? path.relative(root, abs).replace(/\\/g, "/") : abs;
  const line = editor.selection.active.line + 1;
  return { file, line };
}

function runCli(args: string[], options: { capture?: boolean } = {}): { stdout: string; stderr: string; status: number } {
  const cwd = workspaceRoot();
  if (!cwd) return { stdout: "", stderr: "no workspace", status: 1 };
  const cli = vscode.workspace.getConfiguration("infernoflow").get<string>("cliPath", "infernoflow");
  const result = spawnSync(cli, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 30_000,
    shell: process.platform === "win32",
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  };
}

// ── Log handlers (one per type) ──────────────────────────────────────────────

const TYPE_PROMPTS: Record<EntryType, { prompt: string; placeholder: string }> = {
  gotcha:    { prompt: "🔥 Log a gotcha (a landmine for the next person)",   placeholder: "e.g., API returns 200 on errors, check the response body" },
  decision:  { prompt: "🔥 Log a decision (architectural choice)",           placeholder: "e.g., Use axios for all HTTP — consistency over fetch" },
  attempt:   { prompt: "🔥 Log a failed attempt (don't repeat)",             placeholder: "e.g., Tried react-query — performance was worse" },
  note:      { prompt: "🔥 Log a note (general context)",                    placeholder: "e.g., Search filters client-side until backend endpoint exists" },
  detection: { prompt: "🔥 Log an auto-detected observation",                placeholder: "" },
  pattern:   { prompt: "🔥 Log a recurring pattern",                          placeholder: "" },
};

async function logEntry(type: EntryType): Promise<void> {
  if (!ampIO.isInitialised()) {
    const choice = await vscode.window.showWarningMessage(
      "infernoflow not initialised in this workspace.",
      "Run infernoflow init",
    );
    if (choice) {
      vscode.commands.executeCommand("workbench.action.terminal.new");
    }
    return;
  }
  const { prompt, placeholder } = TYPE_PROMPTS[type];
  const msg = await vscode.window.showInputBox({ prompt, placeHolder: placeholder, ignoreFocusOut: true });
  if (!msg || !msg.trim()) return;
  const ctx = activeFileContext();
  const written = ampIO.write({ type, msg: msg.trim(), file: ctx.file, line: ctx.line });
  if (!written) return;
  const fileSuffix = ctx.file ? ` (${ctx.file}${ctx.line ? ":" + ctx.line : ""})` : "";
  notifyImportant(`🔥 Logged ${type}${fileSuffix}`);
}

// ── Ask ──────────────────────────────────────────────────────────────────────

async function askCommand(): Promise<void> {
  if (!ampIO.isInitialised()) {
    vscode.window.showInformationMessage("No memory yet — log a gotcha first.");
    return;
  }
  const query = await vscode.window.showInputBox({
    prompt: "🔍 Search session memory",
    placeHolder: "keyword, file name, or error fragment",
    ignoreFocusOut: true,
  });
  if (!query) return;

  const q = query.toLowerCase();
  const matches = ampIO.readEntries().filter(e =>
    e.msg.toLowerCase().includes(q) ||
    (e.file && e.file.toLowerCase().includes(q)) ||
    (e.tags && e.tags.some(t => t.toLowerCase().includes(q))),
  );

  if (matches.length === 0) {
    notify(`No matches for "${query}"`);
    return;
  }
  // Render in a Quick Pick — sorted gotcha → decision → attempt → other, newest first
  const order: Record<string, number> = { gotcha: 0, decision: 1, attempt: 2, note: 3, detection: 4, pattern: 5 };
  matches.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || b.ts - a.ts);

  const ICON: Record<string, string> = { gotcha: "⚠", decision: "✓", attempt: "✗", note: "·", detection: "○", pattern: "◇" };
  const items = matches.map(e => ({
    label: `${ICON[e.type] || "·"} ${e.msg}`,
    description: e.file ? `${e.file}${e.line ? ":" + e.line : ""}` : "",
    detail: `${e.type} · ${new Date(e.ts).toLocaleString()}`,
    entry: e,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: `${matches.length} match${matches.length === 1 ? "" : "es"} for "${query}"`,
  });
  if (!picked || !picked.entry.file) return;
  // Open the file at the line if available
  const root = workspaceRoot();
  if (!root) return;
  const abs = path.isAbsolute(picked.entry.file) ? picked.entry.file : path.join(root, picked.entry.file);
  const lineNo = picked.entry.line ? picked.entry.line - 1 : 0;
  vscode.commands.executeCommand("vscode.open", vscode.Uri.file(abs), {
    selection: new vscode.Range(lineNo, 0, lineNo, 0),
  });
}

// ── Switch (shell out to CLI for handoff generation) ─────────────────────────

async function switchCommand(): Promise<void> {
  if (!ampIO.isInitialised()) {
    vscode.window.showInformationMessage("No memory yet — log a gotcha first.");
    return;
  }
  const result = runCli(["switch", "--copy"]);
  if (result.status !== 0) {
    vscode.window.showErrorMessage(`infernoflow switch failed: ${result.stderr || result.stdout}`);
    return;
  }
  // Open the handoff in a side editor for review
  const cwd = workspaceRoot();
  if (cwd) {
    const ampPath    = path.join(cwd, ".ai-memory", "handoff.md");
    const legacyPath = path.join(cwd, "inferno", "HANDOFF.md");
    const target = fs.existsSync(ampPath) ? ampPath : (fs.existsSync(legacyPath) ? legacyPath : undefined);
    if (target) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    }
  }
  notifyImportant("📋 Handoff copied to clipboard — paste into your next AI chat");
}

// ── Recap (shell out to CLI, render in a temp Markdown editor) ──────────────

async function recapCommand(): Promise<void> {
  const result = runCli(["recap"]);
  if (result.status !== 0) {
    vscode.window.showErrorMessage(`infernoflow recap failed: ${result.stderr || result.stdout}`);
    return;
  }
  // Strip ANSI escapes for clean markdown view
  const clean = result.stdout.replace(/\[[0-9;]*[A-Za-z]/g, "");
  const doc = await vscode.workspace.openTextDocument({
    content: clean,
    language: "markdown",
  });
  vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

// ── Migrate ──────────────────────────────────────────────────────────────────

async function migrateCommand(): Promise<void> {
  const res = ampIO.migrate();
  if (res.migrated > 0) {
    notify(`✓ Migrated ${res.migrated} entries → .ai-memory/sessions.jsonl`);
  } else {
    vscode.window.showInformationMessage(`Nothing migrated — ${res.reason}`);
  }
}

// ── Open the sidebar panel ──────────────────────────────────────────────────

function openPanelCommand(): void {
  vscode.commands.executeCommand("workbench.view.extension.infernoflow");
}

// ── Public registration ─────────────────────────────────────────────────────

export function registerCommands(context: vscode.ExtensionContext, refresh: () => void): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("infernoflow.logGotcha",   async () => { await logEntry("gotcha");   refresh(); });
  reg("infernoflow.logDecision", async () => { await logEntry("decision"); refresh(); });
  reg("infernoflow.logAttempt",  async () => { await logEntry("attempt");  refresh(); });
  reg("infernoflow.logNote",     async () => { await logEntry("note");     refresh(); });
  reg("infernoflow.ask",         askCommand);
  reg("infernoflow.switch",      switchCommand);
  reg("infernoflow.recap",       recapCommand);
  reg("infernoflow.refresh",     () => refresh());
  reg("infernoflow.openPanel",   openPanelCommand);
  reg("infernoflow.migrateAmp",  async () => { await migrateCommand(); refresh(); });
}
