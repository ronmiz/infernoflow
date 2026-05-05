/**
 * infernoflow VS Code extension — entry point.
 *
 * Wires together the four MVP surfaces:
 *   - sidebar TreeView (treeProvider.ts)
 *   - status bar (statusBar.ts)
 *   - editor diagnostics (diagnostics.ts)
 *   - command palette + keyboard shortcuts (commands.ts)
 *
 * Memory I/O goes through ampIO (amp.ts), which wraps the
 * `infernoflow-amp` npm package. Single source of truth, watcher-driven
 * refreshes — no polling.
 */

import * as vscode from "vscode";
import { ampIO } from "./amp";
import { InfernoTreeProvider } from "./treeProvider";
import { InfernoStatusBar } from "./statusBar";
import { InfernoDiagnostics } from "./diagnostics";
import { registerCommands } from "./commands";

let statusBar: InfernoStatusBar | undefined;
let diagnostics: InfernoDiagnostics | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Bind AMP I/O to the current workspace
  ampIO.attach();
  context.subscriptions.push(new vscode.Disposable(() => ampIO.detach()));

  // Sidebar
  const treeProvider = new InfernoTreeProvider();
  const treeView = vscode.window.createTreeView("infernoflow.sessionView", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(ampIO.onChange(() => treeProvider.refresh()));

  // Status bar
  statusBar = new InfernoStatusBar();
  statusBar.attach();
  context.subscriptions.push(new vscode.Disposable(() => statusBar?.dispose()));

  // Diagnostics
  diagnostics = new InfernoDiagnostics();
  diagnostics.attach();
  context.subscriptions.push(new vscode.Disposable(() => diagnostics?.dispose()));

  // Re-bind when workspace folders change (open/close/move)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      ampIO.attach();
      treeProvider.refresh();
    }),
  );

  // Re-render on settings changes that affect surfaces
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("infernoflow")) {
        treeProvider.refresh();
      }
    }),
  );

  // Commands + keybindings
  registerCommands(context, () => treeProvider.refresh());
}

export function deactivate(): void {
  // VS Code disposes context.subscriptions for us; nothing extra to do.
}
