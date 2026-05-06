/**
 * Diagnostics — surface gotchas as VS Code Warnings in the Problems panel.
 *
 * Range matching is intentionally simple per the locked plan:
 *   - if entry.line is set → that line
 *   - else → line 1
 * Function-name and keyword fallbacks are deferred to v0.4+.
 *
 * Both the developer AND any AI tool reading diagnostics (Copilot reads the
 * Problems panel) see warnings BEFORE making the same mistake again. That's
 * the whole point.
 */

import * as vscode from "vscode";
import { ampIO } from "./amp";

const SOURCE = "infernoflow";

export class InfernoDiagnostics {
  private collection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection(SOURCE);
  }

  attach(): void {
    // Build initial set
    this.refreshAll();
    // Refresh whenever sessions.jsonl changes
    this.disposables.push(ampIO.onChange(() => this.refreshAll()));
    // Refresh whenever the user opens or switches editors
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.refreshAll()));
    this.disposables.push(vscode.workspace.onDidOpenTextDocument(() => this.refreshAll()));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("infernoflow.showDiagnostics")) this.refreshAll();
    }));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.collection.dispose();
  }

  private refreshAll(): void {
    this.collection.clear();
    const cfg = vscode.workspace.getConfiguration("infernoflow");
    if (!cfg.get<boolean>("showDiagnostics", true)) return;
    if (!ampIO.isAttached() || !ampIO.isInitialised()) return;

    for (const editor of vscode.window.visibleTextEditors) {
      this.refreshDocument(editor.document);
    }
    // Also include the active editor if it's not in visible editors yet
    const active = vscode.window.activeTextEditor?.document;
    if (active) this.refreshDocument(active);
  }

  private refreshDocument(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== "file") return;
    const entries = ampIO.forFile(doc.uri.fsPath).filter(
      e => e.type === "gotcha" || e.type === "attempt",
    );
    if (entries.length === 0) {
      this.collection.delete(doc.uri);
      return;
    }
    const diags: vscode.Diagnostic[] = entries.map(entry => {
      const targetLine = entry.line && entry.line > 0
        ? Math.min(entry.line - 1, Math.max(0, doc.lineCount - 1))
        : 0;
      const range = doc.lineAt(targetLine).range;
      // Gotchas → Warning (yellow squiggle), Failed Attempts → Information (blue squiggle)
      const isGotcha = entry.type === "gotcha";
      const severity = isGotcha
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
      const prefix = isGotcha ? "🔥 gotcha" : "❌ failed attempt";
      const diag = new vscode.Diagnostic(range, `${prefix}: ${entry.msg}`, severity);
      diag.source = SOURCE;
      diag.code = entry.type;
      return diag;
    });
    this.collection.set(doc.uri, diags);
  }
}
