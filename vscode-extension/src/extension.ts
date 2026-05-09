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
import * as path from "path";
import { ampIO } from "./amp";
import { InfernoTreeProvider }     from "./treeProvider";
import { InfernoStatusBar }        from "./statusBar";
import { InfernoDiagnostics }      from "./diagnostics";
import { InfernoCodeLensProvider } from "./codeLens";
import { AutoCapture }             from "./autoCapture";
import { rebuildAiRuleFiles }      from "./contextSync";
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

  // ── Auto-sync of AI rule files ────────────────────────────────────────────
  // Closes the injection loop: any time memory changes OR the active file
  // changes, we re-rebuild .cursorrules / CLAUDE.md / copilot-instructions.md
  // with the current ranking. Debounced so saves and rapid-edit bursts don't
  // hammer the disk. Idempotent — a rebuild that produces identical content
  // is a no-op (no write, no git diff).
  //
  // Result: when the developer opens a NEW chat in the same VS Code session,
  // the AI tool reads the rule files and ALWAYS sees the latest memory ranked
  // for the file currently in focus. No "click rebuild" required.
  let rebuildTimer: NodeJS.Timeout | undefined;
  const scheduleRebuild = () => {
    if (!isAutoSyncEnabled()) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      const editor = vscode.window.activeTextEditor;
      const root   = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      let activeFile: string | undefined;
      if (editor && root && editor.document.uri.scheme === "file") {
        activeFile = path.relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
      }
      try {
        rebuildAiRuleFiles(activeFile);
      } catch { /* never throw from a watcher */ }
    }, 1500); // 1.5s debounce
  };

  // Trigger 1: any memory change (new entry, deletion, edit, CLI write, etc.)
  context.subscriptions.push(ampIO.onChange(scheduleRebuild));

  // Trigger 2: active editor change — re-rank by new active file
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      treeProvider.refresh();
      scheduleRebuild();
    }),
  );

  // Trigger 3: setting changed (in case user toggles autoSyncRules)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("infernoflow.autoSyncRules")) scheduleRebuild();
    }),
  );

  // Initial sync on activation so files are current from the first chat
  scheduleRebuild();

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

function isAutoSyncEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("infernoflow")
    .get<boolean>("autoSyncRules", true);
}
