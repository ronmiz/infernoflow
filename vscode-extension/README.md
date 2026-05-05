# 🔥 infernoflow — AI Session Memory

> Your AI forgets everything between sessions. **infernoflow remembers.**

Persistent memory for AI coding sessions. Captures what agents can't infer from code — gotchas, decisions, dead ends — and replays them into your next AI chat (Copilot, Cursor, Claude, Windsurf) so the same mistake never happens twice.

This extension is the visual surface over [**AMP — the AI Memory Protocol**](https://github.com/ronmiz/infernoflow/blob/main/docs/protocol/PROTOCOL.md). Memory lives in `.ai-memory/sessions.jsonl`, vendor-neutral and file-based.

## Features

### 🔥 Always-on session-memory sidebar

A dedicated sidebar shows your session at a glance — health score, gotchas with file paths, decisions in effect, failed attempts to avoid. Click any entry to jump to the file:line where it was logged.

### ⚠️ Gotchas appear as Problem-panel warnings

Logged a gotcha with a file path? Open that file — the gotcha now shows as a yellow squiggle in the editor and a row in the **Problems panel**, right next to your TypeScript errors. Both *you* and *Copilot* see the warning before making the same mistake again.

### 📋 One-click handoff for the next AI session

Click `📋 Switch` in the status bar or hit `Ctrl+Alt+S` (`Cmd+Alt+S` on Mac). The CLI generates a clean gotchas-first markdown handoff and copies it to your clipboard. Paste into any AI chat — the AI now knows about all your project's landmines.

### ⌨️ Keyboard-first logging

| Shortcut | Command |
|---|---|
| `Ctrl+Alt+G` (`Cmd+Alt+G` Mac) | Log a gotcha |
| `Ctrl+Alt+D` | Log a decision |
| `Ctrl+Alt+A` | Ask memory (search) |
| `Ctrl+Alt+S` | Generate handoff |
| `Ctrl+Alt+R` | Show session recap |

The extension also adds a right-click menu to the editor — log a gotcha for the current line without leaving the file.

### 🔍 Search your memory

`Ctrl+Alt+A` opens an inline search across every entry — gotchas, decisions, attempts. Pick a result to jump to the file.

### 📊 Live status-bar health score

Always visible: `🔥 B 65 · ⚠3 · ✓2 · ❌1 · 📋 Switch`. Click the score to open the sidebar; click `Switch` to copy the handoff.

## Requirements

- Install the [`infernoflow` CLI](https://www.npmjs.com/package/infernoflow) (one-liner: `npm install -g infernoflow`).
- Run `infernoflow init` in your project to create `.ai-memory/sessions.jsonl`.

That's it. The extension activates automatically as soon as your workspace contains the AMP layout (or the legacy `inferno/` folder).

## Configuration

| Setting | Default | What it does |
|---|---|---|
| `infernoflow.cliPath` | `infernoflow` | Path to the CLI (used for `switch` and `recap`). Override if not on PATH. |
| `infernoflow.showStatusBar` | `true` | Show session-health summary in the status bar. |
| `infernoflow.showDiagnostics` | `true` | Show gotchas as warnings in the Problems panel. |
| `infernoflow.notifications` | `important` | `all` / `important` / `none`. Controls confirmation toasts. |

## How it pairs with the CLI

The extension reads `.ai-memory/sessions.jsonl` natively (no shelling). Writes go through the [`infernoflow-amp`](https://www.npmjs.com/package/infernoflow-amp) library — same shape, same ULIDs, same backward-compat for legacy `inferno/` projects.

`switch` and `recap` shell out to the `infernoflow` CLI for the heavy markdown generation. Everything else is in-process and instant.

## License

MIT.

## Links

- [GitHub](https://github.com/ronmiz/infernoflow)
- [npm — infernoflow CLI](https://www.npmjs.com/package/infernoflow)
- [npm — infernoflow-amp library](https://www.npmjs.com/package/infernoflow-amp)
- [AMP v1.0 spec](https://github.com/ronmiz/infernoflow/blob/main/docs/protocol/PROTOCOL.md)
