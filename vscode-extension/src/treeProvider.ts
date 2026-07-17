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
import * as fs from "fs";
import { ampIO } from "./amp";
import { rankedForFile } from "./contextSync";
import type { AMPEntry, EntryType } from "infernoflow-amp";

/** Active editor's path relative to workspace root, or undefined. */
function activeRelativeFile(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return undefined;
  if (editor.document.uri.scheme !== "file") return undefined;
  return path.relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
}

/** Trim "src/components/longish/path.tsx" → "components/path.tsx" for sidebar labels. */
function shortFile(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 2) return p;
  return parts.slice(-2).join("/");
}

/**
 * True iff the entry references a file that no longer exists on disk.
 * Returns false for entries with no file reference (those aren't orphaned —
 * they were always file-less).
 */
export function isOrphaned(entry: AMPEntry): boolean {
  if (!entry.file) return false;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return false;
  const abs = path.isAbsolute(entry.file) ? entry.file : path.join(root, entry.file);
  return !fs.existsSync(abs);
}

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
  const orphaned = isOrphaned(entry);
  // Use a "circle-slash" overlay icon for orphaned entries so they're visually
  // distinct in the tree even before reading the description.
  const renderIcon = orphaned ? "circle-slash" : icon;

  const item = new InfernoItem(
    entry.msg,
    "entry",
    vscode.TreeItemCollapsibleState.None,
    renderIcon,
    entry,
  );

  // Tag orphaned entries in the description column so they're scannable
  const fileSuffix   = entry.file ? `${entry.file}${entry.line ? `:${entry.line}` : ""} · ` : "";
  const orphanMarker = orphaned ? "(deleted) · " : "";
  item.description   = `${fileSuffix}${orphanMarker}${timeAgo(entry.ts)}`;

  // Custom contextValue for orphaned entries so we can target them in menus
  item.contextValue = orphaned ? "entry-orphaned" : "entry";

  // Richer tooltip for orphans: explains what happened and how to fix it
  if (orphaned) {
    item.tooltip = new vscode.MarkdownString(
      `**${entry.type} (orphaned)** — ${timeAgo(entry.ts)}\n\n` +
      `${entry.msg}\n\n` +
      `📁 \`${entry.file}${entry.line ? ":" + entry.line : ""}\` — ⚠ this file no longer exists.\n\n` +
      `_Click to keep or delete this entry. Possibly from a refactor._`,
    );
    // Click → soft-prompt instead of vscode.open (which would fail anyway)
    item.command = {
      command:   "infernoflow.handleOrphaned",
      title:     "Handle orphaned entry",
      arguments: [entry],
    };
  } else {
    item.tooltip = new vscode.MarkdownString(
      `**${entry.type}** — ${timeAgo(entry.ts)}\n\n${entry.msg}` +
      (entry.file ? `\n\n📁 \`${entry.file}${entry.line ? ":" + entry.line : ""}\`` : ""),
    );
    const cmd = makeOpenCommand(entry);
    if (cmd) item.command = cmd;
  }
  return item;
}

// ── Bookmarks ────────────────────────────────────────────────────────────────
// A bookmark is a `note` entry tagged "bookmark". Its captured context (if any)
// lives in the Tier-2 sidecar `.ai-memory/details/<id>.md` — a DETERMINISTIC
// path, so we read it directly without needing the bundled infernoflow-amp
// package to expose detailRef. Clicking a bookmark "jumps" to it: opens the
// saved context, and/or reveals its file:line.

function isBookmark(e: AMPEntry): boolean {
  return Array.isArray(e.tags) && e.tags.includes("bookmark");
}

/** True iff a bookmark carries a saved Tier-2 context body on disk. */
function bookmarkHasContext(entry: AMPEntry): boolean {
  const root = workspaceRoot();
  if (!root || !entry.id) return false;
  return fs.existsSync(path.join(root, ".ai-memory", "details", `${entry.id}.md`));
}

function makeBookmarkItem(entry: AMPEntry): InfernoItem {
  const item = new InfernoItem(entry.msg, "entry", vscode.TreeItemCollapsibleState.None, "bookmark", entry);
  const hasCtx = bookmarkHasContext(entry);
  const loc = entry.file ? `${shortFile(entry.file)}${entry.line ? ":" + entry.line : ""} · ` : "";
  item.description = `${hasCtx ? "● " : ""}${loc}${timeAgo(entry.ts)}`;
  item.contextValue = "bookmark";
  item.tooltip = new vscode.MarkdownString(
    `**🔖 ${entry.msg}** — ${timeAgo(entry.ts)}\n\n` +
    (hasCtx ? "_Click to open the saved context._"
     : entry.file ? "_Click to jump to the file._"
     : "_Marker only — no saved context._"),
  );
  item.command = { command: "infernoflow.jumpToBookmark", title: "Jump to bookmark", arguments: [entry] };
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
    try {
      if (!ampIO.isAttached()) {
        // No workspace folder open
        const item = new InfernoItem(
          "Open a folder to use infernoflow",
          "info",
          vscode.TreeItemCollapsibleState.None,
          "info",
        );
        item.description = "no workspace folder";
        return [item];
      }

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
        // v0.43.6 focus pivot: removed AI Context section (CodeLens shows the same
        // data inline at file:line, better placement) and CLI Tools section (one-time
        // setup commands belong in the command palette, not in the daily-use sidebar).
        // Result: 5 daily-use sections + 1 collapsed Code Map for the visual map.
        return [
          this.section(
            `Session Health · ${s.health.grade} (${s.health.score}/100)`,
            "graph", true,
            "Overall health grade (A-F) from logged entries: gotchas weight most, then decisions, attempts, notes."),
          this.section(`Gotchas (${s.gotchas})`, "warning", s.gotchas > 0,
            "Things to watch out for. Each becomes a yellow Problems-panel warning + a squiggle in the editor."),
          this.section(`Decisions (${s.decisions})`, "check", false,
            "Architectural choices recorded so future sessions know why X was picked over Y."),
          this.section(`Failed Attempts (${s.attempts})`, "error", false,
            "Approaches that didn't work — surfaced as blue Information squiggles in the editor."),
          this.section(`Bookmarks (${ampIO.readEntries().filter(isBookmark).length})`, "bookmark", false,
            "Named resume points. Click one to open its saved context — or jump to its file:line."),
          this.section("Memory Actions", "zap", true,
            "The core memory loop: log entries, search memory, generate handoff for the next AI."),
        ];
      }

      // Section children
      const label = element.label as string;
      if (label.startsWith("Session Health"))    return this.healthRows();
      if (label.startsWith("Gotchas"))           return this.entriesByType("gotcha",   "warning");
      if (label.startsWith("Decisions"))         return this.entriesByType("decision", "check");
      if (label.startsWith("Failed Attempts"))   return this.entriesByType("attempt",  "error");
      if (label.startsWith("Bookmarks"))         return this.bookmarkRows();
      if (label === "Memory Actions")            return this.memoryActions();
      return [];
    } catch (err) {
      // Last-resort fallback: never let the panel render fully blank.
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[infernoflow] tree getChildren failed:", err);
      const item = new InfernoItem(
        `Error: ${msg}`,
        "info",
        vscode.TreeItemCollapsibleState.None,
        "warning",
      );
      item.description = "see Developer Tools console";
      return [item];
    }
  }

  // ── Section builders ───────────────────────────────────────────────────────

  private section(label: string, icon: string, expanded: boolean, tooltip?: string): InfernoItem {
    const item = new InfernoItem(
      label,
      "section",
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      icon,
    );
    if (tooltip) {
      const md = new vscode.MarkdownString(tooltip);
      md.supportThemeIcons = true;
      item.tooltip = md;
    }
    return item;
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

  private bookmarkRows(): InfernoItem[] {
    const bms = ampIO.readEntries().filter(isBookmark);
    if (bms.length === 0) {
      return [this.infoRow("No bookmarks yet — drop one with “Bookmark this point…”", "circle-outline")];
    }
    return bms.slice().sort((a, b) => b.ts - a.ts).map(e => makeBookmarkItem(e)); // newest first
  }

  private entriesByType(type: EntryType, icon: string): InfernoItem[] {
    const filtered = ampIO.readEntries().filter(e => e.type === type);
    if (filtered.length === 0) {
      return [this.infoRow(`No ${type}s yet`, "circle-outline")];
    }
    // Newest first
    return filtered.slice().sort((a, b) => b.ts - a.ts).map(e => makeEntryItem(e, icon));
  }

  /**
   * Rows for the "AI Context for [current file]" section.
   * Top 5 most-relevant entries for the active file + a "Rebuild AI rule files"
   * action that propagates the current ranking to .cursorrules / CLAUDE.md.
   */
  private memoryActions(): InfernoItem[] {
    return [
      this.action(
        "Log a Gotcha…", "warning", "infernoflow.logGotcha",
        "Save a 'don't fall in this hole again' note.\n\n" +
        "When: you hit a non-obvious bug or surprising behavior.\n" +
        "Shortcut: Ctrl+Alt+G"),
      this.action(
        "Log a Decision…", "check", "infernoflow.logDecision",
        "Record an architectural choice with the reason.\n\n" +
        "When: you pick X over Y and want future-you to know why.\n" +
        "Shortcut: Ctrl+Alt+D"),
      this.action(
        "Log a Failed Attempt…", "error", "infernoflow.logAttempt",
        "Note something you tried that didn't work.\n\n" +
        "When: an approach failed so it isn't re-tried by you or the next AI.\n" +
        "Shows as a blue squiggle at file:line and in the Problems panel."),
      this.action(
        "Generate Handoff", "arrow-swap", "infernoflow.switch",
        "Build a markdown summary of all memory entries.\n\n" +
        "When: end of a session, before switching AI tools.\n" +
        "Writes inferno/handoff.md and copies to clipboard.\n" +
        "Shortcut: Ctrl+Alt+S"),
      this.action(
        "Ask Memory…", "search", "infernoflow.ask",
        "Search memory by keyword, file, or error fragment.\n\n" +
        "Click a match to jump to its file:line.\n" +
        "Shortcut: Ctrl+Alt+A"),
      this.action(
        "Bookmark this point…", "bookmark", "infernoflow.bookmarkThis",
        "Drop a named resume point at the current file:line.\n\n" +
        "When: a spot you'll want to return to. Recall it from the Bookmarks section above, " +
        "or in a new session's handoff. Rich context can be attached via the CLI/AI."),
      this.action(
        "Manage entries…", "checklist", "infernoflow.manageEntries",
        "Bulk select and delete entries (orphaned + manual).\n\n" +
        "When: cleanup. Picker is grouped by date so you can scan and tick noise away."),
    ];
  }

  private action(label: string, icon: string, command: string, tooltip?: string): InfernoItem {
    const item = new InfernoItem(label, "action", vscode.TreeItemCollapsibleState.None, icon);
    item.command = { command, title: label };
    if (tooltip) {
      const md = new vscode.MarkdownString(tooltip);
      md.supportThemeIcons = true;
      item.tooltip = md;
    }
    return item;
  }

  private infoRow(label: string, icon: string): InfernoItem {
    return new InfernoItem(label, "info", vscode.TreeItemCollapsibleState.None, icon);
  }
}
