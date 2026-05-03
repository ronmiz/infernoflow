# 🔥 infernoflow

> Persistent memory for AI coding sessions. Captures what agents can't infer from code: gotchas, decisions, dead ends. Replays it into your next AI chat so you stop re-deriving context every time.
>
> infernoflow is the reference CLI for [**AMP — the AI Memory Protocol**](docs/protocol/PROTOCOL.md). Any AMP-compatible tool can read your `.ai-memory/sessions.jsonl` — Cursor, Copilot, Claude, Windsurf, future agents. Vendor-neutral, file-based, zero deps.

[![npm version](https://img.shields.io/npm/v/infernoflow.svg?color=orange)](https://www.npmjs.com/package/infernoflow)
[![npm downloads](https://img.shields.io/npm/dw/infernoflow.svg?color=orange)](https://www.npmjs.com/package/infernoflow)

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

Run `infernoflow commands` for the full grouped list (51 commands across Session Memory, Code Analysis, Workflow, Cloud, Setup, Advanced).

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

## Cloud sync (optional)

```bash
infernoflow login          # GitHub Device Flow — no PKCE, no callback server
infernoflow whoami
```

Once logged in, every `infernoflow log` quietly mirrors the entry to a Supabase project so your memory survives across machines. Push is fire-and-forget; local always succeeds even if cloud is down.

> **Auth model (v0.38.x):** the cloud currently uses anonymous-key writes with a per-user `user_token` column. Anyone with the public anon key can write rows — fine for solo dev, not yet a security boundary. The schema is forward-compatible with authenticated mode; see `scripts/supabase-schema.sql` for the migration path.

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
