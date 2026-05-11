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
exports.InfernoTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class InfernoTreeProvider {
    constructor(store) {
        this.store = store;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(node) {
        switch (node.kind) {
            case 'health': {
                const item = new vscode.TreeItem(`🔥 Session Health: ${node.grade} (${node.score}/100)`, vscode.TreeItemCollapsibleState.None);
                item.tooltip = 'Session health based on logged entries';
                item.contextValue = 'health';
                return item;
            }
            case 'group': {
                const item = new vscode.TreeItem(`${node.icon} ${node.label} (${node.entries.length})`, node.entries.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed);
                item.contextValue = 'group';
                return item;
            }
            case 'entry': {
                const e = node.entry;
                const msg = e.msg.length > 60 ? e.msg.substring(0, 57) + '...' : e.msg;
                const item = new vscode.TreeItem(msg, vscode.TreeItemCollapsibleState.None);
                item.tooltip = e.msg;
                if (e.file) {
                    item.description = e.file;
                }
                const time = new Date(e.ts);
                item.tooltip = `${e.msg}\n\n${time.toLocaleString()}${e.file ? '\nFile: ' + e.file : ''}`;
                item.contextValue = 'entry';
                return item;
            }
            case 'action': {
                const item = new vscode.TreeItem(`${node.icon} ${node.label}`, vscode.TreeItemCollapsibleState.None);
                item.command = { command: node.command, title: node.label };
                item.contextValue = 'action';
                return item;
            }
        }
    }
    getChildren(element) {
        if (!element) {
            // Root level
            const { score, grade } = this.store.getHealthScore();
            const gotchas = this.store.getByType('gotcha');
            const decisions = this.store.getByType('decision');
            const attempts = this.store.getByType('attempt');
            const notes = this.store.getByType('note');
            const nodes = [
                { kind: 'health', score, grade },
                { kind: 'group', label: 'Gotchas', type: 'gotcha', icon: '⚠️', entries: gotchas },
                { kind: 'group', label: 'Decisions', type: 'decision', icon: '✓', entries: decisions },
                { kind: 'group', label: 'Failed Attempts', type: 'attempt', icon: '❌', entries: attempts },
                { kind: 'group', label: 'Notes', type: 'note', icon: '📝', entries: notes },
                { kind: 'action', label: 'Log Gotcha...', command: 'infernoflow.logGotcha', icon: '➕' },
                { kind: 'action', label: 'Log Decision...', command: 'infernoflow.logDecision', icon: '➕' },
                { kind: 'action', label: 'Generate Handoff', command: 'infernoflow.switch', icon: '📋' },
            ];
            return nodes;
        }
        if (element.kind === 'group') {
            return element.entries.map(entry => ({ kind: 'entry', entry }));
        }
        return [];
    }
}
exports.InfernoTreeProvider = InfernoTreeProvider;
//# sourceMappingURL=treeProvider.js.map