import * as vscode from 'vscode';
import { SessionStore } from './sessionStore';
import { InfernoTreeProvider } from './treeProvider';
import { InfernoStatusBar } from './statusBar';
import { InfernoDiagnostics } from './diagnostics';
import { InfernoCodeLensProvider } from './codeLens';
import { registerCommands } from './commands';
import { AutoCapture } from './autoCapture';

let sessionStore: SessionStore;
let treeProvider: InfernoTreeProvider;
let statusBar: InfernoStatusBar;
let diagnostics: InfernoDiagnostics;
let codeLensProvider: InfernoCodeLensProvider;
let autoCapture: AutoCapture;

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return;
  }

  // Core: session store reads/writes inferno/sessions.jsonl
  sessionStore = new SessionStore(workspaceRoot);

  // UI: Sidebar TreeView
  treeProvider = new InfernoTreeProvider(sessionStore);
  vscode.window.registerTreeDataProvider('infernoflow.sessionView', treeProvider);

  // UI: Status bar
  statusBar = new InfernoStatusBar(sessionStore);
  context.subscriptions.push(statusBar);

  // UI: Diagnostics (gotcha warnings in editor)
  diagnostics = new InfernoDiagnostics(sessionStore);
  context.subscriptions.push(diagnostics);

  // UI: CodeLens (memory count per file, inline gotchas)
  codeLensProvider = new InfernoCodeLensProvider(sessionStore);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
  );

  // Auto-capture: repeated edits
  autoCapture = new AutoCapture(sessionStore, treeProvider, statusBar, diagnostics, workspaceRoot);
  context.subscriptions.push(autoCapture);

  // Register all commands
  registerCommands(context, sessionStore, treeProvider, statusBar, diagnostics, codeLensProvider, workspaceRoot);

  // Initial refresh
  statusBar.update();

  // Update on file save
  vscode.workspace.onDidSaveTextDocument(() => {
    statusBar.update();
  });

  // Update diagnostics when switching editors
  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      diagnostics.updateForDocument(editor.document, workspaceRoot);
    }
  });

  // Update diagnostics for already open editor
  if (vscode.window.activeTextEditor) {
    diagnostics.updateForDocument(vscode.window.activeTextEditor.document, workspaceRoot);
  }

  console.log('🔥 infernoflow activated');
}

export function deactivate() {
  console.log('🔥 infernoflow deactivated');
}
