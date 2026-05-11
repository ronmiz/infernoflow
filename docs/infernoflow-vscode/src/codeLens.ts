import * as vscode from 'vscode';
import { SessionStore } from './sessionStore';

export class InfernoCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private store: SessionStore) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('infernoflow');
    if (!config.get<boolean>('showCodeLens', true)) {
      return [];
    }

    const relativePath = vscode.workspace.asRelativePath(document.uri);
    const entries = this.store.getForFile(relativePath);

    if (entries.length === 0) {
      return [];
    }

    const gotchas = entries.filter(e => e.type === 'gotcha');
    const attempts = entries.filter(e => e.type === 'attempt');
    const decisions = entries.filter(e => e.type === 'decision');

    const lenses: vscode.CodeLens[] = [];

    // Show a summary CodeLens at line 0
    const parts: string[] = [];
    if (gotchas.length) { parts.push(`⚠️ ${gotchas.length} gotcha${gotchas.length > 1 ? 's' : ''}`); }
    if (attempts.length) { parts.push(`❌ ${attempts.length} failed attempt${attempts.length > 1 ? 's' : ''}`); }
    if (decisions.length) { parts.push(`✓ ${decisions.length} decision${decisions.length > 1 ? 's' : ''}`); }

    if (parts.length > 0) {
      const range = new vscode.Range(0, 0, 0, 0);
      const lens = new vscode.CodeLens(range, {
        title: `🔥 ${parts.join(' · ')}`,
        command: 'infernoflow.ask',
        tooltip: 'Click to search infernoflow memory for this file',
      });
      lenses.push(lens);
    }

    // Show individual gotcha/attempt CodeLenses at their specific lines
    for (const entry of [...gotchas, ...attempts]) {
      if (entry.line && entry.line > 0 && entry.line <= document.lineCount) {
        const line = entry.line - 1;
        const range = new vscode.Range(line, 0, line, 0);
        const icon = entry.type === 'gotcha' ? '⚠️' : '❌';
        const msg = entry.msg.length > 80 ? entry.msg.substring(0, 77) + '...' : entry.msg;
        const lens = new vscode.CodeLens(range, {
          title: `${icon} ${msg}`,
          command: '',
          tooltip: `${entry.type}: ${entry.msg}\nLogged: ${new Date(entry.ts).toLocaleString()}`,
        });
        lenses.push(lens);
      }
    }

    return lenses;
  }
}
