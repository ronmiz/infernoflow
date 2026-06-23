# 🔥 infernoflow

> Persistent memory for AI coding sessions. Capture what agents can't infer from code — the gotchas, the decisions, the failed approaches — and replay it into your next chat so you stop re-deriving context every time you open Cursor / Claude Code / Copilot.

[![npm version](https://img.shields.io/npm/v/infernoflow.svg?color=orange)](https://www.npmjs.com/package/infernoflow)
[![npm downloads](https://img.shields.io/npm/dw/infernoflow.svg?color=orange)](https://www.npmjs.com/package/infernoflow)
[![zero runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](./package.json)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/infernoflow.infernoflow?label=VS%20Code&color=orange)](https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

## The loop

Every new AI session today starts cold. The agent re-reads your code, re-derives the obvious, and often re-makes the same wrong move someone else made yesterday. infernoflow closes that loop in four stages:

1. **Capture** — while you and the agent work, certain moments are worth saving: a gotcha hit, a decision made, an attempted fix that failed, a pattern noticed. The agent writes them down automatically via the `amp_write` MCP tool — no copy/paste, no `git commit -m`. A protocol block injected into the rule files teaches the AI exactly when to log — e.g. when you type `!!`, `retry`, `not working`, `still broken`, or describe a `Plan:` — and a Cursor `beforeSubmitPrompt` hook backstops the AI by scanning your prompt for those triggers and writing the entry deterministically when the AI doesn't.
2. **Link** — each captured moment becomes a structured AMP entry (`gotcha | decision | attempt | note | detection | pattern`) with timestamp, file:line, tags, and a stable AMP id. Linked into the project, not your scratchpad.
3. **Persist** — entries land in `.ai-memory/branches/<branch>.jsonl` (git-tracked, travels with your branch — teammates inherit it) plus `.ai-memory/global.jsonl` (personal preferences, gitignored, synced across your machines via any OS-synced folder).
4. **Restore** — when a new session starts, the agent reads `CLAUDE.md` / `.cursorrules` / `copilot-instructions.md` at boot. The most relevant entries are already there. Warm start; no cold derivation.

That's it. No service to log into. No SaaS. JSONL on disk, an MCP server, and three rule files your IDE already reads.

## Install

```bash
npm install -g infernoflow
infernoflow init --yes
```

Zero runtime dependencies. Works on Node ≥ 18 — macOS, Linux, Windows.

`init --yes` does the whole setup: creates `.ai-memory/`, writes rule files for every supported IDE, wires the MCP server for Cursor / VS Code Copilot / Claude Code in one shot, applies the clean-tree git policy, and drops a visible demo entry so you can confirm the loop is alive with one command:

```bash
infernoflow status
```

## The 5-command core + 1

These cover 95% of usage:

| Command | What it does |
|---|---|
| `infernoflow log "..."` | Remember a gotcha / decision / attempt / note. `--type gotcha\|decision\|attempt\|preference` |
| `infernoflow ask "..."` | Search your memory by keyword — gotchas surface first |
| `infernoflow switch` | Generate a handoff for the next session. `--copy` puts it on your clipboard |
| `infernoflow recap` | End-of-session summary with health score + unlogged-change detection |
| `infernoflow status` | Quick health check — entries, gotchas, decisions, last activity |
| `infernoflow refresh` | Manually rebuild `CLAUDE.md` / `.cursorrules` / `copilot-instructions.md` from memory |
| `infernoflow forget <id|prefix>` | Delete a memory entry without hand-editing JSONL. `--last` for the newest. |
| `infernoflow prune` | Archive stale `note` / `attempt` entries older than 30 days. Gotchas/decisions never auto-pruned. Default dry-run; `--apply` to act. |

In practice you barely run any of these — the MCP-aware AI does it for you. The CLI is for grep-style introspection.

`infernoflow commands` shows the full list (~20 commands, grouped by purpose).

## Keeping it lean: token budget + rotation

The injected memory block is paid for on every AI turn (and twice when a tool loads both `CLAUDE.md` and `copilot-instructions.md`). infernoflow ships lean defaults — 4 entries, 5 commits, 200-char per-entry truncation — and gives you knobs to tune further. Set once in `.ai-memory/amp.json`:

```jsonc
"config": {
  "injection": {
    "maxEntries": 4,                          // memory entries injected
    "maxCommits": 5,                          // git commits injected
    "maxEntryChars": 200,                     // per-entry truncation
    "targets": ["CLAUDE.md", ".cursorrules"], // drop a file from the list and its stale block is stripped automatically
    "includeProtocol": true                   // false drops the ~17-line capture protocol (advanced)
  },
  "rotation": {
    "archiveAfterDays": 30,
    "archivableTypes": ["note", "attempt", "detection"],
    "auto": false                             // true → silent prune on every `log`
  }
}
```

Or write the same values via CLI flags:

```bash
infernoflow setup   --max-memory 3 --max-commits 5 --max-entry-chars 200 --no-protocol
infernoflow refresh --max-memory 3                   # same; persists into amp.json
infernoflow prune --apply --max-age-days 14          # one-off cleanup
```

**Rotation** archives stale `note` / `attempt` / `detection` entries to `.ai-memory/archive/sessions-YYYY-MM.jsonl` — invisible to the merged read (so the AI, sidebar, `ask`, and `refresh` stop surfacing them) but still on disk if you want them back. `gotcha`, `decision`, and `pattern` entries are **never auto-pruned** — that's the knowledge you logged infernoflow FOR.

## Branch-aware memory + cross-machine sync

**Your teammate takes your branch — they inherit your memory.**

```
.ai-memory/
├── branches/
│   ├── main.jsonl              ← project-wide truths (git-tracked)
│   └── feature-auth.jsonl      ← your current branch's work (git-tracked)
├── global.jsonl                ← your personal preferences (gitignored)
└── sessions.jsonl              ← legacy flat file (still read)
```

- **Captures on a feature branch travel with that branch via git.** When a teammate runs `git checkout feature-auth`, the JSONL is there. Their MCP server boots, reads it, regenerates their rule files — their AI is warm-started on *your* findings without you sending a message.
- **Personal preferences travel between your own machines.** Point at any OS-synced folder once:
  ```
  infernoflow sync set ~/Dropbox/infernoflow-memory
  ```
  Home → work → home. No infra to stand up; the OS does the sync.
- **`merge=union` on branch JSONLs** means concurrent commits from different machines merge cleanly — no manual conflict resolution.
- **Branch switching never blocked.** Rule files refresh only at MCP server boot or via explicit `infernoflow refresh`, not on every entry — your working tree stays clean while you log.

## Cross-IDE — same memory, every tool

The rule files at the top level of your project are what every AI agent reads on boot. infernoflow writes the same canonical block to all three:

| Tool | Reads from |
|---|---|
| Claude Code | `CLAUDE.md` |
| Cursor | `.cursorrules` |
| GitHub Copilot (VS Code, JetBrains) | `.github/copilot-instructions.md` |

Plus MCP for tools that speak it — Cursor, Claude Code, VS Code Copilot Chat. The MCP server is wired by `infernoflow setup` / `init` into each tool's config file. No per-tool setup.

## MCP tools (for AI agents)

When the MCP server is wired, your AI agent can call these directly in chat:

| Tool | What it does |
|---|---|
| `amp_write` | Log an entry (`type`, `msg`, optional `file` / `line` / `tags`) |
| `amp_read` | Read entries with optional filters |
| `amp_search` | Keyword search across entries |
| `amp_handoff` | Generate the handoff document for the next AI session |
| `amp_health` | Session health score (A–F) |
| `infernoflow_status` | Memory + project health at a glance |
| `infernoflow_check` | Validate the capability contract (read-only) |
| `infernoflow_context` | Generate AI-ready context for a task |
| `infernoflow_git_drift` | Detect which capabilities recent commits affected |

The `amp_*` tools follow the [AMP MCP spec §7.3](docs/protocol/PROTOCOL.md#73-mcp-tool-interface) — vendor-neutral. Any AMP-Full client only needs to know those five names. The same five are also available as CLI aliases (`infernoflow amp read | write | search | handoff | health`) so the CLI and MCP surfaces match name-for-name.

Every memory line injected into the rule files is prefixed with `🔥` so the AI (and you) can tell at a glance that a line came from infernoflow even when it's quoted out of the managed block.

## What it has caught (real dogfood)

infernoflow was developed by building a multi-tenant kanban (`infernotest_01`) and capturing what it surfaced. A sample of real entries from that dogfood:

- **gotcha** (`vite.config.ts`): *"Vite proxy with `changeOrigin: true` rewrites the Host header — server-side URL construction produces URLs pointing at the BACKEND port. Build user-facing URLs client-side via `window.location.origin`."*
- **gotcha** (`server/prisma/schema.prisma`): *"Prisma 6 `query_engine.dll.node` is locked while tsx watch is running; `prisma migrate dev` fails with EPERM on rename. Stop the dev server before migrating."*
- **gotcha** (`server/src/routes/members.ts`): *"Invite accept must NOT burn the token when the caller is already a member of the workspace — return early with the existing membership before marking acceptedAt."*
- **pattern** (`server/src/routes/columns.ts`): *"Position assignment for ordered children: next position = max(existing) + 1024. The 1024 step leaves room for ~10 inserts between two siblings without renumbering."*
- **pattern** (`server/src/access.ts`): *"Cross-entity auth helpers do `where: { memberships: { where: { userId } } }` via Prisma nested-select — one DB hop per assertion. Return 404 not 403 when not a member to avoid leaking existence."*
- **decision** (`server/src/auth.ts`): *"Opaque session tokens in a Session table (not JWTs) — chosen so we can revoke per-session (`deleteMany` on Session). bcryptjs over native bcrypt to avoid platform-specific binaries."*

These are the things you'd otherwise forget by next Tuesday and re-derive at 11pm on a Friday. They live in `.ai-memory/branches/*.jsonl` forever.

## VS Code extension

The companion extension renders your memory as a live sidebar — ranked-by-relevance gotchas/decisions for whatever file you're editing, status bar health score, inline CodeLens annotations at gotcha locations.

```
ext install infernoflow.infernoflow
```

Or in the Marketplace: [infernoflow.infernoflow](https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow). Activates on any project with `.ai-memory/` (or legacy `inferno/`).

The extension is **window only** in v0.7.9+ — the CLI is the single canonical writer of rule files. No race between extension and CLI; the extension watches `.ai-memory/**/*.jsonl` and renders.

## Troubleshooting

- **I upgraded infernoflow but `amp_write` entries still look wrong.** Your IDE's MCP server is loaded into memory at session start and doesn't reload from disk. **Quit and reopen Cursor / Claude Code / VS Code.** `infernoflow doctor` will flag this with a "MCP runtime v… but CLI v…" warning.
- **`infernoflow` not found.** Use `npx infernoflow` until the global install resolves on your PATH.
- **PowerShell script execution blocked.** `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.
- **Box-drawing chars look broken.** Should auto-fall-back to ASCII on legacy PowerShell. If not, open an issue.
- **`infernoflow doctor`** — full diagnostic if anything looks wrong. Includes the MCP runtime stamp check + AI provider detection + git hooks status.

## Why this matters

Code changes daily. What the system *actually does* under all those edits — the invariants, the constraints, the things that bit you last week — code can't tell you. infernoflow keeps that current and feeds it to the agent so the agent stops re-deriving from scratch.

That's the whole product. No vendor lock-in (it's JSONL on disk). No SaaS. One CLI, one MCP server, three rule files your IDE was reading anyway.

## License

MIT

## Links

- [GitHub](https://github.com/ronmiz/infernoflow) · [npm](https://www.npmjs.com/package/infernoflow) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow) · [Issues](https://github.com/ronmiz/infernoflow/issues)
- [AMP protocol spec](docs/protocol/PROTOCOL.md) — vendor-neutral memory format
- [Dogfood: what infernoflow caught while building infernotest_01](docs/dogfood-infernotest_01.md)
