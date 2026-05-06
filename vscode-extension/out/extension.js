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
const amp_1 = require("./amp");
const treeProvider_1 = require("./treeProvider");
const statusBar_1 = require("./statusBar");
const diagnostics_1 = require("./diagnostics");
const codeLens_1 = require("./codeLens");
const autoCapture_1 = require("./autoCapture");
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
//# sourceMappingURL=extension.js.map