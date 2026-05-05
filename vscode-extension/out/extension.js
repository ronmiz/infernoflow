"use strict";
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
const commands_1 = require("./commands");
let statusBar;
let diagnostics;
function activate(context) {
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
//# sourceMappingURL=extension.js.map