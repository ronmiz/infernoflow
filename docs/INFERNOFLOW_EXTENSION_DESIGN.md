# 🔥 Infernoflow VS Code Extension — Complete Design Document

> Full design spec for the infernoflow VS Code extension.
> Not yet published to the marketplace.
> Author: Ron Miz · Date: April 28, 2026

---

## Table of Contents

1. [Vision](#1-vision)
2. [Extension Surface Map](#2-extension-surface-map)
3. [Surface 1: Sidebar Panel (TreeView)](#3-surface-1-sidebar-panel-treeview)
4. [Surface 2: Status Bar](#4-surface-2-status-bar)
5. [Surface 3: Editor Banners (Diagnostics)](#5-surface-3-editor-banners-diagnostics)
6. [Surface 4: Gutter Icons](#6-surface-4-gutter-icons)
7. [Surface 5: CodeLens](#7-surface-5-codelens)
8. [Surface 6: Bottom Panel (Webview)](#8-surface-6-bottom-panel-webview)
9. [Command Palette Commands](#9-command-palette-commands)
10. [Keyboard Shortcuts](#10-keyboard-shortcuts)
11. [Notifications & Auto-Capture](#11-notifications--auto-capture)
12. [Copilot Chat Integration (The Holy Grail)](#12-copilot-chat-integration-the-holy-grail)
13. [Color Scheme & Branding](#13-color-scheme--branding)
14. [Extension Settings](#14-extension-settings)
15. [Extension Manifest (package.json)](#15-extension-manifest-packagejson)
16. [Build Priority & Timeline](#16-build-priority--timeline)
17. [Marketplace Strategy](#17-marketplace-strategy)

---

## 1. Vision

The extension transforms infernoflow from a CLI tool into an **invisible layer inside VS Code**. The developer never leaves the editor. Memory captures itself. Context injects itself. Gotchas appear where they matter.

**Design principle: The best UX is no UX. It just works.**

The CLI is powerful but requires switching context (terminal → editor → terminal). The extension brings everything into the editor — zero context switches, zero friction.

---

## 2. Extension Surface Map

The extension uses **6 VS Code surfaces**:

```
┌─────────────────────────────────────────────────────────────────┐
│ VS Code Window                                                  │
│                                                                 │
│  ┌──────────┐  ┌────────────────────────────────────────────┐   │
│  │ SIDEBAR  │  │ EDITOR                                     │   │
│  │          │  │                                             │   │
│  │ 🔥       │  │  src/handlers.js                           │   │
│  │ INFERNO  │  │                                             │   │
│  │ PANEL    │  │  ┌─────────────────────────────────────┐   │   │
│  │          │  │  │ ⚠️ GOTCHA: this function has a      │◄──│── [3] EDITOR BANNER
│  │ Session  │  │  │ side effect — modifies state directly│   │   │
│  │ ├ gotchas│  │  └─────────────────────────────────────┘   │   │
│  │ ├ decisn │  │                                             │   │
│  │ └ attemps│  │  12│ function handleRemovePhoneNumber() {  │   │
│  │          │  │  13│   // ...                               │   │
│  │ Health   │  │  14│   state.result = data; ◄── ⚠️ gotcha │◄──│── [4] GUTTER ICON
│  │ ██░░ 65  │  │  15│ }                                     │   │
│  │          │  │                                             │   │
│  │ Quick    │  │  ┌─────────────────────────────────────┐   │   │
│  │ Actions  │  │  │ 💡 CodeLens: 2 gotchas · 1 decision │◄──│── [5] CODELENS
│  │ [Log]    │  │  │ for this file (click to view)        │   │   │
│  │ [Switch] │  │  └─────────────────────────────────────┘   │   │
│  │ [Ask]    │  │                                             │   │
│  │          │  │                                             │   │
│  └──────────┘  └────────────────────────────────────────────┘   │
│  [1] SIDEBAR     [EDITOR AREA]                                  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ PANEL (Bottom)                                           │   │
│  │ ┌─────────────────────────────────────────────────────┐  │   │
│  │ │ 🔥 INFERNOFLOW SESSION                              │  │◄──── [6] BOTTOM PANEL
│  │ │                                                     │  │
│  │ │ 10:30  gotcha   API expects form-data not JSON      │  │
│  │ │ 10:15  decision Use async/await, not .then()        │  │
│  │ │ 09:45  attempt  Tried axios interceptors — failed   │  │
│  │ │                                                     │  │
│  │ └─────────────────────────────────────────────────────┘  │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ 🔥 B 65/100 · 3 gotchas · ☁️ Synced ·  📋 Switch       │◄──── [2] STATUS BAR
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Surface 1: Sidebar Panel (TreeView)

The sidebar gets an 🔥 infernoflow icon in the Activity Bar. Clicking it reveals a **TreeView** with these sections:

```
🔥 INFERNOFLOW
│
├── 📊 Session Health
│   ├── Score: B (65/100)
│   ├── Duration: 1h 23m
│   └── Entries: 6 logged
│
├── ⚠️ Gotchas (3)
│   ├── ⚠️ API expects form-data not JSON
│   │   └── 📁 src/api.js · 2h ago
│   ├── ⚠️ handleRemovePhoneNumber() has side effect
│   │   └── 📁 src/handlers.js · yesterday
│   └── ⚠️ Axios interceptors conflict with progress
│       └── 📁 src/api.js · 3 days ago
│
├── ✓ Decisions (2)
│   ├── ✓ Use async/await, not .then() chains
│   │   └── 30m ago
│   └── ✓ SweetAlert2 for all user alerts
│       └── 1h ago
│
├── ❌ Failed Attempts (1)
│   └── ❌ Tried react-query — performance was worse
│       └── yesterday
│
├── 🎨 Design System
│   ├── Primary: #646cff
│   ├── Font: Inter
│   └── Framework: Bootstrap + CSS
│
├── 📈 Capabilities (3)
│   ├── CreateItem (experimental)
│   ├── ReadItems (experimental)
│   └── SearchItems (experimental)
│
└── ⚡ Quick Actions
    ├── 📝 Log a Gotcha...
    ├── 📝 Log a Decision...
    ├── 🔀 Generate Handoff (switch)
    ├── 🔍 Ask Memory...
    ├── 📊 Full Recap
    └── ☁️ Sync Now
```

### Interactions

- Click a gotcha → jumps to the file/line where it's relevant
- Click "Log a Gotcha" → opens quick input box
- Gotchas section shows badge count: `⚠️ Gotchas (3)`
- Right-click any entry → "Delete" / "Edit" / "Copy"
- Drag and drop to reorder priority (future)

### Implementation

```typescript
class InfernoTreeProvider implements vscode.TreeDataProvider<InfernoItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<InfernoItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: InfernoItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: InfernoItem): InfernoItem[] {
    if (!element) {
      // Root level — sections
      return [
        new InfernoItem('Session Health', 'section',
          vscode.TreeItemCollapsibleState.Expanded, 'graph'),
        new InfernoItem('Gotchas', 'section',
          vscode.TreeItemCollapsibleState.Expanded, 'warning',
          this.getGotchas().length),
        new InfernoItem('Decisions', 'section',
          vscode.TreeItemCollapsibleState.Collapsed, 'check'),
        new InfernoItem('Failed Attempts', 'section',
          vscode.TreeItemCollapsibleState.Collapsed, 'error'),
        new InfernoItem('Design System', 'section',
          vscode.TreeItemCollapsibleState.Collapsed, 'symbol-color'),
        new InfernoItem('Capabilities', 'section',
          vscode.TreeItemCollapsibleState.Collapsed, 'layers'),
        new InfernoItem('Quick Actions', 'section',
          vscode.TreeItemCollapsibleState.Expanded, 'zap'),
      ];
    }

    // Children based on section
    switch (element.label) {
      case 'Gotchas':     return this.getGotchas();
      case 'Decisions':   return this.getDecisions();
      case 'Failed Attempts': return this.getAttempts();
      case 'Quick Actions':   return this.getQuickActions();
      // ...
    }
    return [];
  }

  private getGotchas(): InfernoItem[] {
    const sessions = readSessionsJsonl();
    return sessions
      .filter(s => s.type === 'gotcha')
      .map(g => {
        const item = new InfernoItem(
          g.msg, 'gotcha',
          vscode.TreeItemCollapsibleState.None, 'warning'
        );
        item.description = timeAgo(g.ts);
        item.tooltip = `${g.msg}\n\nLogged: ${new Date(g.ts).toLocaleString()}`;
        // Click to open file if source is known
        if (g.file) {
          item.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [vscode.Uri.file(g.file)],
          };
        }
        return item;
      });
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }
}

// Register
const treeProvider = new InfernoTreeProvider();
vscode.window.registerTreeDataProvider('infernoflow.sessionView', treeProvider);
```

---

## 4. Surface 2: Status Bar

Always visible at the bottom of VS Code. Shows session health at a glance.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ 🔥 B 65 · ⚠3 · ✓2 · ❌1 ·  ☁️ ·  📋 Switch               │
└─────────────────────────────────────────────────────────────┘
  │  │  │   │   │    │     │      │
  │  │  │   │   │    │     │      └── Click → generate handoff + copy
  │  │  │   │   │    │     └── Click → cloud sync status
  │  │  │   │   │    └── Cloud synced indicator
  │  │  │   │   └── 1 failed attempt
  │  │  │   └── 2 decisions
  │  │  └── 3 gotchas
  │  └── Session health score (B = 65/100)
  └── infernoflow icon
```

### States

```
Active session, synced (Pro):
  🔥 B 65 · ⚠3 · ✓2 · ❌1 ·  ☁️ ·  📋 Switch

Active session, free tier:
  🔥 B 65 · ⚠3 · ✓2 · ❌1 ·  📋 Switch

No session memory yet:
  🔥 Start logging → Cmd+Shift+P "infernoflow"

Empty project (no inferno/):
  🔥 Init → click to set up infernoflow

Error / offline:
  🔥 ⚠ Sync failed · 📋 Switch
```

### Click Behaviors

- Click score (`B 65`) → opens sidebar panel
- Click `📋 Switch` → generates handoff, copies to clipboard, shows notification
- Click `☁️` → shows sync status tooltip

### Implementation

```typescript
// Create two status bar items: main + switch button
const mainStatus = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Left, 100
);
const switchButton = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Left, 99
);

function updateStatusBar() {
  const sessions = readSessionsJsonl();
  const gotchas = sessions.filter(s => s.type === 'gotcha').length;
  const decisions = sessions.filter(s => s.type === 'decision').length;
  const attempts = sessions.filter(s => s.type === 'attempt').length;
  const score = calculateHealthScore(sessions);
  const grade = scoreToGrade(score);
  const synced = isCloudConfigured() ? ' · ☁️' : '';

  // Color based on grade
  const colors: Record<string, string> = {
    A: '#4CAF50', B: '#8BC34A', C: '#FF9800', D: '#FF5722', F: '#F44336'
  };

  mainStatus.text = `🔥 ${grade} ${score} · ⚠${gotchas} · ✓${decisions} · ❌${attempts}${synced}`;
  mainStatus.color = colors[grade] || '#FFFFFF';
  mainStatus.tooltip = `infernoflow session health: ${grade} (${score}/100)\nClick to open panel`;
  mainStatus.command = 'infernoflow.openPanel';
  mainStatus.show();

  switchButton.text = '📋 Switch';
  switchButton.tooltip = 'Generate handoff for next AI agent';
  switchButton.command = 'infernoflow.switch';
  switchButton.show();
}

// Update every 30 seconds + on file save
setInterval(updateStatusBar, 30000);
vscode.workspace.onDidSaveTextDocument(() => updateStatusBar());
```

---

## 5. Surface 3: Editor Banners (Diagnostics)

When the user opens a file that has gotchas logged against it, show **warning diagnostics** — the same yellow squiggly lines that TypeScript errors show.

### What the Developer Sees

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ infernoflow: 2 gotchas logged for this file              │
│    • "API expects form-data not JSON" (2 days ago)          │
│    • "Axios interceptors conflict with progress" (3 days)   │
│                                                    [Dismiss] │
└─────────────────────────────────────────────────────────────┘
 1  import axios from 'axios';
 2
 3  const api = axios.create({
 4    baseURL: 'https://api.example.com',
 5  });
 6
 7  export async function removePhoneNumber(imageData) {
     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     ⚠️ infernoflow gotcha: "API expects form-data not JSON"
 8    const formData = new FormData();
 9    formData.append('image', imageData);
10    return api.post('/postRemovePhoneFromPointer', formData);
11  }
```

### Why This Is Powerful

- Gotchas show in the **Problems panel** alongside TypeScript errors
- Yellow squiggly underline draws the eye naturally
- Hovering shows the full gotcha message + when it was logged
- **Both the developer AND the AI** see warnings BEFORE making the same mistake
- Copilot reads diagnostics — so it knows about the gotcha too!

### Implementation

```typescript
const diagnostics = vscode.languages.createDiagnosticCollection('infernoflow');

function updateDiagnostics(document: vscode.TextDocument) {
  const filePath = vscode.workspace.asRelativePath(document.uri);
  const gotchas = getGotchasForFile(filePath);

  if (gotchas.length === 0) {
    diagnostics.delete(document.uri);
    return;
  }

  const diags = gotchas.map(gotcha => {
    // Try to find the relevant function/line
    const range = findRelevantRange(document, gotcha);

    const diag = new vscode.Diagnostic(
      range,
      `🔥 gotcha: "${gotcha.msg}"`,
      vscode.DiagnosticSeverity.Warning
    );
    diag.source = 'infernoflow';
    diag.code = {
      value: 'gotcha',
      target: vscode.Uri.parse('https://infernoflow.dev/gotchas'),
    };
    return diag;
  });

  diagnostics.set(document.uri, diags);
}

// Trigger on file open and file change
vscode.window.onDidChangeActiveTextEditor(editor => {
  if (editor) updateDiagnostics(editor.document);
});

vscode.workspace.onDidOpenTextDocument(doc => {
  updateDiagnostics(doc);
});
```

### Smart Range Matching

How to find WHERE in the file to show the gotcha:

```typescript
function findRelevantRange(
  document: vscode.TextDocument,
  gotcha: SessionEntry
): vscode.Range {
  // 1. If gotcha has a specific line number, use it
  if (gotcha.line) {
    return document.lineAt(gotcha.line - 1).range;
  }

  // 2. If gotcha has a function name, find the function
  if (gotcha.functionName) {
    const text = document.getText();
    const regex = new RegExp(`function\\s+${gotcha.functionName}|${gotcha.functionName}\\s*[=(]`);
    const match = regex.exec(text);
    if (match) {
      const pos = document.positionAt(match.index);
      return document.lineAt(pos.line).range;
    }
  }

  // 3. Search for keywords from the gotcha message in the file
  const keywords = extractKeywords(gotcha.msg);
  for (const keyword of keywords) {
    const text = document.getText();
    const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx !== -1) {
      const pos = document.positionAt(idx);
      return document.lineAt(pos.line).range;
    }
  }

  // 4. Fallback: first line of file
  return document.lineAt(0).range;
}
```

---

## 6. Surface 4: Gutter Icons

Small icons in the editor gutter (left margin) for lines associated with memory entries:

```
   ⚠️ │ 7  export async function removePhoneNumber(imageData) {
      │ 8    const formData = new FormData();
      │ 9    formData.append('image', imageData);
   ⚠️ │10    return api.post('/postRemovePhoneFromPointer', formData);
      │11  }
```

### Hover Tooltip

```
┌─────────────────────────────────────────┐
│ 🔥 infernoflow gotcha (2 days ago)      │
│                                         │
│ "API expects form-data not JSON"        │
│                                         │
│ 💡 Tip: Use FormData, not               │
│    JSON.stringify()                      │
│                                         │
│ [View All] [Edit] [Delete]              │
└─────────────────────────────────────────┘
```

### Implementation

```typescript
// Create decoration types for each entry type
const gotchaDecoration = vscode.window.createTextEditorDecorationType({
  gutterIconPath: path.join(context.extensionPath, 'icons', 'gotcha.svg'),
  gutterIconSize: '80%',
  overviewRulerColor: '#FF9800',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  light: {
    gutterIconPath: path.join(context.extensionPath, 'icons', 'gotcha-light.svg'),
  },
  dark: {
    gutterIconPath: path.join(context.extensionPath, 'icons', 'gotcha-dark.svg'),
  },
});

const decisionDecoration = vscode.window.createTextEditorDecorationType({
  gutterIconPath: path.join(context.extensionPath, 'icons', 'decision.svg'),
  gutterIconSize: '80%',
  overviewRulerColor: '#4CAF50',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

function applyDecorations(editor: vscode.TextEditor) {
  const filePath = vscode.workspace.asRelativePath(editor.document.uri);
  const entries = getEntriesForFile(filePath);

  const gotchaRanges: vscode.DecorationOptions[] = [];
  const decisionRanges: vscode.DecorationOptions[] = [];

  for (const entry of entries) {
    const range = findRelevantRange(editor.document, entry);
    const decoration: vscode.DecorationOptions = {
      range,
      hoverMessage: new vscode.MarkdownString(
        `🔥 **infernoflow ${entry.type}** (${timeAgo(entry.ts)})\n\n` +
        `"${entry.msg}"\n\n` +
        `[View All](command:infernoflow.openPanel) · ` +
        `[Edit](command:infernoflow.editEntry) · ` +
        `[Delete](command:infernoflow.deleteEntry)`
      ),
    };

    if (entry.type === 'gotcha') gotchaRanges.push(decoration);
    if (entry.type === 'decision') decisionRanges.push(decoration);
  }

  editor.setDecorations(gotchaDecoration, gotchaRanges);
  editor.setDecorations(decisionDecoration, decisionRanges);
}
```

---

## 7. Surface 5: CodeLens

Clickable annotations above functions that have session memory:

```
  🔥 2 gotchas · 1 decision — Click to view | Log new
  export async function removePhoneNumber(imageData) {
    ...
  }
```

### Interactions

- **Click "Click to view"** → opens a peek window with all memory for this function
- **Click "Log new"** → quick input to add a gotcha/decision for this function

### Implementation

```typescript
class InfernoCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const filePath = vscode.workspace.asRelativePath(document.uri);
    const entries = getEntriesForFile(filePath);

    if (entries.length === 0) return [];

    // Find function declarations
    const functions = findFunctionDeclarations(document);

    for (const func of functions) {
      const funcEntries = getEntriesForFunction(entries, func.name);
      if (funcEntries.length === 0) continue;

      const gotchas = funcEntries.filter(e => e.type === 'gotcha').length;
      const decisions = funcEntries.filter(e => e.type === 'decision').length;
      const attempts = funcEntries.filter(e => e.type === 'attempt').length;

      const parts = [];
      if (gotchas) parts.push(`⚠ ${gotchas} gotcha${gotchas > 1 ? 's' : ''}`);
      if (decisions) parts.push(`✓ ${decisions} decision${decisions > 1 ? 's' : ''}`);
      if (attempts) parts.push(`❌ ${attempts} attempt${attempts > 1 ? 's' : ''}`);

      // "View" lens
      lenses.push(new vscode.CodeLens(func.range, {
        title: `🔥 ${parts.join(' · ')} — Click to view`,
        command: 'infernoflow.showEntries',
        arguments: [filePath, func.name],
      }));

      // "Log new" lens
      lenses.push(new vscode.CodeLens(func.range, {
        title: '| Log new',
        command: 'infernoflow.logForFunction',
        arguments: [filePath, func.name],
      }));
    }

    return lenses;
  }
}

vscode.languages.registerCodeLensProvider(
  { scheme: 'file' },
  new InfernoCodeLensProvider()
);
```

---

## 8. Surface 6: Bottom Panel (Webview)

A full session timeline panel at the bottom of VS Code (like Terminal or Output panels):

```
┌─────────────────────────────────────────────────────────────┐
│ 🔥 INFERNOFLOW SESSION  │  Timeline  │  Search  │  Recap   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TODAY                                                      │
│  ─────                                                      │
│  10:30  ⚠️ gotcha    API expects form-data not JSON         │
│                      src/api.js                             │
│                                                             │
│  10:15  ✓ decision   Use async/await, not .then()           │
│                      Consistency across codebase             │
│                                                             │
│  09:45  ❌ attempt   Tried axios interceptors for retry      │
│                      Failed: conflicts with progress handler │
│                                                             │
│  09:30  📝 note      Starting work on upload retry logic     │
│                      src/api.js, src/handlers.js             │
│                                                             │
│  YESTERDAY                                                   │
│  ─────────                                                   │
│  16:20  ⚠️ gotcha    handleRemovePhoneNumber() side effect   │
│                      src/handlers.js:12                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🔍 Search memory...                                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Session Health: B (65/100)                                 │
│  ████████████████████░░░░░░░░░░                             │
│  ✅ 3 gotchas · ✅ 2 decisions · ⚠️ no failed attempts log  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Tabs

| Tab | Content |
|---|---|
| **Timeline** | Chronological session log (shown above) |
| **Search** | Search across memory (`infernoflow ask` as UI) |
| **Recap** | Session health score + improvement suggestions |

### Implementation

```typescript
class InfernoSessionPanel implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    // Listen for messages from webview
    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.command) {
        case 'search':
          const results = searchSessions(message.query);
          webviewView.webview.postMessage({ type: 'searchResults', results });
          break;
        case 'deleteEntry':
          deleteSessionEntry(message.id);
          this.refresh();
          break;
      }
    });
  }

  private getHtml(): string {
    const sessions = readSessionsJsonl();
    const grouped = groupByDate(sessions);

    return `<!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background: var(--vscode-panel-background);
          padding: 12px;
        }
        .entry {
          display: flex;
          gap: 12px;
          padding: 8px 0;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        .time { color: var(--vscode-descriptionForeground); min-width: 50px; }
        .type-gotcha { color: #FF9800; }
        .type-decision { color: #4CAF50; }
        .type-attempt { color: #F44336; }
        .type-note { color: #2196F3; }
        .msg { flex: 1; }
        .date-header {
          font-weight: bold;
          margin-top: 16px;
          padding-bottom: 4px;
          border-bottom: 2px solid var(--vscode-panel-border);
        }
        .search-box {
          width: 100%;
          padding: 8px;
          margin: 8px 0;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 4px;
        }
        .health-bar {
          height: 8px;
          border-radius: 4px;
          background: var(--vscode-progressBar-background);
          margin: 8px 0;
        }
      </style>
    </head>
    <body>
      ${grouped.map(group => `
        <div class="date-header">${group.label}</div>
        ${group.entries.map(e => `
          <div class="entry">
            <span class="time">${formatTime(e.ts)}</span>
            <span class="type-${e.type}">${typeIcon(e.type)} ${e.type}</span>
            <span class="msg">${e.msg}</span>
          </div>
        `).join('')}
      `).join('')}

      <input class="search-box" placeholder="🔍 Search memory..."
        oninput="search(this.value)" />

      <script>
        const vscode = acquireVsCodeApi();
        function search(query) {
          vscode.postMessage({ command: 'search', query });
        }
      </script>
    </body>
    </html>`;
  }
}
```

---

## 9. Command Palette Commands

All accessible via `Cmd+Shift+P` (or `Ctrl+Shift+P`):

```
🔥 infernoflow: Log Gotcha
🔥 infernoflow: Log Decision
🔥 infernoflow: Log Failed Attempt
🔥 infernoflow: Log Note
───────────────────────────────────
🔥 infernoflow: Ask Memory...
🔥 infernoflow: Search All Projects...          (Pro)
───────────────────────────────────
🔥 infernoflow: Generate Handoff (Switch)
🔥 infernoflow: Generate Context
🔥 infernoflow: Show Recap
───────────────────────────────────
🔥 infernoflow: Scan Project
🔥 infernoflow: Show Health Score
🔥 infernoflow: Open Dashboard
───────────────────────────────────
🔥 infernoflow: Cloud Sync Now                  (Pro)
🔥 infernoflow: Cloud Pull                      (Pro)
🔥 infernoflow: Upgrade to Pro
```

### Log Command UX

```
Cmd+Shift+P → "infernoflow: Log Gotcha"

┌──────────────────────────────────────────────────┐
│ 🔥 Log a gotcha (a landmine for the next person) │
│                                                  │
│ API returns 200 on errors, check response body█  │
│                                                  │
│ [Enter to save] [Esc to cancel]                  │
└──────────────────────────────────────────────────┘

  → Notification: ✔ Logged: gotcha · ☁️ Synced
```

### Implementation

```typescript
vscode.commands.registerCommand('infernoflow.logGotcha', async () => {
  const msg = await vscode.window.showInputBox({
    prompt: '🔥 Log a gotcha (a landmine for the next person)',
    placeHolder: 'e.g., API returns 200 on errors, check response body',
  });

  if (!msg) return;

  // Get current file context
  const editor = vscode.window.activeTextEditor;
  const file = editor ? vscode.workspace.asRelativePath(editor.document.uri) : undefined;
  const line = editor ? editor.selection.active.line + 1 : undefined;

  // Write to sessions.jsonl
  appendToSessionLog({
    type: 'gotcha',
    msg,
    file,
    line,
    ts: Date.now(),
    source: 'vscode-extension',
  });

  // Cloud sync if Pro
  await cloudSyncIfConfigured();

  // Refresh all UI surfaces
  treeProvider.refresh();
  updateStatusBar();
  updateDiagnostics(editor?.document);

  // Notification
  const synced = isCloudConfigured() ? ' · ☁️ Synced' : '';
  vscode.window.showInformationMessage(`🔥 Logged: gotcha${synced}`);
});
```

---

## 10. Keyboard Shortcuts

### Default Bindings

```
Ctrl+Alt+G          → Log Gotcha (opens input box)
Ctrl+Alt+D          → Log Decision
Ctrl+Alt+A          → Ask Memory (search)
Ctrl+Alt+S          → Generate Switch/Handoff
Ctrl+Alt+R          → Show Recap
```

### Right-Click Context Menu

When right-clicking in the editor:

```
┌─────────────────────────────────┐
│ Cut                        Ctrl+X│
│ Copy                       Ctrl+C│
│ Paste                      Ctrl+V│
│ ─────────────────────────────── │
│ 🔥 Log Gotcha for this line     │
│ 🔥 Log Decision for this line   │
│ 🔥 View Memory for this file    │
└─────────────────────────────────┘
```

The right-click log commands **automatically capture the file and line number** — the user just types the message.

---

## 11. Notifications & Auto-Capture

The extension watches for events and prompts intelligently:

### Event: File Revert

```
Developer runs `git checkout -- src/api.js`

  ┌───────────────────────────────────────────┐
  │ 🔥 infernoflow detected a file revert.    │
  │ Log what you tried?                       │
  │                                           │
  │ [Log as Failed Attempt] [Dismiss]         │
  └───────────────────────────────────────────┘

  User clicks [Log as Failed Attempt] →
  Quick input: "Tried interceptor approach but broke progress handler"
  → ✔ Logged
```

### Event: Repeated Edits (Same File 5+ Times in 10 Minutes)

```
  ┌───────────────────────────────────────────┐
  │ 🔥 src/handlers.js edited 5 times in 10m │
  │ Looks tricky — log a gotcha?              │
  │                                           │
  │ [Log Gotcha] [It's Fine] [Don't Ask Again]│
  └───────────────────────────────────────────┘
```

### Event: Terminal Shows Repeated Error

```
  ┌───────────────────────────────────────────┐
  │ 🔥 Same error appeared 3 times:           │
  │ "TypeError: Cannot read property of null" │
  │ Log as gotcha for future reference?        │
  │                                           │
  │ [Log Gotcha] [Dismiss]                    │
  └───────────────────────────────────────────┘
```

### Event: VS Code Closing (Session End)

```
  ┌───────────────────────────────────────────┐
  │ 🔥 Session ending — 1h 23m               │
  │ Health: C (45/100)                        │
  │ You logged 2 items but changed 5 files.   │
  │                                           │
  │ Quick: anything the next AI should know?   │
  │ ┌─────────────────────────────────────┐   │
  │ │ Upload retry still WIP, don't touch█│   │
  │ └─────────────────────────────────────┘   │
  │                                           │
  │ [Save & Close] [Just Close]               │
  └───────────────────────────────────────────┘
```

### Implementation

```typescript
// Track repeated saves
const saveTracker = new Map<string, number[]>();

vscode.workspace.onDidSaveTextDocument(doc => {
  const filePath = doc.uri.fsPath;
  const now = Date.now();
  const saves = saveTracker.get(filePath) || [];
  saves.push(now);
  const recent = saves.filter(t => now - t < 600_000); // last 10 min
  saveTracker.set(filePath, recent);

  if (recent.length >= 5) {
    vscode.window.showInformationMessage(
      `🔥 ${path.basename(filePath)} edited ${recent.length} times in 10m. Log a gotcha?`,
      'Log Gotcha', "It's Fine", "Don't Ask Again"
    ).then(choice => {
      if (choice === 'Log Gotcha') {
        vscode.commands.executeCommand('infernoflow.logGotcha');
      }
      if (choice === "Don't Ask Again") {
        // Store preference
        context.globalState.update('infernoflow.suppressRepeatedEdits', true);
      }
    });
    saveTracker.set(filePath, []); // reset
  }
});

// Watch for git reverts via file system watcher
const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/index');
gitWatcher.onDidChange(() => {
  // Check if any tracked files were reverted
  detectRevertedFiles().then(reverted => {
    for (const file of reverted) {
      vscode.window.showInformationMessage(
        `🔥 ${path.basename(file)} was reverted. Log what you tried?`,
        'Log as Failed Attempt', 'Dismiss'
      ).then(choice => {
        if (choice === 'Log as Failed Attempt') {
          vscode.commands.executeCommand('infernoflow.logAttempt');
        }
      });
    }
  });
});

// Session end prompt
vscode.workspace.onWillSaveTextDocument(() => { /* track activity */ });
// Use deactivate() for session end
export function deactivate() {
  const session = getCurrentSession();
  if (session.changedFiles > session.loggedEntries) {
    // Show quick input before closing
    // Note: limited time in deactivate — consider using onDidCloseTerminal
  }
}
```

---

## 12. Copilot Chat Integration (The Holy Grail)

**This is the most valuable feature.** When the user opens Copilot Chat, the extension auto-prepends session memory.

### What the Developer Types

```
"add retry logic to the upload function"
```

### What Copilot Actually Receives (Injected by Extension)

```markdown
## infernoflow session memory

### ⚠️ Gotchas (don't repeat these)
- API expects form-data not JSON (src/api.js)
- Axios interceptors conflict with progress handler — use try/catch
- handleRemovePhoneNumber() has side effects (src/handlers.js)

### ❌ Failed attempts (don't try these again)
- react-query for upload — performance was worse, stick with direct axios

### ✓ Decisions made
- Use async/await, not .then() chains (consistency)
- SweetAlert2 for all user-facing alerts

### 🎨 Design system
- Primary: #646cff, Font: Inter, Bootstrap + CSS

---

User's request: "add retry logic to the upload function"
```

### Result

Copilot knows to:
- ✅ Use try/catch (not interceptors)
- ✅ Use async/await (not .then)
- ✅ Use FormData (not JSON)
- ✅ NOT use react-query
- → **Gets it right FIRST TIME**

### Implementation via Chat Participant API

```typescript
const participant = vscode.chat.createChatParticipant(
  'infernoflow.memory',
  async (request, context, response, token) => {
    const sessions = readSessionsJsonl();
    const gotchas = sessions.filter(s => s.type === 'gotcha');
    const decisions = sessions.filter(s => s.type === 'decision');
    const attempts = sessions.filter(s => s.type === 'attempt');
    const theme = readThemeJson();

    let memory = '';

    if (gotchas.length) {
      memory += '## ⚠️ Gotchas (don\'t repeat these mistakes)\n';
      gotchas.forEach(g => {
        memory += `- ${g.msg}`;
        if (g.file) memory += ` (${g.file})`;
        memory += '\n';
      });
      memory += '\n';
    }

    if (attempts.length) {
      memory += '## ❌ Failed attempts (don\'t try these again)\n';
      attempts.forEach(a => memory += `- ${a.msg}\n`);
      memory += '\n';
    }

    if (decisions.length) {
      memory += '## ✓ Decisions made (follow these)\n';
      decisions.forEach(d => memory += `- ${d.msg}\n`);
      memory += '\n';
    }

    if (theme) {
      memory += '## 🎨 Design system\n';
      memory += `- Primary: ${theme.colors?.[0]?.value || 'not set'}\n`;
      memory += `- Font: ${theme.fonts?.primary || 'not set'}\n`;
      memory += '\n';
    }

    // Provide context to the chat
    response.markdown(memory);
  }
);

participant.iconPath = vscode.Uri.joinPath(
  context.extensionUri, 'icons', 'infernoflow.svg'
);
```

### How Users Invoke It

```
In Copilot Chat, user types:

  @infernoflow add retry logic to upload

OR the extension auto-injects via a prompt file (`.github/copilot-instructions.md`):

  Always check infernoflow session memory before responding.
  Gotchas and failed attempts must be respected.
```

---

## 13. Color Scheme & Branding

### Brand Colors

```
Primary (fire):      #FF6B35 (warm orange)
Pro accent (gold):   #FFD700
```

### Entry Type Colors

```
Gotcha (warning):    #FF9800  ⚠️
Decision (success):  #4CAF50  ✓
Failed attempt:      #F44336  ❌
Note (info):         #2196F3  📝
```

### Health Score Colors

```
A (80-100):          #4CAF50  (green)
B (60-79):           #8BC34A  (light green)
C (40-59):           #FF9800  (orange)
D (20-39):           #FF5722  (deep orange)
F (0-19):            #F44336  (red)
```

### Icons Needed

```
icons/
├── infernoflow.svg              → Activity bar (🔥 stylized flame)
├── infernoflow-dark.svg         → Dark theme variant
├── infernoflow-light.svg        → Light theme variant
├── gotcha.svg                   → Gutter icon (orange triangle)
├── gotcha-light.svg             → Light theme
├── gotcha-dark.svg              → Dark theme
├── decision.svg                 → Gutter icon (green check)
├── decision-light.svg
├── decision-dark.svg
├── attempt.svg                  → Gutter icon (red X)
├── note.svg                     → Gutter icon (blue note)
├── cloud-synced.svg             → Status bar (gold cloud)
├── cloud-offline.svg            → Status bar (grey cloud)
├── pro-badge.svg                → Pro indicator (gold shield)
└── infernoflow-128.png          → Marketplace icon (128x128)
```

---

## 14. Extension Settings

```json
{
  "infernoflow.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable/disable infernoflow extension"
  },
  "infernoflow.showGutterIcons": {
    "type": "boolean",
    "default": true,
    "description": "Show gotcha/decision icons in editor gutter"
  },
  "infernoflow.showCodeLens": {
    "type": "boolean",
    "default": true,
    "description": "Show memory count above functions"
  },
  "infernoflow.showStatusBar": {
    "type": "boolean",
    "default": true,
    "description": "Show session health in status bar"
  },
  "infernoflow.showDiagnostics": {
    "type": "boolean",
    "default": true,
    "description": "Show gotcha warnings as diagnostics (Problems panel)"
  },
  "infernoflow.autoCapture.fileReverts": {
    "type": "boolean",
    "default": true,
    "description": "Prompt to log when a file is reverted"
  },
  "infernoflow.autoCapture.repeatedEdits": {
    "type": "boolean",
    "default": true,
    "description": "Prompt when same file is edited 5+ times in 10 minutes"
  },
  "infernoflow.autoCapture.repeatedEditsThreshold": {
    "type": "number",
    "default": 5,
    "description": "Number of saves to trigger repeated edit prompt"
  },
  "infernoflow.autoCapture.sessionEnd": {
    "type": "boolean",
    "default": true,
    "description": "Prompt for notes when closing VS Code"
  },
  "infernoflow.notifications": {
    "type": "string",
    "enum": ["all", "important", "none"],
    "default": "important",
    "description": "Notification level (all = every event, important = gotchas only, none = silent)"
  },
  "infernoflow.cloudSync.autoSync": {
    "type": "boolean",
    "default": true,
    "description": "(Pro) Auto-sync sessions.jsonl to cloud on every log"
  },
  "infernoflow.cloudSync.endpoint": {
    "type": "string",
    "default": "https://cloud.infernoflow.dev",
    "description": "(Pro) Cloud sync endpoint"
  }
}
```

---

## 15. Extension Manifest (package.json)

```json
{
  "name": "infernoflow",
  "displayName": "infernoflow — AI Session Memory",
  "description": "Persistent memory for AI coding sessions. Gotchas, decisions, and failed attempts — visible in your editor, injected into your AI.",
  "version": "0.1.0",
  "publisher": "ronmiz",
  "license": "MIT",
  "icon": "icons/infernoflow-128.png",
  "repository": {
    "type": "git",
    "url": "https://github.com/ronmiz/infernoflow-vscode"
  },
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["AI", "Other"],
  "keywords": [
    "ai", "memory", "copilot", "cursor", "session",
    "context", "gotcha", "mcp", "agent", "infernoflow"
  ],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "infernoflow",
        "title": "infernoflow",
        "icon": "icons/infernoflow.svg"
      }]
    },
    "views": {
      "infernoflow": [{
        "id": "infernoflow.sessionView",
        "name": "Session Memory"
      }],
      "panel": [{
        "id": "infernoflow.timeline",
        "name": "infernoflow Session",
        "type": "webview"
      }]
    },
    "commands": [
      { "command": "infernoflow.logGotcha",    "title": "Log Gotcha",           "category": "infernoflow", "icon": "$(warning)" },
      { "command": "infernoflow.logDecision",  "title": "Log Decision",         "category": "infernoflow", "icon": "$(check)" },
      { "command": "infernoflow.logAttempt",   "title": "Log Failed Attempt",   "category": "infernoflow", "icon": "$(error)" },
      { "command": "infernoflow.logNote",      "title": "Log Note",             "category": "infernoflow", "icon": "$(note)" },
      { "command": "infernoflow.ask",          "title": "Ask Memory",           "category": "infernoflow", "icon": "$(search)" },
      { "command": "infernoflow.switch",       "title": "Generate Handoff",     "category": "infernoflow", "icon": "$(arrow-swap)" },
      { "command": "infernoflow.recap",        "title": "Show Recap",           "category": "infernoflow", "icon": "$(graph)" },
      { "command": "infernoflow.scan",         "title": "Scan Project",         "category": "infernoflow", "icon": "$(search-fuzzy)" },
      { "command": "infernoflow.openPanel",    "title": "Open Session Panel",   "category": "infernoflow", "icon": "$(flame)" },
      { "command": "infernoflow.cloudSync",    "title": "Cloud Sync Now",       "category": "infernoflow", "icon": "$(cloud-upload)" },
      { "command": "infernoflow.cloudPull",    "title": "Cloud Pull",           "category": "infernoflow", "icon": "$(cloud-download)" },
      { "command": "infernoflow.upgrade",      "title": "Upgrade to Pro",       "category": "infernoflow", "icon": "$(star-full)" }
    ],
    "keybindings": [
      { "command": "infernoflow.logGotcha",   "key": "ctrl+alt+g", "mac": "cmd+alt+g" },
      { "command": "infernoflow.logDecision", "key": "ctrl+alt+d", "mac": "cmd+alt+d" },
      { "command": "infernoflow.ask",         "key": "ctrl+alt+a", "mac": "cmd+alt+a" },
      { "command": "infernoflow.switch",      "key": "ctrl+alt+s", "mac": "cmd+alt+s" },
      { "command": "infernoflow.recap",       "key": "ctrl+alt+r", "mac": "cmd+alt+r" }
    ],
    "menus": {
      "editor/context": [
        { "command": "infernoflow.logGotcha",   "group": "infernoflow@1" },
        { "command": "infernoflow.logDecision", "group": "infernoflow@2" }
      ],
      "view/title": [{
        "command": "infernoflow.cloudSync",
        "when": "view == infernoflow.sessionView",
        "group": "navigation"
      }]
    },
    "configuration": {
      "title": "infernoflow",
      "properties": {
        "infernoflow.enabled":                          { "type": "boolean", "default": true },
        "infernoflow.showGutterIcons":                  { "type": "boolean", "default": true },
        "infernoflow.showCodeLens":                     { "type": "boolean", "default": true },
        "infernoflow.showStatusBar":                    { "type": "boolean", "default": true },
        "infernoflow.showDiagnostics":                  { "type": "boolean", "default": true },
        "infernoflow.autoCapture.fileReverts":           { "type": "boolean", "default": true },
        "infernoflow.autoCapture.repeatedEdits":         { "type": "boolean", "default": true },
        "infernoflow.autoCapture.repeatedEditsThreshold":{ "type": "number",  "default": 5 },
        "infernoflow.autoCapture.sessionEnd":            { "type": "boolean", "default": true },
        "infernoflow.notifications":                     { "type": "string",  "default": "important", "enum": ["all","important","none"] },
        "infernoflow.cloudSync.autoSync":                { "type": "boolean", "default": true },
        "infernoflow.cloudSync.endpoint":                { "type": "string",  "default": "https://cloud.infernoflow.dev" }
      }
    }
  }
}
```

---

## 16. Build Priority & Timeline

### Phase 1: MVP (Publish at v0.3.0)

| Version | Features | Effort | Milestone |
|---|---|---|---|
| **v0.1.0** | Status bar + Command palette (log/ask/switch) | 2 days | Core UX — usable immediately |
| **v0.2.0** | Sidebar TreeView (session memory browser) | 2 days | Visual — impressive for demos |
| **v0.3.0** | Editor diagnostics (gotcha warnings in files) | 1 day | **→ PUBLISH TO MARKETPLACE** |

### Phase 2: Polish

| Version | Features | Effort |
|---|---|---|
| **v0.4.0** | Gutter icons + CodeLens | 1 day |
| **v0.5.0** | Auto-capture (reverts, repeated edits, session end) | 2 days |
| **v0.6.0** | Bottom panel (session timeline webview) | 2 days |

### Phase 3: The Killer Feature

| Version | Features | Effort |
|---|---|---|
| **v0.7.0** | Copilot Chat integration (context injection) | 2 days |
| **v0.8.0** | Right-click context menu + keyboard shortcuts polish | 1 day |

### Phase 4: Revenue

| Version | Features | Effort |
|---|---|---|
| **v1.0.0** | Cloud sync UI + Pro upsells + Pro badge | 1 day |
| **v1.1.0** | Cross-project search (Pro) | 1 day |

### Total: ~15 days from start to v1.0.0

---

## 17. Marketplace Strategy

### When to Publish

Publish at **v0.3.0** — that gives you:
- ✅ Status bar (always visible)
- ✅ Command palette (log/ask/switch — core functionality)
- ✅ Sidebar (browse memory visually)
- ✅ Editor diagnostics (gotchas appear in files)

That's a **strong first impression**. Ship early, iterate fast.

### Marketplace Listing

**Name:** `infernoflow — AI Session Memory`

**Short description:** `Persistent memory for AI coding sessions. Gotchas, decisions, and failed attempts — visible in your editor, injected into your AI.`

**Tags:** `ai`, `memory`, `copilot`, `cursor`, `session`, `context`, `mcp`

**Category:** AI

### Marketplace README Structure

```markdown
# 🔥 infernoflow — AI Session Memory

> Your AI forgets everything between sessions.
> infernoflow remembers.

## Features

[Screenshot: status bar showing session health]

### Log gotchas, decisions, and failed attempts
[GIF: Cmd+Shift+P → Log Gotcha → typing → saved]

### See warnings where they matter
[Screenshot: editor with gotcha diagnostic on function]

### Browse session memory in the sidebar
[Screenshot: sidebar TreeView with gotchas, decisions]

### Generate handoffs when switching AI agents
[GIF: clicking Switch → handoff copied → paste into Cursor]

### Cloud sync your memory across devices (Pro)
[Screenshot: ☁️ Synced indicator]

## Keyboard Shortcuts
| Command | Shortcut |
|---|---|
| Log Gotcha | Ctrl+Alt+G |
| Ask Memory | Ctrl+Alt+A |
| Generate Handoff | Ctrl+Alt+S |

## Works with
- GitHub Copilot
- Cursor
- Claude Code
- Windsurf
- Any AI that reads context files

## Pro Features
☁️ Cloud sync · Cross-project search · AI-powered recap
→ [Get Pro](https://infernoflow.dev/pro)
```

### Screenshots Needed (5 Total)

| # | Screenshot | Shows |
|---|---|---|
| 1 | Status bar | Session health at a glance |
| 2 | Sidebar TreeView | Gotchas, decisions, quick actions |
| 3 | Editor with diagnostics | Gotcha warning on a function |
| 4 | Command palette | All infernoflow commands |
| 5 | Handoff output | Switch command result |

### Launch Plan

| Day | Action |
|---|---|
| Day 1 | Publish v0.3.0 to marketplace |
| Day 1 | Tweet: "infernoflow is now a VS Code extension" + screenshot |
| Day 2 | Post on r/vscode: "I built an extension that gives AI agents memory" |
| Day 3 | Update npm README to mention the extension |
| Week 2 | Collect reviews, fix bugs, ship v0.4.0 |

---

*Last updated: April 28, 2026*
