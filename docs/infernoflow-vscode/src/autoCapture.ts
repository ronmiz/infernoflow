import * as vscode from 'vscode';
import { SessionStore } from './sessionStore';
import { InfernoTreeProvider } from './treeProvider';
import { InfernoStatusBar } from './statusBar';
import { InfernoDiagnostics } from './diagnostics';

/**
 * Auto-capture: watches for repeated edits to the same file,
 * and prompts the user to log a gotcha if they seem stuck.
 */
export class AutoCapture {
  private editCounts = new Map<string, number>();
  private editTimestamps = new Map<string, number[]>();
  private disposable: vscode.Disposable;
  private threshold: number;
  private timeWindowMs = 10 * 60 * 1000; // 10 minutes

  constructor(
    private store: SessionStore,
    private tree: InfernoTreeProvider,
    private statusBar: InfernoStatusBar,
    private diagnostics: InfernoDiagnostics,
    private workspaceRoot: string,
  ) {
    const config = vscode.workspace.getConfiguration('infernoflow');
    this.threshold = config.get<number>('autoCapture.repeatedEditsThreshold', 5);

    this.disposable = vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
      if (!config.get<boolean>('autoCapture.repeatedEdits', true)) { return; }
      this.onEdit(e.document);
    });
  }

  private async onEdit(document: vscode.TextDocument) {
    const file = vscode.workspace.asRelativePath(document.uri);

    // Skip non-workspace files
    if (file === document.uri.fsPath) { return; }

    // Track timestamps within the time window
    const now = Date.now();
    const timestamps = this.editTimestamps.get(file) || [];
    timestamps.push(now);

    // Remove entries outside the time window
    const cutoff = now - this.timeWindowMs;
    const recent = timestamps.filter(t => t >= cutoff);
    this.editTimestamps.set(file, recent);

    if (recent.length === this.threshold) {
      // Reset timestamps for this file
      this.editTimestamps.set(file, []);

      const action = await vscode.window.showWarningMessage(
        `🔥 You've edited ${file} ${this.threshold} times in 10 minutes. Stuck on something?`,
        'Log Gotcha',
        'Log Attempt',
        'Dismiss',
      );

      if (action === 'Log Gotcha') {
        await vscode.commands.executeCommand('infernoflow.logGotcha');
      } else if (action === 'Log Attempt') {
        await vscode.commands.executeCommand('infernoflow.logAttempt');
      }
    }
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
