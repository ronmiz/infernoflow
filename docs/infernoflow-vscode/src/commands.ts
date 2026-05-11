import * as vscode from 'vscode';
import { SessionStore, SessionEntry } from './sessionStore';
import { InfernoTreeProvider } from './treeProvider';
import { InfernoStatusBar } from './statusBar';
import { InfernoDiagnostics } from './diagnostics';
import { InfernoCodeLensProvider } from './codeLens';

export function registerCommands(
  context: vscode.ExtensionContext,
  store: SessionStore,
  tree: InfernoTreeProvider,
  statusBar: InfernoStatusBar,
  diagnostics: InfernoDiagnostics,
  codeLens: InfernoCodeLensProvider,
  workspaceRoot: string,
): void {

  function refreshAll() {
    tree.refresh();
    statusBar.update();
    diagnostics.updateAll(workspaceRoot);
    codeLens.refresh();
  }

  async function promptAndLog(type: SessionEntry['type'], promptText: string) {
    const msg = await vscode.window.showInputBox({
      prompt: promptText,
      placeHolder: `Describe the ${type}...`,
    });
    if (!msg) { return; }

    // Get active editor file info
    const editor = vscode.window.activeTextEditor;
    const file = editor ? vscode.workspace.asRelativePath(editor.document.uri) : undefined;
    const line = editor ? editor.selection.active.line + 1 : undefined;

    store.log(type, msg, file, line);
    refreshAll();
    vscode.window.showInformationMessage(`🔥 Logged ${type}: ${msg.substring(0, 50)}${msg.length > 50 ? '...' : ''}`);
  }

  // Log commands
  context.subscriptions.push(
    vscode.commands.registerCommand('infernoflow.logGotcha', () =>
      promptAndLog('gotcha', '⚠️ What gotcha should the next agent know about?')
    ),
    vscode.commands.registerCommand('infernoflow.logDecision', () =>
      promptAndLog('decision', '✓ What architectural/design decision was made?')
    ),
    vscode.commands.registerCommand('infernoflow.logAttempt', () =>
      promptAndLog('attempt', '❌ What did you try that failed? (and why?)')
    ),
    vscode.commands.registerCommand('infernoflow.logNote', () =>
      promptAndLog('note', '📝 What note should be remembered?')
    ),
  );

  // Switch / Handoff
  context.subscriptions.push(
    vscode.commands.registerCommand('infernoflow.switch', async () => {
      const handoff = store.generateHandoff();
      const doc = await vscode.workspace.openTextDocument({
        content: handoff,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

  // Recap
  context.subscriptions.push(
    vscode.commands.registerCommand('infernoflow.recap', async () => {
      const recap = store.generateRecap();
      const doc = await vscode.workspace.openTextDocument({
        content: recap,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

  // Ask (search)
  context.subscriptions.push(
    vscode.commands.registerCommand('infernoflow.ask', async () => {
      const query = await vscode.window.showInputBox({
        prompt: '🔍 Search session memory...',
        placeHolder: 'e.g. "auth" or "database"',
      });
      if (!query) { return; }

      const results = store.search(query);
      if (results.length === 0) {
        vscode.window.showInformationMessage(`No entries found for "${query}"`);
        return;
      }

      const items = results.map(e => ({
        label: `${e.type === 'gotcha' ? '⚠️' : e.type === 'decision' ? '✓' : e.type === 'attempt' ? '❌' : '📝'} ${e.msg}`,
        description: e.file || '',
        detail: new Date(e.ts).toLocaleString(),
        entry: e,
      }));

      await vscode.window.showQuickPick(items, {
        placeHolder: `Found ${results.length} entries for "${query}"`,
      });
    })
  );

  // Refresh
  context.subscriptions.push(
    vscode.commands.registerCommand('infernoflow.refresh', () => {
      refreshAll();
      vscode.window.showInformationMessage('🔥 infernoflow refreshed');
    })
  );

  // Open Panel (focus the sidebar view)
  context.subscriptions.push(
    vscode.commands.registerCommand('infernoflow.openPanel', () => {
      vscode.commands.executeCommand('infernoflow.sessionView.focus');
    })
  );
}
