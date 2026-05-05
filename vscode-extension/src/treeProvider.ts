/**
 * Sidebar TreeView — memory-first.
 *
 * Sections, in order:
 *   📊 Session Health (score + entry counts)
 *   ⚠ Gotchas (count badge)
 *   ✓ Decisions (count badge)
 *   ❌ Failed Attempts (count badge)
 *   ⚡ Quick Actions (Log Gotcha / Log Decision / Switch / Ask / Recap)
 *
 * Clicking an entry that has a file path opens the file at the right line.
 */

import * as vscode from "vscode";
import * as path from "path";
import { ampIO } from "./amp";
import type { AMPEntry, EntryType } from "infernoflow-amp";

// ── Tree item ────────────────────────────────────────────────────────────────

class InfernoItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: "section" | "entry" | "action" | "info",
    collapsibleState: vscode.TreeItemCollapsibleState,
    icon?: string,
    public readonly entry?: AMPEntry,
  ) {
    super(label, collapsibleState);
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = kind;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60)        return "just now";
  if (diffSec < 3600)      return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400)    return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86_400) return `${Math.floor(diffSec / 86_400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function makeOpenCommand(entry: AMPEntry): vscode.Command | undefined {
  if (!entry.file) return undefined;
  const root = workspaceRoot();
  if (!root) return undefined;
  const abs = path.isAbsolute(entry.file) ? entry.file : path.join(root, entry.file);
  const line = entry.line && entry.line > 0 ? entry.line - 1 : 0;
  return {
    command: "vscode.open",
    title: "Open File",
    arguments: [vscode.Uri.file(abs), { selection: new vscode.Range(line, 0, line, 0) }],
  };
}

function makeEntryItem(entry: AMPEntry, icon: string): InfernoItem {
  const item = new InfernoItem(
    entry.msg,
    "entry",
    vscode.TreeItemCollapsibleState.None,
    icon,
    entry,
  );
  const fileSuffix = entry.file ? `${entry.file}${entry.line ? `:${entry.line}` : ""} · ` : "";
  item.description = `${fileSuffix}${timeAgo(entry.ts)}`;
  item.tooltip = new vscode.MarkdownString(
    `**${entry.type}** — ${timeAgo(entry.ts)}\n\n${entry.msg}` +
    (entry.file ? `\n\n📁 \`${entry.file}${entry.line ? ":" + entry.line : ""}\`` : ""),
  );
  const cmd = makeOpenCommand(entry);
  if (cmd) item.command = cmd;
  return item;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class InfernoTreeProvider implements vscode.TreeDataProvider<InfernoItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<InfernoItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: InfernoItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: InfernoItem): InfernoItem[] {
    if (!ampIO.isAttached()) return [];

    if (!ampIO.isInitialised()) {
      // Project not initialised yet — show a single guidance row
      const item = new InfernoItem(
        "Run: infernoflow init",
        "info",
        vscode.TreeItemCollapsibleState.None,
        "info",
      );
      item.description = "no .ai-memory/ or inferno/ found";
      item.command = { command: "workbench.action.terminal.new", title: "Open Terminal" };
      return [item];
    }

    if (!element) {
      const s = ampIO.summary();
      return [
        this.section(
          `Session Health · ${s.health.grade} (${s.health.score}/100)`,
          "graph",
          true,
        ),
        this.section(`Gotchas (${s.gotchas})`,         "warning", s.gotchas > 0),
        this.section(`Decisions (${s.decisions})`,     "check",   false),
        this.section(`Failed Attempts (${s.attempts})`,"error",   false),
        this.section("Quick Actions",                  "zap",     true),
      ];
    }

    // Section children
    const label = element.label as string;
    if (label.startsWith("Session Health"))    return this.healthRows();
    if (label.startsWith("Gotchas"))           return this.entriesByType("gotcha",   "warning");
    if (label.startsWith("Decisions"))         return this.entriesByType("decision", "check");
    if (label.startsWith("Failed Attempts"))   return this.entriesByType("attempt",  "error");
    if (label === "Quick Actions")             return this.quickActions();
    return [];
  }

  // ── Section builders ───────────────────────────────────────────────────────

  private section(label: string, icon: string, expanded: boolean): InfernoItem {
    return new InfernoItem(
      label,
      "section",
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      icon,
    );
  }

  private healthRows(): InfernoItem[] {
    const s = ampIO.summary();
    const rows: InfernoItem[] = [];
    rows.push(this.infoRow(`Score: ${s.health.grade} (${s.health.score}/100)`, "graph"));
    rows.push(this.infoRow(`Entries logged: ${s.total}`, "list-unordered"));
    if (s.lastEntryTs) {
      rows.push(this.infoRow(`Last entry: ${timeAgo(s.lastEntryTs)}`, "history"));
    }
    return rows;
  }

  private entriesByType(type: EntryType, icon: string): InfernoItem[] {
    const filtered = ampIO.readEntries().filter(e => e.type === type);
    if (filtered.length === 0) {
      return [this.infoRow(`No ${type}s yet`, "circle-outline")];
    }
    // Newest first
    return filtered.slice().sort((a, b) => b.ts - a.ts).map(e => makeEntryItem(e, icon));
  }

  private quickActions(): InfernoItem[] {
    return [
      this.action("Log a Gotcha…",       "warning", "infernoflow.logGotcha"),
      this.action("Log a Decision…",     "check",   "infernoflow.logDecision"),
      this.action("Log a Failed Attempt…","error",  "infernoflow.logAttempt"),
      this.action("Generate Handoff",    "arrow-swap", "infernoflow.switch"),
      this.action("Ask Memory…",         "search",  "infernoflow.ask"),
      this.action("Show Recap",          "graph",   "infernoflow.recap"),
    ];
  }

  private action(label: string, icon: string, command: string): InfernoItem {
    const item = new InfernoItem(label, "action", vscode.TreeItemCollapsibleState.None, icon);
    item.command = { command, title: label };
    return item;
  }

  private infoRow(label: string, icon: string): InfernoItem {
    return new InfernoItem(label, "info", vscode.TreeItemCollapsibleState.None, icon);
  }
}
