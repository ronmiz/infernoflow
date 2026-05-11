import * as vscode from 'vscode';
import { SessionStore } from './sessionStore';

export class InfernoDiagnostics {
  private collection: vscode.DiagnosticCollection;

  constructor(private store: SessionStore) {
    this.collection = vscode.languages.createDiagnosticCollection('infernoflow');
  }

  /**
   * Update diagnostics for a given document, showing gotchas as warnings
   */
  updateForDocument(document: vscode.TextDocument, workspaceRoot: string): void {
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    const entries = this.store.getForFile(relativePath);

    if (entries.length === 0) {
      this.collection.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = entries
      .filter(e => e.type === 'gotcha' || e.type === 'attempt')
      .map(e => {
        const line = e.line ? Math.max(0, e.line - 1) : 0;
        const range = new vscode.Range(line, 0, line, 1000);
        const severity = e.type === 'gotcha'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;
        const prefix = e.type === 'gotcha' ? '⚠️ Gotcha' : '❌ Failed Attempt';
        const diag = new vscode.Diagnostic(range, `${prefix}: ${e.msg}`, severity);
        diag.source = 'infernoflow';
        return diag;
      });

    this.collection.set(document.uri, diagnostics);
  }

  /**
   * Update diagnostics for all open editors
   */
  updateAll(workspaceRoot: string): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.updateForDocument(editor.document, workspaceRoot);
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}
