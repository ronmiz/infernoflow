# VS Code Marketplace Listing Copy

**Where to update:** `vscode-extension/package.json` + Marketplace publisher dashboard.

## Display name (< 32 chars)

```
infernoflow — AI Session Memory
```

## Short description (< 200 chars, shown in search results)

```
Persistent memory for GitHub Copilot Chat, Cursor, and Claude Code. Bookmarks + auto-transcript capture. Local, git-tracked, no telemetry. AMP protocol.
```

## Categories (order matters — first two show as tags)

```json
"categories": [
  "AI",
  "Chat",
  "Programming Languages",
  "Snippets",
  "Other"
]
```

**Important:** "AI" must be first. It's the strongest search category on Marketplace right now.

## Keywords / tags (searchable)

```json
"keywords": [
  "ai",
  "copilot",
  "github copilot",
  "copilot chat",
  "cursor",
  "claude code",
  "claude",
  "memory",
  "context",
  "session",
  "bookmark",
  "resume",
  "mcp",
  "language model tools",
  "lmt",
  "amp",
  "ai memory protocol",
  "gotcha",
  "decision log",
  "team memory",
  "productivity"
]
```

## Long description (Marketplace README section)

```markdown
## infernoflow — Persistent Memory for AI Coding Sessions

Every new AI session starts cold. The gotchas you found, the decisions you made, the dead ends you already tried — none of it survives. infernoflow makes them stick.

Works with **GitHub Copilot Chat** (via VS Code Language Model Tools), **Cursor**, and **Claude Code** (via MCP). One extension, three integrations, same JSONL memory file on disk.

### What you get

- **Auto-capture**: The AI logs gotchas, decisions, and dead ends by itself, mid-session, via native tools (`amp_write`, `amp_read`, `amp_bookmark`).
- **Session bookmarks**: Type "bookmark this" — a `beforeSubmitPrompt` hook drops a resume point deterministically. On Claude Code, it auto-harvests the session transcript so you can pick up exactly where you left off.
- **In-editor squigglies**: Logged gotchas appear as yellow underlines on the exact lines they reference. You see the warning while typing — before Copilot does.
- **Git-tracked memory**: The `.ai-memory/` folder travels with your branch. Teammate checks out your branch → they inherit your context. No manual doc updates.
- **Marker-wrapped rule files**: The extension writes to `.github/copilot-instructions.md`, `.cursorrules`, and `CLAUDE.md` inside marker blocks. Your existing rules outside the blocks are preserved.

### Why LMT for Copilot?

VS Code's Language Model Tools API (`vscode.lm.registerTool`) is the zero-config extension surface — and Copilot Chat supports MCP too (since VS Code 1.102); infernoflow ships both. infernoflow registers `amp_write` and `amp_read` there, and Copilot invokes them like native tools — no config, no manual copy-paste.

### Local-first & secure

- No telemetry. No analytics.
- No `postinstall` script. `npm install -g infernoflow` copies files only.
- No network calls in any default command path.
- Secret patterns (`sk-*`, `ghp_*`, `-----BEGIN`) rejected at write time.
- Optional AI enrichment commands opt-in via `infernoflow ai setup` — same trust model as using your AI provider directly.

Full policy: see `SECURITY.md` in the [repo](https://github.com/ronmiz/infernoflow).

### AMP — AI Memory Protocol

The memory format is an MIT-licensed, vendor-neutral spec called AMP. Plain JSONL on disk. Anyone can implement it. Your memory shouldn't be locked to any single vendor's cloud.

### Setup — 60 seconds

1. Install this extension.
2. In terminal:

   ```bash
   npm install -g infernoflow
   cd your-project
   infernoflow init --yes
   ```

3. Open Copilot Chat / Cursor / Claude Code and start coding.

The `init` detects which AI clients you have and wires the right integration files. The extension picks up the same `.ai-memory/` folder automatically.

### Quick start with bookmarks

Mid-session, type: **"bookmark this before I try the auth rewrite"**

Result:
- `beforeSubmitPrompt` hook catches the phrase (in Cursor)
- OR the AI calls `amp_bookmark` on its own (Claude / MCP-capable clients)
- OR you run `infernoflow bookmark "before auth rewrite"` in terminal

Any path stores the resume point (with harvested transcript on Claude Code) at `.ai-memory/details/<id>.md`.

Next session: `infernoflow switch` surfaces the bookmark. Your AI picks up with full context.

### Learn more

- Site: https://www.infernoflow.dev
- npm CLI: [`infernoflow`](https://www.npmjs.com/package/infernoflow)
- Repo: [github.com/ronmiz/infernoflow](https://github.com/ronmiz/infernoflow) (MIT-licensed)
- Docs: `/docs` in the repo

Feedback and issues welcome.
```

## Marketplace-specific checks before publish

1. **Publisher name** matches account (`vsce login <publisher>`)
2. **Icon** — 128x128 PNG at `vscode-extension/icon.png` (some marketplaces require 256x256, verify)
3. **`galleryBanner`** in package.json — pick a color that matches site
4. **`repository.url`** points to the public GitHub repo (not the SSH form)
5. **`bugs.url`** points to the Issues tab
6. **Version** matches CLI (0.7.19 latest per commits; bump for launch to signal fresh)
7. **`preview: false`** — remove any `"preview": true` if present. It downweights the extension in search.

## Command

```powershell
cd C:\Ron\projects\infernoflow-pkg\vscode-extension
npm run package     # produces .vsix
npx vsce publish    # or: npx vsce publish patch  (bumps + publishes)
```

If you get "Missing publisher name": `npx vsce login <publisher>` first.
