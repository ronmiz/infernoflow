import * as vscode from 'vscode';
import { SessionStore } from './sessionStore';

export class InfernoStatusBar {
  private item: vscode.StatusBarItem;

  constructor(private store: SessionStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'infernoflow.recap';
    this.update();
    this.item.show();
  }

  update(): void {
    const entries = this.store.getAll();
    const { grade } = this.store.getHealthScore();
    const gotchas = entries.filter(e => e.type === 'gotcha').length;
    const decisions = entries.filter(e => e.type === 'decision').length;
    const attempts = entries.filter(e => e.type === 'attempt').length;

    this.item.text = `🔥 ${grade} · ⚠${gotchas} · ✓${decisions} · ❌${attempts}`;
    this.item.tooltip = 'infernoflow — Click for recap';
  }

  dispose(): void {
    this.item.dispose();
  }
}
