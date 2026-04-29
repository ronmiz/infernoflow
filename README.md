# 🔥 infernoflow
> The forge for liquid code — keep capabilities, contracts, and docs in sync with your codebase.

## What it does
infernoflow ensures that when your code changes, your **capability contracts** and **documentation** stay in sync. It prevents semantic drift — where code evolves but no one knows what the system can actually do.

## Install
```bash
npm install -g infernoflow
# or:
npx infernoflow init
```

## Quick Start
```bash
npx infernoflow init
npx infernoflow install-cursor-hooks  # installs MCP server + .cursor/mcp.json
# Restart Cursor → Settings → MCP → infernoflow: 4 tools enabled
infernoflow status
infernoflow suggest "added email notifications"
infernoflow check
```

## Cursor MCP Integration (recommended)

After running `install-cursor-hooks`, infernoflow registers as an MCP server inside Cursor. No copy/paste — Cursor calls infernoflow tools directly in chat.

### Setup
```bash
infernoflow install-cursor-hooks
# Restart Cursor
# Settings → MCP → infernoflow: 4 tools enabled
```

### MCP tools

| Tool | What it does |
|---|---|
| `infernoflow_run` | Generates a task prompt from your contract |
| `infernoflow_apply` | Applies the JSON response — updates contract + CHANGELOG |
| `infernoflow_check` | Validates contract sync |
| `infernoflow_status` | Shows contract health |

### Workflow in Cursor chat
```
You: Use infernoflow_run with task "add search functionality"
Cursor: [calls infernoflow_run → returns prompt]
Cursor: [generates JSON]
Cursor: [calls infernoflow_apply]
→ contract.json, capabilities.json, CHANGELOG.md updated + validated
```

### Terminal fallback (without MCP)
```bash
infernoflow run "add search functionality"
# writes inferno/agent-prompt.md and waits
# paste prompt into Cursor/Claude → save JSON to inferno/agent-response.json
# infernoflow picks it up and applies automatically
```

## Commands

| Command | Description |
|---|---|
| `infernoflow init` | Scaffold inferno/ in your project |
| `infernoflow install-cursor-hooks` | MCP server + hooks + .cursor/mcp.json |
| `infernoflow install-vscode-copilot-hooks` | VS Code + Copilot hooks (Preview) |
| `infernoflow status` | Contract health at a glance |
| `infernoflow check` | Full validation |
| `infernoflow suggest` | AI-powered contract update |
| `infernoflow run` | One-command flow with rollback |
| `infernoflow implement` | Generate coding agent prompts |
| `infernoflow context` | Build AI session context |
| `infernoflow doc-gate` | Fail if docs not updated |
| `infernoflow pr-impact` | Analyze PR capability drift |

## CI Integration
```yaml
- name: infernoflow check
  run: npx infernoflow check --json
- name: infernoflow doc-gate
  run: npx infernoflow doc-gate --json
```

## Troubleshooting

- **MCP not showing in Cursor** — restart Cursor completely after install-cursor-hooks
- `ide_agent_bridge_not_configured` — use MCP tools in Cursor chat instead
- **infernoflow not found** — use `npx infernoflow` or install globally
- **PowerShell scripts disabled** — run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

## Why infernoflow?

AI-assisted development moves fast. Code changes daily. But what does the system *actually do*? infernoflow keeps the answer current — automatically.

## License
MIT