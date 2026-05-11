"use strict";
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
exports.AutoCapture = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Auto-capture: watches for repeated edits to the same file,
 * and prompts the user to log a gotcha if they seem stuck.
 */
class AutoCapture {
    constructor(store, tree, statusBar, diagnostics, workspaceRoot) {
        this.store = store;
        this.tree = tree;
        this.statusBar = statusBar;
        this.diagnostics = diagnostics;
        this.workspaceRoot = workspaceRoot;
        this.editCounts = new Map();
        const config = vscode.workspace.getConfiguration('infernoflow');
        this.threshold = config.get('autoCapture.editThreshold', 10);
        this.disposable = vscode.workspace.onDidChangeTextDocument((e) => {
            if (!config.get('autoCapture.enabled', true)) {
                return;
            }
            this.onEdit(e.document);
        });
    }
    async onEdit(document) {
        const file = vscode.workspace.asRelativePath(document.uri);
        // Skip non-workspace files
        if (file === document.uri.fsPath) {
            return;
        }
        const count = (this.editCounts.get(file) || 0) + 1;
        this.editCounts.set(file, count);
        if (count === this.threshold) {
            // Reset counter
            this.editCounts.set(file, 0);
            const action = await vscode.window.showWarningMessage(`🔥 You've edited ${file} many times. Stuck? Log a gotcha for the next agent.`, 'Log Gotcha', 'Log Attempt', 'Dismiss');
            if (action === 'Log Gotcha') {
                await vscode.commands.executeCommand('infernoflow.logGotcha');
            }
            else if (action === 'Log Attempt') {
                await vscode.commands.executeCommand('infernoflow.logAttempt');
            }
        }
    }
    dispose() {
        this.disposable.dispose();
    }
}
exports.AutoCapture = AutoCapture;
//# sourceMappingURL=autoCapture.js.map