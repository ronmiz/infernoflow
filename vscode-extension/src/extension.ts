/**
 * infernoflow VS Code extension — entry point.
 *
 * Wires together every surface:
 *   - sidebar TreeView    (treeProvider.ts)
 *   - status bar          (statusBar.ts)
 *   - editor diagnostics  (diagnostics.ts)
 *   - inline CodeLens     (codeLens.ts)
 *   - auto-capture watcher(autoCapture.ts)
 *   - command palette + keyboard shortcuts (commands.ts)
 *
 * Memory I/O goes through ampIO (amp.ts), which wraps the
 * `infernoflow-amp` npm package. Single source of truth, watcher-driven
 * refreshes — no polling.
 *
 * If `infernoflow.enabled` is false, activate() short-circuits and registers
 * nothing — the extension is fully dormant until the setting flips back.
 */

import * as vscode from "vscode";
import { ampIO } from "./amp";
import { InfernoTreeProvider }     from "./treeProvider";
import { InfernoStatusBar }        from "./statusBar";
import { InfernoDiagnostics }      from "./diagnostics";
import { InfernoCodeLensProvider } from "./codeLens";
import { AutoCapture }             from "./autoCapture";
import { registerCommands }        from "./commands";

let statusBar:   InfernoStatusBar        | undefined;
let diagnostics: InfernoDiagnostics      | undefined;
let codeLens:    InfernoCodeLensProvider | undefined;
let autoCapture: AutoCapture             | undefined;

export function activate(context: vscode.ExtensionContext): void {
  if (!isExtensionEnabled()) return;

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

  // CodeLens — inline annotations above files with memory entries
  codeLens = new InfernoCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, codeLens),
  );
  context.subscriptions.push(new vscode.Disposable(() => codeLens?.dispose()));

  // AutoCapture — watch for repeated edits and prompt to log
  autoCapture = new AutoCapture();
  context.subscriptions.push(new vscode.Disposable(() => autoCapture?.dispose()));

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

function isExtensionEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("infernoflow")
    .get<boolean>("enabled", true);
}
