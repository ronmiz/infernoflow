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
import { rebuildAiRuleFiles } from "./contextSync";
import { summarizeSessionCommand } from "./summarize";
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

// ── Reusable terminal for CLI commands ──────────────────────────────────────
// One shared "infernoflow" terminal — persists scrollback across runs so users
// can compare output between commands. We don't dispose it on command end;
// VS Code recycles closed terminals automatically.

let infernoflowTerminal: vscode.Terminal | undefined;

function getOrCreateTerminal(): vscode.Terminal {
  // If the user closed the terminal manually, the previous reference is stale;
  // VS Code's vscode.window.terminals reflects the live set.
  const live = infernoflowTerminal && vscode.window.terminals.includes(infernoflowTerminal);
  if (!live) {
    infernoflowTerminal = vscode.window.createTerminal({
      name: "infernoflow",
      cwd: workspaceRoot(),
    });
  }
  return infernoflowTerminal!;
}

/** Run an infernoflow CLI command in the reusable terminal — streaming output. */
function runInTerminal(cliArgs: string): void {
  const cli  = vscode.workspace.getConfiguration("infernoflow").get<string>("cliPath", "infernoflow");
  const term = getOrCreateTerminal();
  term.show(/* preserveFocus */ false);
  term.sendText(`${cli} ${cliArgs}`);
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

// ── Auto-log (called by AutoCapture; no input box) ──────────────────────────
//
// AutoCapture builds a context-aware default message and calls these commands.
// We log immediately, then surface a non-blocking "Refine" notification so the
// user can replace the auto-message if they want — but the friction is opt-in.

interface AutoLogArgs {
  msg: string;
  file?: string;
  line?: number;
}

async function logEntryAuto(type: EntryType, args: AutoLogArgs): Promise<void> {
  if (!ampIO.isInitialised()) return; // silent: AutoCapture shouldn't have fired
  const trimmed = (args?.msg || "").trim();
  if (!trimmed) return;

  const written = ampIO.write({ type, msg: trimmed, file: args.file, line: args.line });
  if (!written) return;

  const fileSuffix = args.file ? ` (${args.file}${args.line ? ":" + args.line : ""})` : "";
  const refine = "Refine message";
  const action = await vscode.window.showInformationMessage(
    `🔥 Auto-logged ${type}${fileSuffix}`,
    refine,
  );

  if (action === refine) {
    const updated = await vscode.window.showInputBox({
      prompt:        `Refine ${type} message`,
      value:         trimmed,
      ignoreFocusOut: true,
    });
    if (updated && updated.trim() && updated.trim() !== trimmed) {
      ampIO.write({ type, msg: updated.trim(), file: args.file, line: args.line });
      vscode.window.showInformationMessage(`🔥 Updated ${type}${fileSuffix}`);
    }
  }
}

// ── Show full entry detail (invoked by per-line CodeLens) ───────────────────

async function showEntryCommand(entry: unknown): Promise<void> {
  if (!entry || typeof entry !== "object") return;
  const e = entry as { id?: string; type?: string; msg?: string; file?: string; line?: number; ts?: number; tags?: string[] };
  if (!e.msg) return;

  const typeLabel = e.type === "gotcha"   ? "Gotcha"
                  : e.type === "attempt"  ? "Failed Attempt"
                  : e.type === "decision" ? "Decision"
                  :                         "Note";
  const fileSuffix = e.file ? `${e.file}${e.line ? ":" + e.line : ""}` : "";
  const stamp = e.ts ? new Date(e.ts).toLocaleString() : "";

  const items: Array<{ label: string; action: string }> = [
    { label: "$(go-to-file) Open file",      action: "open"   },
    { label: "$(clippy) Copy message",       action: "copy"   },
    { label: "$(trash) Delete this entry",   action: "delete" },
    { label: "$(close) Dismiss",             action: "close"  },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title:       `${typeLabel} — ${stamp}`,
    placeHolder: e.msg,
    matchOnDescription: true,
  });
  if (!picked) return;

  if (picked.action === "open" && e.file) {
    const root = workspaceRoot();
    if (!root) return;
    const abs = path.isAbsolute(e.file) ? e.file : path.join(root, e.file);
    const lineNo = e.line ? e.line - 1 : 0;
    vscode.commands.executeCommand("vscode.open", vscode.Uri.file(abs), {
      selection: new vscode.Range(lineNo, 0, lineNo, 0),
    });
  } else if (picked.action === "copy") {
    await vscode.env.clipboard.writeText(e.msg);
    notify("Copied to clipboard");
  } else if (picked.action === "delete") {
    await deleteEntryCommand(e);
  }
  // suppress unused-var warning
  void fileSuffix;
}

/**
 * Soft-prompt invoked when the user clicks an orphaned entry (one whose
 * file no longer exists on disk). Asks whether to delete the entry or keep
 * it for historical context — never silently errors with "file not found".
 */
async function handleOrphanedCommand(entry: unknown): Promise<void> {
  if (!entry || typeof entry !== "object") return;
  const e = entry as { id?: string; type?: string; msg?: string; file?: string; line?: number };
  if (!e.id) return;

  const ref = e.file ? `${e.file}${e.line ? ":" + e.line : ""}` : "(no file)";
  const preview = (e.msg || "").slice(0, 80) + (e.msg && e.msg.length > 80 ? "…" : "");
  const choice = await vscode.window.showWarningMessage(
    `The file at \`${ref}\` no longer exists.\n\n"${preview}"\n\nWhat do you want to do with this ${e.type || "entry"}?`,
    { modal: true },
    "Delete entry",
    "Keep for history",
  );

  if (choice === "Delete entry") {
    if (ampIO.deleteEntry(e.id)) {
      vscode.window.showInformationMessage(`Deleted orphaned ${e.type || "entry"}.`);
    }
  }
  // "Keep for history" → no-op; entry remains marked as orphaned in the sidebar.
}

/**
 * Bulk cleanup picker pre-filtered to ORPHANED entries only — those whose
 * file path no longer exists. Same UX as manageEntries but scoped to the
 * "stale entries from a refactor" use case.
 */
async function cleanupOrphanedCommand(): Promise<void> {
  if (!ampIO.isInitialised()) {
    vscode.window.showInformationMessage("No memory yet — log a gotcha first.");
    return;
  }
  const root = workspaceRoot();
  if (!root) return;

  const orphaned = ampIO.readEntries().filter(e => {
    if (!e.file) return false;
    const abs = path.isAbsolute(e.file) ? e.file : path.join(root, e.file);
    return !fs.existsSync(abs);
  });

  if (orphaned.length === 0) {
    vscode.window.showInformationMessage("No orphaned entries — every entry's file still exists.");
    return;
  }

  const ICON: Record<string, string> = {
    gotcha: "$(warning)", decision: "$(check)", attempt: "$(error)",
    note: "$(note)", detection: "$(eye)", pattern: "$(symbol-event)",
  };

  type PickItem = vscode.QuickPickItem & { entryId?: string };
  const items: PickItem[] = orphaned
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .map(e => {
      const fileSuffix = e.file ? `${e.file}${e.line ? ":" + e.line : ""}` : "";
      const msgPreview = e.msg.length > 100 ? e.msg.slice(0, 97) + "…" : e.msg;
      return {
        label:       `${ICON[e.type] || "$(circle-small)"} ${msgPreview}`,
        description: fileSuffix,
        detail:      `${e.type} · ${new Date(e.ts).toLocaleString()} · file no longer exists`,
        entryId:     e.id,
      };
    });

  const picked = await vscode.window.showQuickPick(items, {
    title:       `Cleanup Orphaned Entries — ${orphaned.length} found. Tick the ones to delete.`,
    placeHolder: `Type to filter. Toggle items with Space, confirm with Enter.`,
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail:      true,
  });
  if (!picked || picked.length === 0) return;

  const toDelete = picked.map(p => p.entryId).filter((x): x is string => !!x);
  if (toDelete.length === 0) return;

  const confirm = await vscode.window.showWarningMessage(
    `Delete ${toDelete.length} orphaned entr${toDelete.length === 1 ? "y" : "ies"}? This cannot be undone.`,
    { modal: true },
    "Delete",
  );
  if (confirm !== "Delete") return;

  const removed = ampIO.deleteEntries(toDelete);
  vscode.window.showInformationMessage(
    `Deleted ${removed} orphaned entr${removed === 1 ? "y" : "ies"}.`,
  );
}

/**
 * Bulk cleanup picker. Opens a multi-select quick-pick of every entry,
 * grouped by date bucket (Today / Yesterday / Last 7 days / Older), so the
 * user can scan and tick off everything they want gone in one go.
 *
 * The picker supports VS Code's built-in fuzzy search across both the
 * message and the description (file:line + age), so users can also type
 * something like "TaskComposer" or "search" to narrow before selecting.
 */
async function manageEntriesCommand(): Promise<void> {
  if (!ampIO.isInitialised()) {
    vscode.window.showInformationMessage("No memory yet — log a gotcha first.");
    return;
  }
  const entries = ampIO.readEntries();
  if (entries.length === 0) {
    vscode.window.showInformationMessage("No entries to manage.");
    return;
  }

  // Sort newest first so the user scans recent → old top-to-bottom
  const sorted = entries.slice().sort((a, b) => b.ts - a.ts);

  const ICON: Record<string, string> = {
    gotcha:    "$(warning)",
    decision:  "$(check)",
    attempt:   "$(error)",
    note:      "$(note)",
    detection: "$(eye)",
    pattern:   "$(symbol-event)",
  };

  // Bucket by age. We use VS Code's QuickPickItemKind.Separator to render
  // visual section headers between buckets — no checkbox, just a label.
  const today    = startOfDay(Date.now()).getTime();
  const yest     = today - 86_400_000;
  const week     = today - 7 * 86_400_000;

  type PickItem = vscode.QuickPickItem & { entryId?: string };
  const items: PickItem[] = [];

  let bucket = "";
  for (const e of sorted) {
    const newBucket =
      e.ts >= today ? "Today" :
      e.ts >= yest  ? "Yesterday" :
      e.ts >= week  ? "Last 7 days" :
                      "Older";
    if (newBucket !== bucket) {
      items.push({ label: newBucket, kind: vscode.QuickPickItemKind.Separator });
      bucket = newBucket;
    }
    const fileSuffix = e.file ? `${e.file}${e.line ? ":" + e.line : ""}` : "";
    const msgPreview = e.msg.length > 100 ? e.msg.slice(0, 97) + "…" : e.msg;
    items.push({
      label:       `${ICON[e.type] || "$(circle-small)"} ${msgPreview}`,
      description: fileSuffix,
      detail:      `${e.type} · ${formatTimeAgo(e.ts)} · ${new Date(e.ts).toLocaleString()}`,
      entryId:     e.id,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title:       `Manage Entries — ${entries.length} total. Pick the ones to delete.`,
    placeHolder: `Type to filter. Toggle items with Space, confirm with Enter.`,
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail:      true,
  });
  if (!picked || picked.length === 0) return;

  const toDelete = picked.map(p => p.entryId).filter((x): x is string => !!x);
  if (toDelete.length === 0) return;

  const confirm = await vscode.window.showWarningMessage(
    `Delete ${toDelete.length} entr${toDelete.length === 1 ? "y" : "ies"}? This cannot be undone.`,
    { modal: true },
    "Delete",
  );
  if (confirm !== "Delete") return;

  const removed = ampIO.deleteEntries(toDelete);
  vscode.window.showInformationMessage(
    `Deleted ${removed} entr${removed === 1 ? "y" : "ies"}.`,
  );
}

function startOfDay(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)         return "just now";
  if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400)     return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Delete a single entry by id. Confirms first, then rewrites the JSONL
 * minus the entry. Invoked from the showEntry quick-pick or from the
 * right-click context menu on a sidebar tree row.
 */
async function deleteEntryCommand(entry: unknown): Promise<void> {
  if (!entry || typeof entry !== "object") return;
  const e = entry as { id?: string; type?: string; msg?: string };
  if (!e.id) {
    vscode.window.showWarningMessage("Cannot delete: this entry has no id (probably from a very old format).");
    return;
  }
  const preview = (e.msg || "").slice(0, 60) + (e.msg && e.msg.length > 60 ? "…" : "");
  const choice = await vscode.window.showWarningMessage(
    `Delete this ${e.type || "entry"}?\n\n"${preview}"\n\nThis cannot be undone.`,
    { modal: true },
    "Delete",
  );
  if (choice !== "Delete") return;
  const ok = ampIO.deleteEntry(e.id);
  if (ok) {
    vscode.window.showInformationMessage(`Deleted ${e.type || "entry"}.`);
  } else {
    vscode.window.showErrorMessage("Could not delete entry — see the Output panel for details.");
  }
}

// ── Public registration ─────────────────────────────────────────────────────

export function registerCommands(context: vscode.ExtensionContext, refresh: () => void): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // Memory ops (the core loop)
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
  reg("infernoflow.showEntry",   async (entry: unknown) => { await showEntryCommand(entry); });
  reg("infernoflow.deleteEntry", async (item: unknown) => {
    // Two call paths: from the quick-pick (passes entry directly) or from the
    // tree right-click menu (passes the TreeItem whose `entry` property holds the data).
    const entry = (item && typeof item === "object" && "entry" in (item as Record<string, unknown>))
      ? (item as { entry: unknown }).entry
      : item;
    await deleteEntryCommand(entry);
    refresh();
  });
  reg("infernoflow.manageEntries", async () => { await manageEntriesCommand(); refresh(); });
  reg("infernoflow.cleanupOrphaned", async () => { await cleanupOrphanedCommand(); refresh(); });
  reg("infernoflow.handleOrphaned",  async (entry: unknown) => { await handleOrphanedCommand(entry); refresh(); });
  reg("infernoflow.summarizeSession", async () => { await summarizeSessionCommand(); refresh(); });
  reg("infernoflow.rebuildAiRules",  async () => {
    const editor = vscode.window.activeTextEditor;
    const root   = workspaceRoot();
    let activeFile: string | undefined;
    if (editor && root && editor.document.uri.scheme === "file") {
      activeFile = path.relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
    }
    const result = rebuildAiRuleFiles(activeFile);
    if (result.updated === 0) {
      notifyImportant("AI rule files already up to date.");
    } else {
      notifyImportant(`🔄 Rebuilt ${result.updated}/${result.total} AI rule files (.cursorrules · CLAUDE.md · copilot-instructions.md).`);
    }
    refresh();
  });

  // Auto-log (no input box) — invoked by AutoCapture. Args carry pre-built msg.
  reg("infernoflow.logGotchaAuto",  async (args: unknown) => { await logEntryAuto("gotcha",  args as AutoLogArgs); refresh(); });
  reg("infernoflow.logAttemptAuto", async (args: unknown) => { await logEntryAuto("attempt", args as AutoLogArgs); refresh(); });

  // CLI passthrough commands — all run in the reusable "infernoflow" terminal.
  // Output streams live; user sees what's happening in real time.
  reg("infernoflow.cliStatus",        () => runInTerminal("status"));
  reg("infernoflow.cliCheck",         () => runInTerminal("check"));
  reg("infernoflow.cliDoctor",        () => runInTerminal("doctor"));
  reg("infernoflow.cliScan",          () => runInTerminal("scan"));
  reg("infernoflow.cliInitAdopt",     () => runInTerminal("init --adopt"));
  reg("infernoflow.cliSetup",         () => runInTerminal("setup"));
  reg("infernoflow.cliAiSetup",       () => runInTerminal("ai setup"));
  reg("infernoflow.cliInstallCursor", () => runInTerminal("install-cursor-hooks"));
  reg("infernoflow.cliWatch",         () => runInTerminal("watch"));
  reg("infernoflow.cliCodeMap",       () => runInTerminal("contract graph --html"));
  reg("infernoflow.cliContext",       () => runInTerminal("context"));
}
