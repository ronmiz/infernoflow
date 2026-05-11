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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const sessionStore_1 = require("./sessionStore");
const treeProvider_1 = require("./treeProvider");
const statusBar_1 = require("./statusBar");
const diagnostics_1 = require("./diagnostics");
const commands_1 = require("./commands");
const autoCapture_1 = require("./autoCapture");
let sessionStore;
let treeProvider;
let statusBar;
let diagnostics;
let autoCapture;
function activate(context) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return;
    }
    // Core: session store reads/writes inferno/sessions.jsonl
    sessionStore = new sessionStore_1.SessionStore(workspaceRoot);
    // UI: Sidebar TreeView
    treeProvider = new treeProvider_1.InfernoTreeProvider(sessionStore);
    vscode.window.registerTreeDataProvider('infernoflow.sessionView', treeProvider);
    // UI: Status bar
    statusBar = new statusBar_1.InfernoStatusBar(sessionStore);
    context.subscriptions.push(statusBar);
    // UI: Diagnostics (gotcha warnings in editor)
    diagnostics = new diagnostics_1.InfernoDiagnostics(sessionStore);
    context.subscriptions.push(diagnostics);
    // Auto-capture: repeated edits
    autoCapture = new autoCapture_1.AutoCapture(sessionStore, treeProvider, statusBar, diagnostics, workspaceRoot);
    context.subscriptions.push(autoCapture);
    // Register all commands
    (0, commands_1.registerCommands)(context, sessionStore, treeProvider, statusBar, diagnostics, workspaceRoot);
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
function deactivate() {
    console.log('🔥 infernoflow deactivated');
}
//# sourceMappingURL=extension.js.map