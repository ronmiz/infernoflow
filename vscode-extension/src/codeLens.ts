/**
 * CodeLens provider — inline memory annotations.
 *
 * For any file with infernoflow entries, shows two kinds of CodeLens:
 *
 *   1. File header (line 0)
 *      Format: $(flame) ⚠ 2 gotchas · ❌ 1 failed · ✓ 1 decision
 *      Click → opens "Ask Memory" command pre-filtered to this file.
 *
 *   2. Per-line indicators
 *      For each gotcha/attempt with `entry.line` set, render a CodeLens at
 *      that line:  ⚠ <truncated msg>
 *      Click → opens a quick-pick with the entry's full text + metadata.
 *
 * Refreshes whenever ampIO fires a change event (CLI write, file edit, etc.).
 * Respects the `infernoflow.showCodeLens` setting (default true).
 */

import * as vscode from "vscode";
import { ampIO } from "./amp";
import type { AMPEntry } from "infernoflow-amp";

const MSG_TRUNCATE = 80;

export class InfernoCodeLensProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  private subs: vscode.Disposable[] = [];

  constructor() {
    // Refresh lenses when memory changes on disk
    this.subs.push(ampIO.onChange(() => this._onDidChange.fire()));
    // Also refresh when the user toggles the setting
    this.subs.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("infernoflow.showCodeLens")) {
          this._onDidChange.fire();
        }
      }),
    );
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (!this.isEnabled()) return [];
    if (document.uri.scheme !== "file") return [];
    if (!ampIO.isAttached() || !ampIO.isInitialised()) return [];

    const entries = ampIO.forFile(document.uri.fsPath);
    if (entries.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];

    // ── File header summary ───────────────────────────────────────────────
    const counts = countByType(entries);
    const summaryParts: string[] = [];
    if (counts.gotcha)   summaryParts.push(`$(warning) ${counts.gotcha} gotcha${counts.gotcha === 1 ? "" : "s"}`);
    if (counts.attempt)  summaryParts.push(`$(error) ${counts.attempt} failed`);
    if (counts.decision) summaryParts.push(`$(check) ${counts.decision} decision${counts.decision === 1 ? "" : "s"}`);
    if (counts.note)     summaryParts.push(`$(note) ${counts.note} note${counts.note === 1 ? "" : "s"}`);

    if (summaryParts.length > 0) {
      const headerRange = new vscode.Range(0, 0, 0, 0);
      const headerLens  = new vscode.CodeLens(headerRange, {
        title:   `$(flame) ${summaryParts.join("  ·  ")}`,
        tooltip: "infernoflow — click to search memory for this file",
        command: "infernoflow.ask",
      });
      lenses.push(headerLens);
    }

    // ── Per-line entries (gotcha + attempt only — those have spatial context) ─
    const totalLines = document.lineCount;
    for (const entry of entries) {
      if (entry.type !== "gotcha" && entry.type !== "attempt") continue;
      if (!entry.line || entry.line < 1) continue;

      const zeroBasedLine = Math.min(entry.line - 1, totalLines - 1);
      const range = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0);
      const icon  = entry.type === "gotcha" ? "$(warning)" : "$(error)";
      const msg   = truncate(entry.msg, MSG_TRUNCATE);

      lenses.push(new vscode.CodeLens(range, {
        title:   `${icon} ${msg}`,
        tooltip: buildTooltip(entry),
        command: "infernoflow.showEntry",
        arguments: [entry],
      }));
    }

    return lenses;
  }

  resolveCodeLens(lens: vscode.CodeLens): vscode.CodeLens {
    // Lenses are always pre-resolved
    return lens;
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("infernoflow")
      .get<boolean>("showCodeLens", true);
  }

  dispose(): void {
    this._onDidChange.dispose();
    for (const sub of this.subs) sub.dispose();
    this.subs = [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function countByType(entries: AMPEntry[]): Record<string, number> {
  const out: Record<string, number> = {
    gotcha: 0, decision: 0, attempt: 0, note: 0, detection: 0, pattern: 0,
  };
  for (const e of entries) {
    if (out[e.type] !== undefined) out[e.type]++;
  }
  return out;
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/**
 * VS Code's `Command.tooltip` only accepts plain strings (no MarkdownString).
 * We build a multi-line plain-text tooltip with the type, timing, message,
 * and file reference — readable in the standard hover popup.
 */
function buildTooltip(entry: AMPEntry): string {
  const typeLabel = entry.type === "gotcha"   ? "Gotcha"
                  : entry.type === "attempt"  ? "Failed Attempt"
                  : entry.type === "decision" ? "Decision"
                  :                              "Note";

  const lines: string[] = [];
  lines.push(`${typeLabel} — ${formatTimeAgo(entry.ts)}`);
  lines.push("");
  lines.push(entry.msg);
  if (entry.file) {
    const ref = entry.line ? `${entry.file}:${entry.line}` : entry.file;
    lines.push("");
    lines.push(`📁 ${ref}`);
  }
  lines.push("");
  lines.push("Click to view full entry.");
  return lines.join("\n");
}

function formatTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)        return "just now";
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400)    return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(ts).toLocaleDateString();
}
