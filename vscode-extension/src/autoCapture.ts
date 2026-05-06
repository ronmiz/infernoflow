/**
 * AutoCapture — repeated-edit detector.
 *
 * Watches text-document changes. When the same file accumulates N edits within
 * a sliding time window, prompts the user with:
 *
 *   🔥 You've edited <file> 5 times in 10 minutes. Stuck on something?
 *   [Log Gotcha] [Log Attempt] [Dismiss]
 *
 * Clicking a button **auto-logs** an entry with a smart, context-aware default
 * message (no typing required). The message includes the file, the active
 * cursor line, the edit count, and any nearby diagnostics (TypeScript /
 * ESLint errors at or near the cursor line). After auto-logging, a follow-up
 * notification offers a "Refine" button so the user can replace the
 * default message if they want — but the friction is opt-in, not default.
 *
 * After a popup fires for a file, that file is muted for `cooldownMs` so we
 * don't spam the same warning every keystroke.
 *
 * Configurable via:
 *   infernoflow.autoCapture.repeatedEdits           (boolean, default true)
 *   infernoflow.autoCapture.repeatedEditsThreshold  (number,  default 5)
 */

import * as vscode from "vscode";

const TIME_WINDOW_MS = 10 * 60 * 1000;   // 10 minutes
const COOLDOWN_MS    = 60 * 1000;        // 60s mute after a popup fires

/**
 * Build a contextual default message so the user doesn't have to type.
 *
 * Captures REAL information, not just "stuck on X" vibes:
 *   1. The exact line of code at the cursor (truncated to ~80 chars)
 *   2. The function or symbol the cursor is inside (heuristic regex search)
 *   3. The FULL diagnostic messages from VS Code (not just first line),
 *      including suggested fixes that come after newlines.
 *   4. Edit count + file:line for traceability.
 *
 * The opening phrasing is randomized only so 20 entries in the sidebar
 * don't look identical. The MEANING comes from the captured code + errors.
 */
function buildAutoMessage(file: string, edits: number): { text: string; line?: number } {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.fsPath.replace(/\\/g, "/").indexOf(file) === -1) {
    return { text: `Stuck on ${file} (${edits} edits in 10 min). No active editor — capture details manually.` };
  }

  const cursorLine = editor.selection.active.line;
  const line       = cursorLine + 1;
  const ref        = `${file}:${line}`;

  // 1. Multi-line code snippet — 2 lines before, cursor line, 2 lines after.
  //    The cursor line is marked with a leading ">" so future readers can see
  //    exactly where the user was. Lines truncated to 100 chars each.
  const snippet = collectCodeContext(editor.document, cursorLine, /* lines either side */ 2);

  // 2. Try to identify the enclosing symbol (function / class / const = …)
  const enclosingSymbol = findEnclosingSymbol(editor.document, cursorLine);

  // 3. Full diagnostic messages within ±5 lines (wider window for richer context)
  const diags = vscode.languages.getDiagnostics(editor.document.uri)
    .filter(d => Math.abs(d.range.start.line - cursorLine) <= 5)
    .slice(0, 4);
  const diagText = diags
    .map(d => {
      const sev   = d.severity === vscode.DiagnosticSeverity.Error ? "⛔" : "⚠";
      const clean = d.message.replace(/\s+/g, " ").trim();
      return `${sev} ${clean}`;
    })
    .join(" | ");

  // Random opener — variety only, no information loss if it changes
  const openers = [
    `🐛 Landmine at`,
    `🌀 Kept circling`,
    `🪤 Bite-back at`,
    `⚠ Friction zone:`,
    `💣 Hot spot:`,
    `🔁 Tight loop on`,
    `🧱 Wall hit at`,
    `🔥 Stuck on`,
  ];
  const opener = openers[Math.floor(Math.random() * openers.length)];

  // Compose
  const parts: string[] = [];
  parts.push(`[${formatStamp(Date.now())}]`);
  parts.push(`${opener} ${ref}${enclosingSymbol ? ` in ${enclosingSymbol}` : ""}.`);
  parts.push(`${edits} edits in 10 min.`);
  if (snippet)  parts.push(`\nContext:\n${snippet}`);
  if (diagText) parts.push(`\nDiagnostics: ${diagText}`);

  // Cap total length so AMP entries stay readable but we allow more room now
  let text = parts.join(" ").trim();
  if (text.length > 1200) text = text.slice(0, 1197) + "…";

  return { text, line };
}

/**
 * Build a multi-line code context block around `cursorLine`. Cursor's own
 * line is marked with `>` so the reader can see exactly where the user was.
 *
 *   23 |   const url = baseUrl + path;
 *   24 |   const headers = { ... };
 * > 25 |   const result = await fetch(foo, { method: 'GET' });
 *   26 |   const data = await result.json();
 *   27 |   return data;
 */
function collectCodeContext(doc: vscode.TextDocument, cursorLine: number, span: number): string {
  const startLine = Math.max(0, cursorLine - span);
  const endLine   = Math.min(doc.lineCount - 1, cursorLine + span);
  const out: string[] = [];
  const maxLineLen = 100;

  // Pad the line-number column so the output aligns even at file start
  const numWidth = String(endLine + 1).length;

  for (let i = startLine; i <= endLine; i++) {
    const marker = i === cursorLine ? ">" : " ";
    const num    = String(i + 1).padStart(numWidth, " ");
    let raw      = doc.lineAt(i).text.replace(/\t/g, "  ");
    if (raw.length > maxLineLen) raw = raw.slice(0, maxLineLen - 1) + "…";
    out.push(`${marker} ${num} | ${raw}`);
  }
  return out.join("\n");
}

/** Format a Unix-ms timestamp as `YYYY-MM-DD HH:MM` for inline message prefix. */
function formatStamp(ms: number): string {
  const d  = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Heuristic: walk backwards from the cursor line to find the enclosing
 * function / arrow-function / class / method name. No AST — just regex on
 * a few common JS/TS/Python/Go patterns. Returns undefined if nothing matches.
 */
function findEnclosingSymbol(doc: vscode.TextDocument, fromLine: number): string | undefined {
  const PATTERNS: RegExp[] = [
    /\bfunction\s+([A-Za-z_$][\w$]*)/,
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
    /\blet\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
    /\bclass\s+([A-Za-z_$][\w$]*)/,
    /\b([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,            // method or fn shorthand
    /\bdef\s+([A-Za-z_][\w]*)/,                          // python
    /\bfunc\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)/,        // go
  ];
  const start = Math.max(0, fromLine - 60);              // look back up to 60 lines
  for (let i = fromLine; i >= start; i--) {
    const text = doc.lineAt(i).text;
    for (const pat of PATTERNS) {
      const m = text.match(pat);
      if (m && m[1]) return m[1] + "()";
    }
  }
  return undefined;
}

export class AutoCapture implements vscode.Disposable {
  private editTimestamps = new Map<string, number[]>();
  private mutedUntil     = new Map<string, number>();
  private subscription:  vscode.Disposable;

  constructor() {
    this.subscription = vscode.workspace.onDidChangeTextDocument(e => {
      this.onEdit(e.document).catch(() => { /* never let a popup error crash the watcher */ });
    });
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("infernoflow")
      .get<boolean>("autoCapture.repeatedEdits", true);
  }

  private threshold(): number {
    const n = vscode.workspace
      .getConfiguration("infernoflow")
      .get<number>("autoCapture.repeatedEditsThreshold", 5);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
  }

  /** Skip files we shouldn't track (memory files themselves, output channels, etc.). */
  private shouldIgnore(uri: vscode.Uri): boolean {
    if (uri.scheme !== "file") return true;                       // output/setting/etc.
    const fp = uri.fsPath.replace(/\\/g, "/");
    if (fp.includes("/.ai-memory/")) return true;                 // AMP storage
    if (fp.includes("/inferno/sessions.jsonl")) return true;      // legacy storage
    if (fp.endsWith("/handoff.md")) return true;                  // generated output
    return false;
  }

  private async onEdit(doc: vscode.TextDocument): Promise<void> {
    if (!this.isEnabled()) return;
    if (this.shouldIgnore(doc.uri)) return;

    // Must be inside the workspace
    const rel = vscode.workspace.asRelativePath(doc.uri, false);
    if (rel === doc.uri.fsPath) return;

    const now = Date.now();
    const muted = this.mutedUntil.get(rel) ?? 0;
    if (now < muted) return;                                       // still in cooldown

    // Append + trim outside the sliding window
    const stamps = (this.editTimestamps.get(rel) ?? []).filter(t => t >= now - TIME_WINDOW_MS);
    stamps.push(now);
    this.editTimestamps.set(rel, stamps);

    if (stamps.length < this.threshold()) return;

    // Trip — mute and clear so we don't fire again until cooldown elapses
    this.mutedUntil.set(rel, now + COOLDOWN_MS);
    this.editTimestamps.set(rel, []);

    const choice = await vscode.window.showWarningMessage(
      `🔥 You've edited ${rel} ${stamps.length} times in 10 minutes. Stuck on something?`,
      "Log Gotcha",
      "Log Attempt",
      "Dismiss",
    );

    if (choice !== "Log Gotcha" && choice !== "Log Attempt") return;

    // Auto-log with a smart default message — no typing required.
    const type = choice === "Log Gotcha" ? "gotcha" : "attempt";
    const auto = buildAutoMessage(rel, stamps.length);
    await vscode.commands.executeCommand(
      type === "gotcha" ? "infernoflow.logGotchaAuto" : "infernoflow.logAttemptAuto",
      { msg: auto.text, file: rel, line: auto.line },
    );
  }

  dispose(): void {
    this.subscription.dispose();
    this.editTimestamps.clear();
    this.mutedUntil.clear();
  }
}
