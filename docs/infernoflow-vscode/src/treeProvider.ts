import * as vscode from 'vscode';
import { SessionStore, SessionEntry } from './sessionStore';

type EntryType = SessionEntry['type'];

interface GroupNode {
  kind: 'group';
  label: string;
  type: EntryType;
  icon: string;
  entries: SessionEntry[];
}

interface EntryNode {
  kind: 'entry';
  entry: SessionEntry;
}

interface ActionNode {
  kind: 'action';
  label: string;
  command: string;
  icon: string;
}

interface HealthNode {
  kind: 'health';
  score: number;
  grade: string;
}

type TreeNode = GroupNode | EntryNode | ActionNode | HealthNode;

export class InfernoTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: SessionStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'health': {
        const item = new vscode.TreeItem(
          `🔥 Session Health: ${node.grade} (${node.score}/100)`,
          vscode.TreeItemCollapsibleState.None
        );
        item.tooltip = 'Session health based on logged entries';
        item.contextValue = 'health';
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(
          `${node.icon} ${node.label} (${node.entries.length})`,
          node.entries.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
        );
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
        const item = new vscode.TreeItem(
          `${node.icon} ${node.label}`,
          vscode.TreeItemCollapsibleState.None
        );
        item.command = { command: node.command, title: node.label };
        item.contextValue = 'action';
        return item;
      }
    }
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      // Root level
      const { score, grade } = this.store.getHealthScore();
      const gotchas = this.store.getByType('gotcha');
      const decisions = this.store.getByType('decision');
      const attempts = this.store.getByType('attempt');
      const notes = this.store.getByType('note');

      const nodes: TreeNode[] = [
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
      return element.entries.map(entry => ({ kind: 'entry' as const, entry }));
    }

    return [];
  }
}
