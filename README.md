# 🔥 infernoflow

> Persistent memory for AI coding sessions. Captures what agents can't infer from code: gotchas, decisions, dead ends. Replays it into your next AI chat so you stop re-deriving context every time.
>
> infernoflow is the reference CLI for [**AMP — the AI Memory Protocol**](docs/protocol/PROTOCOL.md). Any AMP-compatible tool can read your `.ai-memory/sessions.jsonl` — Cursor, Copilot, Claude, Windsurf, future agents. Vendor-neutral, file-based, zero deps.

[![npm version](https://img.shields.io/npm/v/infernoflow.svg?color=orange)](https://www.npmjs.com/package/infernoflow)
[![npm downloads](https://img.shields.io/npm/dw/infernoflow.svg?color=orange)](https://www.npmjs.com/package/infernoflow)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)
[![npm audit](https://img.shields.io/badge/npm%20audit-0%20vulnerabilities-brightgreen)](https://docs.npmjs.com/cli/v10/commands/npm-audit)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/infernoflow.infernoflow?label=VS%20Code&color=orange)](https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow)
[![status: alpha](https://img.shields.io/badge/status-alpha-yellow)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

> **⚠ Alpha — actively iterating.** Local memory operations (logging, search, handoff, AI rule-file injection) are stable. The product does ONE thing: persistent memory that any AI tool can read. No network calls in default command paths. See [SECURITY.md](./SECURITY.md) for the full data-flow disclosure.

## The 60-second pitch

Every new Copilot/Cursor/Claude session starts cold. The agent re-reads your code, ignores constraints that aren't expressed there, and often re-makes the same wrong move someone else made yesterday. infernoflow is a small CLI that captures *those things* — the API quirks, the failed approaches, the architectural decisions — and replays them into the next AI session as a clean handoff. One command. No paste, no copy, no manual setup.

## Install

```bash
npm install -g infernoflow
# or zero-install:
npx infernoflow init
```

Zero npm dependencies. Works on Node ≥ 18. Windows, macOS, Linux.

## Quick start (90 seconds)

```bash
cd your-project
infernoflow init                # 30-second setup, asks for your first gotcha
infernoflow log "API returns 202 not 200" --type gotcha
infernoflow log "use polling not websocket for progress" --type decision
infernoflow ask "API"           # search your memory
infernoflow switch --copy       # generate handoff, copy to clipboard
# paste into your next Cursor/Copilot/Claude chat — the agent picks up everything
```

## The 5-command core

These five cover 90% of usage:

| Command | What it does |
|---|---|
| `infernoflow log "..."` | Remember a gotcha, decision, attempt, or note. `--type gotcha\|decision\|attempt\|preference` |
| `infernoflow ask "..."` | Search your memory by keyword. Gotchas surface first. |
| `infernoflow switch` | Generate a handoff for your next AI session. `--copy` puts it on the clipboard. |
| `infernoflow recap` | End-of-session summary with health score and unlogged-change detection. |
| `infernoflow status` | Quick session-memory health check. |

Run `infernoflow commands` for the full grouped list (12 visible commands across Session Memory, Code Analysis, Workflow, Cloud, Setup; ~40 more available as aliases for backward compat).

## The AI Memory Protocol (AMP)

infernoflow stores memory in the AMP-canonical layout:

```
.ai-memory/
├── sessions.jsonl   # one AMP entry per line (gotchas, decisions, attempts, notes…)
├── amp.json         # project metadata
└── handoff.md       # generated handoff for AI agents
```

Each entry on disk is AMP wire format:

```json
{"type":"gotcha","msg":"API returns 202 not 200","ts":1714704000000,"id":"amp_01HXYZ...","file":"src/api.js","line":42}
```

The full spec is in [docs/protocol/PROTOCOL.md](docs/protocol/PROTOCOL.md). Any tool that can parse JSONL can read your memory — that's the whole point. infernoflow is currently the **AMP Full** reference implementation: read + write + handoff + injection across CLAUDE.md / .cursorrules / copilot-instructions.md.

Building your own AMP-compatible tool? Use the reference TS library:

```bash
npm install infernoflow-amp
```

If you have a project on the legacy `inferno/sessions.jsonl` layout, migrate with one command:

```bash
infernoflow amp migrate
```

The original `inferno/sessions.jsonl` is left in place — nothing is overwritten.

## Auto-context for AI agents

When you run `infernoflow log`, infernoflow silently keeps these files up to date so any AI agent reading them gets your latest gotchas/decisions automatically:

- `CLAUDE.md` — picked up by Claude Code
- `.cursorrules` — picked up by Cursor
- `.github/copilot-instructions.md` — picked up by GitHub Copilot

You don't have to paste anything. Set up once, every future session is better.

## VS Code extension

The companion extension turns the CLI into a live visual surface inside VS Code. Install it from the Marketplace:

```
ext install infernoflow.infernoflow
```

Or browse it [on the Marketplace](https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow). Activates automatically on any project containing `.ai-memory/sessions.jsonl` or `inferno/`.

**What you get (v0.7.4):**

The extension closes a real loop: **capture** the right thing → **rank** it for the file you're editing → **inject** it into the AI's context automatically.

#### Capture (zero-typing memory)

- **Auto-capture popup** — when you edit the same file 5+ times in 10 minutes, a popup asks "Stuck on something?" with [Log Gotcha] [Log Attempt] [Dismiss] buttons. Click once → entry is auto-written with timestamp, file:line, the enclosing function name, a 5-line code-context window, nearby TypeScript/ESLint diagnostics, AND failure/success-keyword excerpts from the recent agent conversation.
- **Agent conversation harvest** — if you've installed Cursor / Copilot hooks (`infernoflow install-cursor-hooks`), every agent exchange writes to `CONTEXT.draft.md`. Auto-capture pulls failure-signal lines (`error`, `cannot`, `still failing`) AND resolution-signal lines (`got it`, `the fix was`, `turns out`) so the gotcha tells the full arc — breakdown and breakthrough.
- **AI session summarize** — new "Summarize session with AI" action runs the recent conversation through Copilot (via VS Code LM API) or your configured AI provider, proposes 1–6 structured memory entries, shows them in a multi-select picker. Tick which to keep.
- **Bulk delete + orphan cleanup** — "Manage entries…" picker grouped by date for cleanups. "Cleanup orphaned entries…" finds entries whose source files were deleted (e.g., after refactor) for bulk removal.

#### Inject (closing the loop)

- **AI Context for [current file]** sidebar section — shows top 5 most-relevant entries for whatever file you're editing, scored by: same file (+100), same directory (+40), same extension (+10), recent (+20), type-weighted. Updates as you switch editors.
- **Auto-sync rule files** (default on, debounced 1.5s) — on every memory change OR editor switch, the extension rewrites `.cursorrules` / `CLAUDE.md` / `.github/copilot-instructions.md` with the current ranking. Recent git commits go at the top, top-5 most-relevant memory entries next, older context collapsed under `<details>`. Idempotent — uses delimiter comments, doesn't trample your manual edits. **Result: when you open a NEW AI chat in the same VS Code session, the AI tool reads the updated rule files at chat start and sees the right gotchas first — no manual "rebuild" step required.**
- **Inline CodeLens** — `🔥 ⚠ 2 gotchas · 1 failed · 1 decision` above any file with logged entries. Per-line annotations at gotcha locations. Click for full entry detail.
- **Editor diagnostics** — gotchas as yellow Warnings, failed attempts as blue Information squiggles. Copilot reads them.

#### Surface

- **Sidebar memory panel** — Session Health (A–F), AI Context for [current file], Gotchas, Decisions, Failed Attempts, Quick Actions, CLI Tools (one-click access to 11 CLI commands).
- **Status bar** — `🔥 B 65 · ⚠3 · ✓2 · ❌1 · 📋 Switch` with grade-based color coding.
- **Help tooltips everywhere** — hover any sidebar item for a description of what it does, when to use it, what happens when clicked.
- **Keyboard shortcuts** — `Ctrl+Alt+G/D/A/S/R` for log gotcha / log decision / ask memory / generate handoff / show recap.

## Cursor / VS Code MCP integration

```bash
infernoflow install-cursor-hooks
# Restart Cursor → Settings → MCP → infernoflow: 4 tools enabled

# or for VS Code + Copilot (Preview):
infernoflow install-vscode-copilot-hooks
```

After install-cursor-hooks, your AI agent can call infernoflow directly in chat:

| MCP tool | What it does |
|---|---|
| `infernoflow_run` | Generate a task prompt from your contract |
| `infernoflow_apply` | Apply the JSON response — updates contract + CHANGELOG |
| `infernoflow_check` | Validate contract sync |
| `infernoflow_status` | Show contract health |
| `infernoflow_context` | Generate AI-ready context for a new session |
| `infernoflow_implement` | Step-by-step code prompt for a specific task |
| `infernoflow_review` | Pre-merge capability drift check on the current branch |
| `infernoflow_git_drift` | Detect capabilities affected by recent commits |
| `infernoflow_scan_ui` | Detect UI / design-token changes vs contract |
| `amp_read` | **AMP-spec** alias — read entries with optional filters |
| `amp_write` | **AMP-spec** alias — log a new entry |
| `amp_handoff` | **AMP-spec** alias — generate the handoff document |
| `amp_search` | **AMP-spec** alias — search entries by keyword |
| `amp_health` | **AMP-spec** alias — session health score |

The `amp_*` tools are vendor-neutral aliases following the [AMP MCP spec §7.3](docs/protocol/PROTOCOL.md#73-mcp-tool-interface). Any AMP-Full client only needs to know these names — the `infernoflow_*` set stays for backward compat.

## Capability contracts (advanced)

The "memory" track above (Tier 1) is what most users want. infernoflow also ships a heavier "contracts" track for teams that want machine-checked guarantees about what their codebase *does*:

```bash
infernoflow init --mode full  # set up contract.json, capabilities, scenarios
infernoflow scan              # AST-walk to discover capabilities
infernoflow freeze CreateItem # mark a capability as protected — AI won't modify it
infernoflow impact CreateItem # blast radius before changes
infernoflow check             # CI gate
```

Most users don't need this. If you do, run `infernoflow demo` for an interactive walkthrough.

## CI integration

```yaml
- name: infernoflow check
  run: npx infernoflow check --json
- name: infernoflow doc-gate
  run: npx infernoflow doc-gate --json
```

Or use the GitHub Action:

```yaml
- uses: ronmiz/infernoflow-action@v1
```

## Troubleshooting

- **MCP not showing in Cursor** — fully quit and relaunch Cursor after `install-cursor-hooks`.
- **`infernoflow not found`** — use `npx infernoflow` or `npm install -g infernoflow`.
- **PowerShell script execution blocked** — `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.
- **`infernoflow doctor`** — runs a full diagnostic if anything looks wrong.
- **Box-drawing chars look broken in PowerShell** — should auto-fall-back to ASCII; if not, you're on a non-WT_SESSION shell, please open an issue.

## Why infernoflow?

Code changes daily. But what does the system *actually do*? What did someone try last week that didn't work? What invariants are load-bearing? infernoflow keeps the answer current — and feeds it to your AI agent so it stops re-deriving from scratch.

## License

MIT

## Links

- [GitHub](https://github.com/ronmiz/infernoflow)
- [npm](https://www.npmjs.com/package/infernoflow)
- [Issues](https://github.com/ronmiz/infernoflow/issues)
