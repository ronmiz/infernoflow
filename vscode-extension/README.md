# infernoflow for VS Code & Cursor

Live capability status panel for [infernoflow](https://github.com/ronmiz/infernoflow) — keeps your AI sessions, contracts, and docs in sync.

## Features

- **Sidebar panel** — see all capabilities and their scenario coverage at a glance
- **Status bar item** — `infernoflow: 8/8 caps` always visible at the bottom
- **Scenarios view** — browse scenario files inline
- **Changelog view** — see unreleased entries without opening a file
- **Auto-refresh** — panel updates whenever `inferno/**` files change
- **Command palette** — run `infernoflow check`, `context`, `diff`, `changelog update` from inside VS Code

## Requirements

- `infernoflow` CLI installed globally: `npm install -g infernoflow`
- A project with `inferno/contract.json` (run `infernoflow init` to create one)

## Commands

| Command | Description |
|---|---|
| `infernoflow: Refresh` | Reload the status panel |
| `infernoflow: Run Check` | Run `infernoflow check` in terminal |
| `infernoflow: Update Context` | Run `infernoflow context` and open CONTEXT.md |
| `infernoflow: Open CONTEXT.md` | Open the context file |
| `infernoflow: Draft Changelog Entry` | Run `infernoflow changelog update` |
| `infernoflow: Show Capability Diff` | Run `infernoflow diff` |

## Settings

| Setting | Default | Description |
|---|---|---|
| `infernoflow.cliPath` | `infernoflow` | Path to CLI (if not on PATH) |
| `infernoflow.autoRefreshInterval` | `30` | Seconds between auto-refresh (0 = off) |

## Works in Cursor too

Since Cursor is built on VS Code, this extension installs and works identically in Cursor. Install via the Extensions panel (`Ctrl+Shift+X`) and search for `infernoflow`.
