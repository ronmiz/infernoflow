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
exports.InfernoDiagnostics = void 0;
const vscode = __importStar(require("vscode"));
class InfernoDiagnostics {
    constructor(store) {
        this.store = store;
        this.collection = vscode.languages.createDiagnosticCollection('infernoflow');
    }
    /**
     * Update diagnostics for a given document, showing gotchas as warnings
     */
    updateForDocument(document, workspaceRoot) {
        const relativePath = vscode.workspace.asRelativePath(document.uri);
        const entries = this.store.getForFile(relativePath);
        if (entries.length === 0) {
            this.collection.delete(document.uri);
            return;
        }
        const diagnostics = entries
            .filter(e => e.type === 'gotcha' || e.type === 'attempt')
            .map(e => {
            const line = e.line ? Math.max(0, e.line - 1) : 0;
            const range = new vscode.Range(line, 0, line, 1000);
            const severity = e.type === 'gotcha'
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information;
            const prefix = e.type === 'gotcha' ? '⚠️ Gotcha' : '❌ Failed Attempt';
            const diag = new vscode.Diagnostic(range, `${prefix}: ${e.msg}`, severity);
            diag.source = 'infernoflow';
            return diag;
        });
        this.collection.set(document.uri, diagnostics);
    }
    /**
     * Update diagnostics for all open editors
     */
    updateAll(workspaceRoot) {
        for (const editor of vscode.window.visibleTextEditors) {
            this.updateForDocument(editor.document, workspaceRoot);
        }
    }
    dispose() {
        this.collection.dispose();
    }
}
exports.InfernoDiagnostics = InfernoDiagnostics;
//# sourceMappingURL=diagnostics.js.map