# 🔥 infernoflow
> Persistent memory for AI coding sessions — captures what agents can't infer from code alone.

AI agents forget everything between sessions. They repeat mistakes you already fixed, ignore decisions you already made, and miss landmines that burned you last week. infernoflow gives every agent a memory that persists.

Works standalone in any terminal, as a VS Code extension, and as an MCP server inside Claude Code, Cursor, and GitHub Copilot — silently and automatically.

---

## The problem

Every time you start a new AI session, the agent starts cold. It doesn't know:
- The gotcha you discovered last Tuesday (don't use X, it breaks Y)
- The approach you tried and abandoned (3 hours down the drain)
- The design decisions your team made (we use Tailwind, never inline styles)
- What you were working on when you handed off to a different agent

So you tell it again. And again. And it still misses things.

## The solution

infernoflow keeps a memory file — `inferno/sessions.jsonl` — that travels with the project. It captures gotchas, decisions, failed attempts, and preferences in real time. Every AI agent that opens this project reads the memory first.

```bash
infernoflow log "don't use bcrypt v3 — breaks on Windows" --type gotcha
infernoflow log "decided to use server actions over API routes" --type decision
infernoflow log "tried react-query for this, performance was worse" --type attempt --result failed
```

When you switch agents or start a new session, `infernoflow switch` generates a handoff summary — all the gotchas, decisions, and failed attempts for this session — formatted for pasting at the start of the next chat.

When you're wrapping up, `infernoflow recap` shows your session health score: what you captured, what git changes weren't logged, and a nudge to capture the last landmines before you go.

---

## Install

```bash
npm install -g infernoflow
```

## Quick Start

```bash
# Initialize infernoflow in your project
infernoflow init

# Log something you just discovered
infernoflow log "auth token expires in 15 min, not 1h — caught us off-guard" --type gotcha

# Query what's in memory before starting work
infernoflow ask "auth"

# At end of session — see what's captured and what isn't
infernoflow recap

# Hand off to a new agent — generates a briefing to paste at session start
infernoflow switch

# Set up MCP server (Cursor / Claude Code) for automatic memory use
infernoflow setup --yes
```

---

## Session memory commands

| Command | What it does |
|---|---|
| `infernoflow log "..." --type gotcha` | Log a landmine — things that will burn the next agent |
| `infernoflow log "..." --type decision` | Record a design decision and why |
| `infernoflow log "..." --type attempt --result failed` | "Don't repeat this" |
| `infernoflow log "..." --type preference` | Developer habits the agent should match |
| `infernoflow ask "keyword"` | Search memory — gotchas surface first |
| `infernoflow ask --recent` | What was logged in the last session |
| `infernoflow recap` | Session summary + health score + unlogged git changes |
| `infernoflow switch` | Handoff briefing for the next AI agent |
| `infernoflow stats` | Value dashboard — entries, token savings, coverage |

### Log types

| Type | Icon | Purpose | Token value |
|---|---|---|---|
| `gotcha` | ⚠ | Landmines, unexpected behavior, "don't do X" | Highest |
| `decision` | ✓ | Architecture and design choices made | High |
| `attempt` | ↺ | Approaches tried — especially failures | Medium |
| `preference` | ♦ | Code style, tools, naming conventions | Medium |
| `theme` | ◈ | Design system changes — colors, fonts, tokens | Medium |
| `note` | · | General notes | Low |

---

## MCP integration — fully automatic memory

After `infernoflow setup --yes`, infernoflow runs as an MCP server inside Claude Code and Cursor. Agents call infernoflow tools automatically — the developer never has to think about it.

```bash
infernoflow setup --yes                    # Claude Code / Cursor
infernoflow install-cursor-hooks           # Cursor only
infernoflow install-vscode-copilot-hooks   # VS Code + Copilot
```

### How it works in practice

```
You: "add search to the task list"
Claude: [calls infernoflow_ask "search" — finds gotcha: "avoid full-text search on tasks table, perf issues"]
Claude: "One note before I start — previous attempt at full-text search hit perf issues. I'll use..."
Claude: [writes code, calls infernoflow_suggest → contract updated silently]
```

### MCP tools

| Tool | When it fires | What it does |
|---|---|---|
| `infernoflow_status` | Session start | Contract health snapshot |
| `infernoflow_context` | Session start | Load full project state into AI context |
| `infernoflow_ask` | Before any implementation | Search memory for gotchas, decisions, failed attempts |
| `infernoflow_implement` | Before writing code | Generate structured implementation plan |
| `infernoflow_suggest` | After code changes | Update capability contract silently |
| `infernoflow_check` | Session end | Validate contract sync |
| `infernoflow_recap` | Session end | Show unlogged topics, nudge for gotchas |
| `infernoflow_review` | Pre-push / PR | Check capability drift risk |
| `infernoflow_synthesize` | Every ~5 sessions | Detect repeating workflows, suggest agents |
| `infernoflow_log` | Anytime | Log a memory entry directly from chat |
| `infernoflow_switch` | Agent handoff | Generate handoff briefing |
| `infernoflow_scan` | On request | Deep code scan — route discovery, entry points |
| `infernoflow_stats` | On request | Memory + value dashboard |

---

## Session recap

`infernoflow recap` gives you a D-to-A session health score at the end of every session.

```
  🔥 infernoflow recap
  Session since: 27 Apr, 09:15

  Captured this session

  ⚠ gotcha        (2h ago)
    don't use bcrypt v3 — breaks on Windows ARM

  ✓ decision       (1h ago)
    using server actions over API routes — simpler auth context

  ─────────────────────────────────────────────────

  Changed but not logged  (git diff since session start)

  ? database
      prisma/migrations/20260427_add_tokens.sql
      src/lib/db.ts

  Any gotchas or decisions from these areas worth capturing?

  ─────────────────────────────────────────────────

  Session health

  B  72/100

  ✔  2 entries logged
  ✔  gotchas captured
  ·  no decisions recorded
```

---

## Handoff between agents

`infernoflow switch` builds a handoff briefing — all gotchas, decisions, and failed attempts from the current session — formatted to paste at the start of the next AI chat.

```bash
infernoflow switch             # generate inferno/HANDOFF.md
infernoflow switch --copy      # copy to clipboard
infernoflow switch --to cursor # label it for the next agent
infernoflow switch --all       # include all-time memory, not just this session
```

The generated briefing puts gotchas first — the most critical things the next agent needs to know — before any capability context or design system info.

---

## Capability contract (what was here before)

infernoflow also tracks your project's capabilities — what the system actually does — and keeps contracts, changelogs, and docs in sync automatically as code changes. This is the original infernoflow feature.

```bash
infernoflow check       # validate contract + capabilities
infernoflow scan        # detect capabilities from source code
infernoflow suggest     # AI-powered contract update
infernoflow status      # contract health at a glance
infernoflow diff        # what changed since last tag
```

The memory layer (log, ask, recap, switch) and the capability layer (check, scan, suggest, contract) work together — scan detects what you built, memory records the gotchas you hit while building it.

---

## VS Code Extension

Install `infernoflow-X.X.X.vsix` from the `vscode-extension/` folder in the repo.

**What the extension does:**
- **Status bar** — permanent `🔥 infernoflow: 12 caps ✓` badge with quick actions menu
- **Save-triggered sync** — when you save a mapped source file, infernoflow runs `suggest` + `check` in the background (3s debounce). Zero manual steps.
- **Drift notification** — if check finds issues after a save, a one-time warning appears
- **Sidebar panels** — Capabilities, Scenarios, Changelog, Agents tree views
- **AI review** — uses Claude Code / Copilot model directly, no extra key needed

---

## AI Provider Setup

infernoflow uses AI for `explain`, `why`, `review`, `changelog ai`, and auto contract sync.

```bash
infernoflow ai setup    # interactive numbered menu
infernoflow ai status   # show configured providers
infernoflow ai test     # test AI connection
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

## All commands

### Memory
| Command | Description |
|---|---|
| `infernoflow log "..." --type <type>` | Append to session memory |
| `infernoflow ask "keyword"` | Search memory by topic — gotchas first |
| `infernoflow recap` | End-of-session summary + health score |
| `infernoflow switch` | Handoff briefing for the next AI agent |
| `infernoflow stats` | Memory value dashboard |
| `infernoflow theme` | Scan + record design system (colors, fonts, tokens) |

### Contract
| Command | Description |
|---|---|
| `infernoflow init` | Scaffold `inferno/` in your project |
| `infernoflow status` | Contract health at a glance |
| `infernoflow check` | Full contract validation |
| `infernoflow suggest "what changed"` | AI-powered contract update |
| `infernoflow scan` | AST scan — detect capabilities from code |
| `infernoflow diff` | Capability changes since last tag |
| `infernoflow stability` | Frozen / stable / experimental markers |

### Intelligence
| Command | Description |
|---|---|
| `infernoflow explain src/auth.ts` | Explain a file's capabilities |
| `infernoflow why src/auth.ts` | Map file → contract capabilities |
| `infernoflow review` | AI review of staged changes |
| `infernoflow graph` | Capability dependency graph |
| `infernoflow impact` | Blast radius of a change |
| `infernoflow coverage` | Map test files to capabilities |

### Workflow
| Command | Description |
|---|---|
| `infernoflow implement "task"` | Generate a structured coding plan |
| `infernoflow context` | Build AI session context file |
| `infernoflow watch` | Auto-run suggest on every file save |
| `infernoflow synthesize` | Detect repeating workflows → auto-agents |
| `infernoflow version` | Recommend semver bump |
| `infernoflow changelog update` | Draft Unreleased section from commits |

### Ops
| Command | Description |
|---|---|
| `infernoflow doctor` | Full diagnostic with auto-fix suggestions |
| `infernoflow setup --yes` | Install MCP server, CLAUDE.md, git hooks |
| `infernoflow ci` | CI/CD integration helper |
| `infernoflow audit` | Security audit of capabilities |
| `infernoflow health` | Health score (0–100) |
| `infernoflow export` | Export contract to OpenAPI / CSV / Markdown |
| `infernoflow demo` | Narrated 7-step walkthrough |

---

## CI Integration

```yaml
- name: infernoflow check
  run: npx infernoflow check --json

- name: infernoflow doc-gate
  run: npx infernoflow doc-gate --json
```

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

## License
MIT
