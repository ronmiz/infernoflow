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
// v0.44.3: the extension writes the rule files' Memory-protocol block ONCE on
// activation again — but only once, never per-edit. Rationale: auto-capture
// link 1 ("AI knows WHEN to log") lived only in the CLI's writer, so a user who
// installed the extension WITHOUT the CLI (no Node) got `.ai-memory/` but no
// protocol block → the AI never learned to call amp_write. A single idempotent
// activation write (shared `<!-- infernoflow:start -->` markers, so the CLI's
// richer write still replaces it cleanly — no duplicate block) closes that gap
// without bringing back the v0.43 per-edit churn that blocked branch switches.
import { rebuildAiRuleFiles }      from "./contextSync";
import { registerCommands }        from "./commands";
import { ensureCliAndSetup }       from "./cliInstaller";
import { registerLmTools }         from "./lmTools";

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
    // v0.44.1: scheduleRebuild used to call rebuildAiRuleFiles after a 1.5s
    // debounce. Removed — the CLI's MCP-boot refresh is the canonical write
    // path. Watching memory still drives the sidebar refresh via the
    // onChange handler below; rule files now only update once per session
    // start (or via explicit `infernoflow refresh`).
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      // intentionally a no-op; left as a hook in case ranking-by-active-file
      // moves into a future CLI plug-in API.
    }, 1500);
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

  // Auto-capture link 1: ensure the rule files carry the Memory-protocol block
  // so the AI knows WHEN to call amp_write — even if the CLI was never installed
  // (no Node). One-time write on activation only; idempotent and shared-marker
  // so a later CLI write replaces it without duplicating. Never blocks activation.
  if (isAutoSyncEnabled() && ampIO.isInitialised()) {
    try { rebuildAiRuleFiles(); } catch { /* non-fatal — sidebar still works */ }
  }
  // Keep the (currently no-op) debounced hook registered for future use.
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

  // Language Model Tools — gives Copilot Chat a direct (non-MCP) path to
  // amp_write / amp_read. Copilot doesn't speak MCP, so without this the
  // protocol block's "use amp_write" instruction was dead text. Now Copilot
  // sees the tools natively. Cursor / Claude Code still use the MCP server.
  registerLmTools(context);

  // One-time-per-workspace bootstrap: install the CLI if missing, then run
  // setup so MCP servers are wired up for Cursor / VS Code Copilot / Claude
  // Code. Runs in the background — never blocks activation, never throws.
  // The user gets a one-prompt "Install?" toast on a fresh workspace; after
  // that everything is automatic.
  void ensureCliAndSetup(context);
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
