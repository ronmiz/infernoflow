"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const amp_1 = require("./amp");
const treeProvider_1 = require("./treeProvider");
const statusBar_1 = require("./statusBar");
const diagnostics_1 = require("./diagnostics");
const codeLens_1 = require("./codeLens");
const autoCapture_1 = require("./autoCapture");
const contextSync_1 = require("./contextSync");
const commands_1 = require("./commands");
let statusBar;
let diagnostics;
let codeLens;
let autoCapture;
function activate(context) {
    if (!isExtensionEnabled())
        return;
    // Bind AMP I/O to the current workspace
    amp_1.ampIO.attach();
    context.subscriptions.push(new vscode.Disposable(() => amp_1.ampIO.detach()));
    // Sidebar
    const treeProvider = new treeProvider_1.InfernoTreeProvider();
    const treeView = vscode.window.createTreeView("infernoflow.sessionView", {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);
    context.subscriptions.push(amp_1.ampIO.onChange(() => treeProvider.refresh()));
    // Status bar
    statusBar = new statusBar_1.InfernoStatusBar();
    statusBar.attach();
    context.subscriptions.push(new vscode.Disposable(() => statusBar?.dispose()));
    // Diagnostics
    diagnostics = new diagnostics_1.InfernoDiagnostics();
    diagnostics.attach();
    context.subscriptions.push(new vscode.Disposable(() => diagnostics?.dispose()));
    // CodeLens — inline annotations above files with memory entries
    codeLens = new codeLens_1.InfernoCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: "file" }, codeLens));
    context.subscriptions.push(new vscode.Disposable(() => codeLens?.dispose()));
    // AutoCapture — watch for repeated edits and prompt to log
    autoCapture = new autoCapture_1.AutoCapture();
    context.subscriptions.push(new vscode.Disposable(() => autoCapture?.dispose()));
    // Re-bind when workspace folders change (open/close/move)
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        amp_1.ampIO.attach();
        treeProvider.refresh();
    }));
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
    let rebuildTimer;
    const scheduleRebuild = () => {
        if (!isAutoSyncEnabled())
            return;
        if (rebuildTimer)
            clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
            rebuildTimer = undefined;
            const editor = vscode.window.activeTextEditor;
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            let activeFile;
            if (editor && root && editor.document.uri.scheme === "file") {
                activeFile = path.relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
            }
            try {
                (0, contextSync_1.rebuildAiRuleFiles)(activeFile);
            }
            catch { /* never throw from a watcher */ }
        }, 1500); // 1.5s debounce
    };
    // Trigger 1: any memory change (new entry, deletion, edit, CLI write, etc.)
    context.subscriptions.push(amp_1.ampIO.onChange(scheduleRebuild));
    // Trigger 2: active editor change — re-rank by new active file
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        treeProvider.refresh();
        scheduleRebuild();
    }));
    // Trigger 3: setting changed (in case user toggles autoSyncRules)
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("infernoflow.autoSyncRules"))
            scheduleRebuild();
    }));
    // Initial sync on activation so files are current from the first chat
    scheduleRebuild();
    // Re-render on settings changes that affect surfaces
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("infernoflow")) {
            treeProvider.refresh();
        }
    }));
    // Commands + keybindings
    (0, commands_1.registerCommands)(context, () => treeProvider.refresh());
}
function deactivate() {
    // VS Code disposes context.subscriptions for us; nothing extra to do.
}
function isExtensionEnabled() {
    return vscode.workspace
        .getConfiguration("infernoflow")
        .get("enabled", true);
}
function isAutoSyncEnabled() {
    return vscode.workspace
        .getConfiguration("infernoflow")
        .get("autoSyncRules", true);
}
//# sourceMappingURL=extension.js.map