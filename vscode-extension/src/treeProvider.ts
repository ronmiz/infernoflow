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
        const activeFile = activeRelativeFile();
        const aiContextLabel = activeFile
          ? `AI Context for ${shortFile(activeFile)}`
          : "AI Context (no active file)";
        return [
          this.section(
            `Session Health · ${s.health.grade} (${s.health.score}/100)`,
            "graph", true,
            "Overall health grade (A-F) computed from logged entries: gotchas weight most, then decisions, attempts, notes. Click to expand for details."),
          this.section(aiContextLabel, "rocket", true,
            "What the next AI session will see for the file you're currently editing. Sorted by relevance — same file first, then same directory, then same extension. Top 5 are folded into CLAUDE.md / .cursorrules / .github/copilot-instructions.md when you click 'Rebuild AI rule files'."),
          this.section(`Gotchas (${s.gotchas})`, "warning", s.gotchas > 0,
            "Things to watch out for. Each one becomes a yellow warning in the Problems panel and a yellow squiggle at its file:line."),
          this.section(`Decisions (${s.decisions})`, "check", false,
            "Architectural choices recorded so future sessions know why X was picked over Y."),
          this.section(`Failed Attempts (${s.attempts})`, "error", false,
            "Approaches that didn't work. Surfaced as blue Information squiggles in the editor — visible without being noisy."),
          this.section("Quick Actions", "zap", true,
            "The core memory loop: log entries (gotcha/decision/attempt), search, generate handoff for the next AI."),
          this.section("CLI Tools", "terminal", false,
            "Run infernoflow CLI commands in a single reusable terminal. Same actions are also in the command palette under 'infernoflow:'."),
        ];
      }

      // Section children
      const label = element.label as string;
      if (label.startsWith("Session Health"))    return this.healthRows();
      if (label.startsWith("Gotchas"))           return this.entriesByType("gotcha",   "warning");
      if (label.startsWith("Decisions"))         return this.entriesByType("decision", "check");
      if (label.startsWith("Failed Attempts"))   return this.entriesByType("attempt",  "error");
      if (label.startsWith("AI Context"))        return this.aiContextRows();
      if (label === "Quick Actions")             return this.quickActions();
      if (label === "CLI Tools")                 return this.cliTools();
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
  private aiContextRows(): InfernoItem[] {
    const activeFile = activeRelativeFile();
    const top = rankedForFile(activeFile).slice(0, 5);

    const rows: InfernoItem[] = [];
    if (top.length === 0) {
      rows.push(this.infoRow("No relevant entries for this file yet", "circle-outline"));
    } else {
      for (const { entry } of top) {
        const icon = entry.type === "gotcha"   ? "warning"
                   : entry.type === "decision" ? "check"
                   : entry.type === "attempt"  ? "error"
                   :                              "note";
        rows.push(makeEntryItem(entry, icon));
      }
    }
    rows.push(this.action(
      "🔄 Rebuild AI rule files now", "refresh", "infernoflow.rebuildAiRules",
      "Rewrite .cursorrules / CLAUDE.md / .github/copilot-instructions.md " +
      "with this file's ranking applied. Top 5 most-relevant entries get full text; " +
      "the rest collapse under a 'Older context' detail block. AI tools read these " +
      "files at session start, so the next AI conversation will see the right gotchas first.",
    ));
    return rows;
  }

  private quickActions(): InfernoItem[] {
    return [
      this.action(
        "Log a Gotcha…", "warning", "infernoflow.logGotcha",
        "Save a 'don't fall in this hole again' note.\n\n" +
        "When to use: you hit a non-obvious bug, edge case, or surprising behavior.\n" +
        "What happens: opens an input box; the entry is saved with the current file and line.\n" +
        "Shortcut: Ctrl+Alt+G"),
      this.action(
        "Log a Decision…", "check", "infernoflow.logDecision",
        "Record an architectural choice you just made.\n\n" +
        "When to use: you pick X over Y and want future-you (or the next AI) to know why.\n" +
        "What happens: opens an input box; saved with file/line context.\n" +
        "Shortcut: Ctrl+Alt+D"),
      this.action(
        "Log a Failed Attempt…", "error", "infernoflow.logAttempt",
        "Note something you tried that didn't work.\n\n" +
        "When to use: an approach failed so it isn't re-attempted by you or the next AI.\n" +
        "What happens: shows as a blue squiggle in the editor and in the Problems panel."),
      this.action(
        "Generate Handoff", "arrow-swap", "infernoflow.switch",
        "Build a markdown summary of all gotchas, decisions, and attempts.\n\n" +
        "When to use: end of a session, before switching to a different AI tool.\n" +
        "What happens: writes inferno/handoff.md, copies to clipboard, opens in side editor.\n" +
        "Shortcut: Ctrl+Alt+S"),
      this.action(
        "Ask Memory…", "search", "infernoflow.ask",
        "Search session memory by keyword, file path, or error fragment.\n\n" +
        "When to use: you remember 'we had something about X' but don't know where.\n" +
        "What happens: opens a quick-pick of matches; click one to jump to that file:line.\n" +
        "Shortcut: Ctrl+Alt+A"),
      this.action(
        "Show Recap", "graph", "infernoflow.recap",
        "Display all logged entries grouped by type, with timestamps.\n\n" +
        "When to use: at-a-glance view of what's been captured this session.\n" +
        "What happens: opens a markdown view in a side editor.\n" +
        "Shortcut: Ctrl+Alt+R"),
      this.action(
        "Manage entries…", "checklist", "infernoflow.manageEntries",
        "Bulk select and delete entries.\n\n" +
        "When to use: cleanup. Especially when you have 10+ entries and want to remove old/irrelevant ones.\n" +
        "What happens: opens a multi-select picker grouped by date (Today / Yesterday / Last 7 days / Older). Tick the entries you want gone, hit Enter, confirm. All deleted in one shot."),
      this.action(
        "Cleanup orphaned entries…", "circle-slash", "infernoflow.cleanupOrphaned",
        "Find and bulk-delete entries whose file no longer exists.\n\n" +
        "When to use: after a refactor that deleted/renamed source files. Orphaned entries clutter the sidebar and confuse handoffs.\n" +
        "What happens: opens a multi-select picker showing only entries whose file path can't be found. Tick them all and confirm to clean up in one go."),
    ];
  }

  /**
   * CLI passthrough rows. Each runs a CLI command in the reusable
   * "infernoflow" terminal so users can see streaming output. Same set is
   * mirrored in the command palette under the "infernoflow:" category.
   */
  private cliTools(): InfernoItem[] {
    return [
      this.action(
        "Status", "pulse", "infernoflow.cliStatus",
        "Run `infernoflow status`.\n\n" +
        "Shows project health at a glance: capability count, scenario coverage %, last contract change.\n" +
        "When to use: quick 'is everything OK?' check."),
      this.action(
        "Check", "verified", "infernoflow.cliCheck",
        "Run `infernoflow check`.\n\n" +
        "Validates contract.json, capabilities.json, scenarios, and CHANGELOG.\n" +
        "When to use: before a commit, to catch drift between code and contract."),
      this.action(
        "Doctor", "stethoscope", "infernoflow.cliDoctor",
        "Run `infernoflow doctor`.\n\n" +
        "Diagnoses your setup: Node version, git, contract files, AI provider config, MCP server, hooks.\n" +
        "When to use: something's broken and you don't know what."),
      this.action(
        "Scan codebase", "search-fuzzy", "infernoflow.cliScan",
        "Run `infernoflow scan`.\n\n" +
        "Deep AST scan of source files. Maps function names to capabilities, detects DB/HTTP calls.\n" +
        "When to use: before running graph/review/drift — those commands need scan.json data."),
      this.action(
        "Init (adopt)", "rocket", "infernoflow.cliInitAdopt",
        "Run `infernoflow init --adopt`.\n\n" +
        "Bootstraps inferno/ on an existing codebase. Auto-detects capabilities from your code.\n" +
        "When to use: first-time setup on a project that already has code."),
      this.action(
        "Setup MCP", "plug", "infernoflow.cliSetup",
        "Run `infernoflow setup`.\n\n" +
        "Installs the MCP server in .cursor/, registers it in Claude/Cursor config, pre-approves tools.\n" +
        "When to use: once per project, to let AI agents call infernoflow tools directly."),
      this.action(
        "AI setup", "sparkle", "infernoflow.cliAiSetup",
        "Run `infernoflow ai setup`.\n\n" +
        "Configures an AI provider (Anthropic/OpenAI/Gemini/Ollama) for explain/why/review/changelog AI.\n" +
        "When to use: first-time, to enable AI-powered CLI commands."),
      this.action(
        "Install Cursor hooks", "extensions", "infernoflow.cliInstallCursor",
        "Run `infernoflow install-cursor-hooks`.\n\n" +
        "Adds hooks that auto-capture context after every Cursor agent response into inferno/CONTEXT.draft.md.\n" +
        "When to use: only if you're using Cursor as your primary AI editor."),
      this.action(
        "Watch (auto-capture)", "eye", "infernoflow.cliWatch",
        "Run `infernoflow watch`.\n\n" +
        "Long-running CLI mode that watches files for changes and prompts to log gotchas.\n" +
        "When to use: alternative to the in-extension auto-capture popup, for terminal-only setups."),
      this.action(
        "Cloud status", "cloud", "infernoflow.cliCloudStatus",
        "Run `infernoflow cloud status`.\n\n" +
        "Shows cloud sync state: signed in?, last push, last pull.\n" +
        "When to use: debug contract sync across teammates."),
      this.action(
        "Show context", "book", "infernoflow.cliContext",
        "Run `infernoflow context`.\n\n" +
        "Generates AI-ready markdown summarizing capabilities, recent changes, and open gotchas.\n" +
        "When to use: paste this into a fresh AI session for full project context."),
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
