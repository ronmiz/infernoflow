# 🔥 infernoflow
> The forge for liquid code — keep capabilities, contracts, and docs in sync automatically as your codebase evolves.

## What it does

infernoflow prevents **semantic drift** — where code changes daily but nobody knows what the system actually does. It tracks your project's capabilities, keeps contracts up to date, and works silently in the background so developers never have to think about it.

Works standalone in any terminal, as a VS Code extension, and as an MCP server inside Claude Code, Cursor, and GitHub Copilot.

## Install

```bash
npm install -g infernoflow
```

## Quick Start

```bash
# Initialize infernoflow in your project
infernoflow init

# Set up AI provider (Anthropic, OpenAI, Gemini, OpenRouter, or Ollama)
infernoflow ai setup

# Set up MCP server for Claude Code / Cursor
infernoflow setup --yes

# Check project health
infernoflow doctor
```

---

## AI Provider Setup

infernoflow uses AI for `explain`, `why`, `review`, `changelog ai`, and auto contract sync.

```bash
infernoflow ai setup    # interactive numbered menu
infernoflow ai status   # show configured providers
infernoflow ai test     # send a test prompt
infernoflow ai clear    # remove a provider's key
```

Supported providers — no API key needed for Ollama:

| Provider | Env variable | Default model |
|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | claude-sonnet-4-6 |
| OpenAI (GPT) | `OPENAI_API_KEY` | gpt-4o |
| Google Gemini | `GOOGLE_AI_API_KEY` | gemini-2.0-flash |
| OpenRouter | `OPENROUTER_API_KEY` | any model |
| Ollama (local) | — | llama3.2 |

If you have **Claude Code for VS Code** or **GitHub Copilot**, infernoflow picks up the active model automatically — no API key required.

---

## MCP Integration (Claude Code / Cursor / Copilot)

After setup, infernoflow registers as an MCP server. Claude Code and Cursor call infernoflow tools automatically — no manual commands needed.

```bash
infernoflow setup --yes                    # Claude Code / Cursor
infernoflow install-cursor-hooks           # Cursor only
infernoflow install-vscode-copilot-hooks   # VS Code + Copilot
```

### MCP tools available in chat

| Tool | What it does |
|---|---|
| `infernoflow_status` | Contract health snapshot |
| `infernoflow_context` | Load full project state into AI context |
| `infernoflow_suggest` | Update capability contract from a description |
| `infernoflow_apply` | Apply a JSON suggestion — updates contract + CHANGELOG |
| `infernoflow_check` | Validate contract sync |
| `infernoflow_implement` | Generate a structured implementation plan |
| `infernoflow_review` | Check for capability drift risk |
| `infernoflow_synthesize` | Detect repeating workflows and turn them into agents |
| `infernoflow_version` | Recommend semver bump based on capability changes |
| `infernoflow_git_drift` | Detect drift between git commits and contract |

### How it works in Claude Code

```
You: "add search functionality to the task list"
Claude: [calls infernoflow_implement → structured plan]
Claude: [writes the code]
Claude: [calls infernoflow_suggest → contract updated silently]
→ capabilities.json, contract.json, CHANGELOG.md stay in sync
```

---

## VS Code Extension

Install `infernoflow-X.X.X.vsix` from the `vscode-extension/` folder in the repo.

**What the extension does:**
- **Status bar** — permanent `🔥 infernoflow: 12 caps ✓` badge. Click for quick actions menu.
- **Save-triggered sync** — when you save a source file mapped in `capability-map.json`, infernoflow automatically runs `suggest` + `check` in the background (3s debounce). Zero manual steps.
- **Drift notification** — if check finds issues after a save, a one-time warning appears with a "View check" button.
- **Right-click → Sync contract** — right-click any `.ts`/`.js`/`.py` file to manually sync.
- **Sidebar panels** — Capabilities, Scenarios, Changelog, Agents tree views.
- **Inline annotations** — capability IDs shown next to matching functions.
- **AI review** — uses Claude Code / Copilot model directly, no extra key needed.

---

## Commands

### Core
| Command | Description |
|---|---|
| `infernoflow init` | Scaffold `inferno/` in your project |
| `infernoflow status` | Contract health at a glance |
| `infernoflow check` | Full contract validation |
| `infernoflow doctor` | Full diagnostic with auto-fix suggestions |
| `infernoflow setup --yes` | Install MCP server, CLAUDE.md, git hooks |

### AI
| Command | Description |
|---|---|
| `infernoflow ai setup` | Interactive AI provider setup |
| `infernoflow ai status` | Show configured providers |
| `infernoflow ai test` | Test AI connection |
| `infernoflow suggest "what changed"` | AI-powered contract update |
| `infernoflow explain src/auth.ts` | Explain a file's capabilities |
| `infernoflow why src/auth.ts` | Map file to contract capabilities |
| `infernoflow review` | AI review of staged changes |
| `infernoflow changelog ai` | AI-generated changelog entry |

### Code Intelligence
| Command | Description |
|---|---|
| `infernoflow scan` | AST scan — detect capabilities from code |
| `infernoflow graph` | Capability dependency graph |
| `infernoflow impact` | Blast radius of a change |
| `infernoflow coverage` | Map test files to capabilities |
| `infernoflow stability` | Show frozen/stable/experimental capabilities |
| `infernoflow freeze <cap>` | Lock a capability (prevents accidental changes) |

### Workflow
| Command | Description |
|---|---|
| `infernoflow watch` | Auto-run suggest on every file save |
| `infernoflow run` | One-command detect → propose → apply flow |
| `infernoflow implement "task"` | Generate a structured coding plan |
| `infernoflow context` | Build AI session context file |
| `infernoflow diff` | Show capability changes since last tag |
| `infernoflow version` | Recommend semver bump |
| `infernoflow changelog update` | Draft Unreleased section from commits |

### Ops
| Command | Description |
|---|---|
| `infernoflow ci` | CI/CD integration helper |
| `infernoflow report` | Generate capability report |
| `infernoflow snapshot save <name>` | Save a contract snapshot |
| `infernoflow export` | Export contract to various formats |
| `infernoflow audit` | Security audit of capabilities |
| `infernoflow health` | Health score (0–100) |
| `infernoflow demo` | Narrated 7-step walkthrough |

### Agents
| Command | Description |
|---|---|
| `infernoflow synthesize` | Detect repeating workflows → auto-agents |
| `infernoflow agent run <name>` | Run a synthesized agent |
| `infernoflow test` | Run capability scenario tests |

---

## CI Integration

```yaml
- name: infernoflow check
  run: npx infernoflow check --json

- name: infernoflow doc-gate
  run: npx infernoflow doc-gate --json
```

---

## Watch Mode

Zero-effort contract sync while you code:

```bash
infernoflow watch           # watches src/ (auto-detected)
infernoflow watch src lib   # watch specific directories
infernoflow watch --interval 5   # 5s debounce
```

On every source file save, infernoflow checks if the file is mapped to any capabilities, runs `suggest` silently, and logs any issues to `inferno/WATCH.log`.

---

## Stability Markers

Tag capabilities as frozen, stable, or experimental:

```bash
infernoflow freeze auth-login      # lock — no changes allowed
infernoflow thaw auth-login        # unlock
infernoflow stability              # view all markers
```

Frozen capabilities are protected from accidental contract changes.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `infernoflow not found` | Use `npx infernoflow` or `npm install -g infernoflow` |
| MCP not showing in Cursor | Restart Cursor after `install-cursor-hooks` |
| `apply` command fails | Ensure `infernoflow ai setup` is done |
| No AI provider | Run `infernoflow ai setup` or set `ANTHROPIC_API_KEY` |
| PowerShell scripts disabled | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |
| `infernoflow doctor` shows warnings | Run `infernoflow doctor --fix` to auto-fix |

---

## Why infernoflow?

AI-assisted development moves fast. Code changes daily. But what does the system *actually do*? infernoflow keeps the answer current — automatically, invisibly, without interrupting the developer.

## License
MIT
