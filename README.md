# 🔥 infernoflow

> **Every new AI session starts cold — the gotchas you found, the decisions you made, don't survive. infernoflow makes them stick.**
>
> Persistent memory for AI coding sessions. Captures the gotchas, decisions and dead ends your code can't tell an agent — and replays them into your next Cursor / Claude Code / Copilot chat so the same wrong turn never happens twice.

[![npm version](https://img.shields.io/npm/v/infernoflow.svg?color=orange)](https://www.npmjs.com/package/infernoflow)
[![npm downloads](https://img.shields.io/npm/dw/infernoflow.svg?color=orange)](https://www.npmjs.com/package/infernoflow)
[![zero runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](./package.json)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/infernoflow.infernoflow?label=VS%20Code&color=orange)](https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

You spent 90 minutes yesterday teaching Claude that your auth API returns `200` even on errors — check the response body, not the status code. Today you ask the same kind of question and watch it write `if (response.ok) { return data }` all over again. The AI didn't get worse overnight. **It just doesn't have memory.**

infernoflow is a local-first CLI + VS Code extension + open protocol (AMP) that gives your AI persistent context across sessions. No SaaS. JSONL on disk. Three rule files your IDE already reads.

---

## What's new — 🆕 v0.44.10: session bookmarks

Drop a **named resume point** mid-session. When the context window fills up or you're about to make a risky change, one command captures the current session's transcript and stores it as a jumpable checkpoint:

```bash
infernoflow bookmark "before the SP refactor"
```

Or just say it in chat — the Cursor `beforeSubmitPrompt` hook catches phrases like `"bookmark this"` / `"mark this point"` / `"save this checkpoint"` and drops the bookmark itself, no AI cooperation required. Or let the AI do it via the `amp_bookmark` MCP tool when it notices the session is getting long.

**No `--note`?** infernoflow reads Claude Code's own on-disk transcript (`~/.claude/projects/…/*.jsonl`), distills the last 40 turns to markdown, and stores it as the bookmark's context. Fully deterministic — no model call. Recall any time:

```bash
infernoflow bookmark list                # ● has context, ○ marker only
infernoflow bookmark show "SP refactor"  # jump back — see the whole snapshot
```

Bookmarks are **never auto-pruned**, and they surface in `infernoflow switch` under a `## 🔖 Bookmarks — Resume Points` section so the next session opens right where work paused.

---

## The loop

Every new AI session today starts cold. The agent re-reads your code, re-derives the obvious, and re-makes the same wrong move someone else made yesterday. infernoflow closes that loop in four stages:

1. **Capture** — while you and the agent work, moments worth saving get logged automatically: a gotcha hit, a decision made, an attempted fix that failed, a pattern noticed, a resume point marked. The AI writes them via the `amp_write` MCP tool. A protocol block injected into the rule files teaches it exactly when. A Cursor `beforeSubmitPrompt` hook backstops the AI by scanning your prompt for triggers (`!!`, `retry`, `not working`, `still broken`, `bookmark this`) and writing the entry deterministically when the AI doesn't.
2. **Link** — each captured moment becomes a structured AMP entry (`gotcha | decision | attempt | note | detection | pattern | bookmark`) with timestamp, `file:line`, tags, and a stable AMP id.
3. **Persist** — entries land in `.ai-memory/branches/<branch>.jsonl` (git-tracked, travels with your branch — teammates inherit it) plus `.ai-memory/global.jsonl` (personal preferences, gitignored, synced across your machines via any OS-synced folder).
4. **Restore** — when a new session starts, the agent reads `CLAUDE.md` / `.cursorrules` / `copilot-instructions.md` at boot. The most relevant entries are already there. **Warm start; no cold derivation.**

No service to log into. No SaaS. JSONL on disk, an MCP server, and three rule files your IDE already reads.

---

## Install

```bash
npm install -g infernoflow
infernoflow init --yes
```

Zero runtime dependencies. Works on Node ≥ 18 — macOS, Linux, Windows.

`init --yes` does the whole setup: creates `.ai-memory/`, writes rule files for every supported IDE, wires the MCP server for Cursor / VS Code Copilot / Claude Code in one shot, applies the clean-tree git policy, and drops a visible demo entry so you can confirm the loop is alive with:

```bash
infernoflow status
```

---

## The 5-command core + 4

These cover 95% of usage:

| Command | What it does |
|---|---|
| `infernoflow log "..."` | Remember a gotcha / decision / attempt / note. `--type gotcha\|decision\|attempt\|preference` |
| `infernoflow ask "..."` | Search your memory by keyword — gotchas surface first |
| `infernoflow switch` | Generate a handoff for the next session. `--copy` puts it on your clipboard |
| `infernoflow recap` | End-of-session summary with health score + unlogged-change detection |
| `infernoflow status` | Quick health check — entries, gotchas, decisions, last activity |
| `infernoflow bookmark "..."` | **🆕** Drop a named resume point — auto-captures the session transcript as its context. `list` / `show <id\|label>` / `rm` round it out. Surfaces in `switch`. Never auto-pruned. |
| `infernoflow refresh` | Manually rebuild `CLAUDE.md` / `.cursorrules` / `copilot-instructions.md` from memory |
| `infernoflow forget <id\|prefix>` | Delete a memory entry without hand-editing JSONL. `--last` for the newest |
| `infernoflow prune` | Archive stale `note` / `attempt` entries older than 30 days. Gotchas/decisions/bookmarks never auto-pruned. Default dry-run; `--apply` to act |

In practice you barely run any of these — the MCP-aware AI does it for you. The CLI is for grep-style introspection.

`infernoflow commands` shows the full list (~23 commands, grouped by purpose).

---

## Works with GitHub Copilot Chat (via VS Code LMT — not MCP)

**GitHub Copilot Chat doesn't support MCP.** Every other AI memory tool assumes MCP is the transport, so none of them work with Copilot Chat.

The infernoflow **VS Code extension** registers `amp_write` and `amp_read` as native **VS Code Language Model Tools** — Copilot's supported extension surface. So Copilot can log a gotcha or recall a past decision **on its own**, mid-conversation, the moment it notices something worth remembering. Nothing to wire up: install the extension and Copilot's tool picker shows `🔥 amp_write`. Call by hand with `#amp_write` / `#amp_read` in the chat box.

Cursor and Claude Code get the same capability through the MCP server the CLI installs. **Same protocol, same disk file, three transports** — MCP for Cursor/Claude, LMT for Copilot, native Node in the extension.

---

## Keeping it lean: token budget + rotation

The injected memory block is paid for on every AI turn (and twice when a tool loads both `CLAUDE.md` and `copilot-instructions.md`). infernoflow ships lean defaults — 4 entries, 5 commits, 200-char truncation, and a **compact ~3-line protocol** (the full trigger table is redundant with the `amp_*` tool descriptions, so it's off by default: ~430 tokens/file/turn saved). Tune further in `.ai-memory/amp.json`:

```jsonc
"config": {
  "injection": {
    "maxEntries": 4,                          // memory entries injected
    "maxCommits": 5,                          // git commits injected
    "maxEntryChars": 200,                     // per-entry truncation
    "targets": ["CLAUDE.md", ".cursorrules"], // drop a file from the list and its stale block is stripped automatically
    "protocolStyle": "compact"                // "compact" (default) · "full" (restore the trigger table) · "off"
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

**Rotation** archives stale `note` / `attempt` / `detection` entries to `.ai-memory/archive/sessions-YYYY-MM.jsonl` — invisible to the merged read (so the AI, sidebar, `ask`, and `refresh` stop surfacing them) but still on disk if you want them back. `gotcha`, `decision`, `pattern`, and `bookmark` entries are **never auto-pruned** — that's the knowledge you logged infernoflow FOR.

**Two-tier bodies (new in 0.44.10):** any entry can carry a rich `detail` — stored in `.ai-memory/details/<id>.md`, loaded on demand via `readDetail()`, and **never injected into rule files**. The lean index stays lean; you pay for the body only when you open it. `log --detail`, `--detail-file`, MCP `amp_write` `detail`, and the new `amp_bookmark` tool all feed it.

---

## Branch-aware memory + cross-machine sync

**Your teammate takes your branch — they inherit your memory.**

```
.ai-memory/
├── branches/
│   ├── main.jsonl              ← project-wide truths (git-tracked)
│   └── feature-auth.jsonl      ← your current branch's work (git-tracked)
├── details/                    ← Tier-2 rich bodies (loaded on demand)
│   └── amp_01HXYZ....md
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

---

## Cross-IDE — same memory, every tool

| Tool | Reads from | Writes via |
|---|---|---|
| Claude Code | `CLAUDE.md` | MCP (`amp_write`) |
| Cursor | `.cursorrules` | MCP (`amp_write`) + `beforeSubmitPrompt` hook |
| GitHub Copilot Chat (VS Code) | `.github/copilot-instructions.md` | **VS Code LMT** (`amp_write`) — extension only, no MCP |
| GitHub Copilot (JetBrains) | `.github/copilot-instructions.md` | rule files only (read-only surface) |
| Windsurf | `.windsurfrules` | MCP (planned) |

The MCP server is wired by `infernoflow setup` / `init` into each tool's config file. No per-tool setup.

---

## MCP tools (for AI agents)

When the MCP server is wired, your AI agent can call these directly in chat:

| Tool | What it does |
|---|---|
| `amp_write` | Log an entry (`type`, `msg`, optional `file` / `line` / `tags` / `detail`) |
| `amp_read` | Read entries with optional filters |
| `amp_search` | Keyword search across entries |
| `amp_bookmark` | **🆕** Drop a named resume point — auto-captures the current session transcript when no `note` is given |
| `amp_handoff` | Generate the handoff document for the next AI session |
| `amp_health` | Session health score (A–F) |
| `infernoflow_status` | Memory + project health at a glance |
| `infernoflow_check` | Validate the capability contract (read-only) |
| `infernoflow_context` | Generate AI-ready context for a task |
| `infernoflow_git_drift` | Detect which capabilities recent commits affected |

The `amp_*` tools follow the [AMP MCP spec §7.3](docs/protocol/PROTOCOL.md#73-mcp-tool-interface) — vendor-neutral. Any AMP-Full client only needs to know those six names. The same six are also available as CLI aliases (`infernoflow amp read | write | search | bookmark | handoff | health`) so the CLI and MCP surfaces match name-for-name.

Every memory line injected into the rule files is prefixed with `🔥` so the AI (and you) can tell at a glance that a line came from infernoflow even when it's quoted out of the managed block. When the AI uses one, the protocol tells it to briefly cite the source — e.g. *🔥 (from infernoflow memory) gotcha at src/api.js:42: API returns 202 not 200*.

---

## What it has caught (real dogfood)

infernoflow was developed by building a multi-tenant kanban (`infernotest_01`) and capturing what it surfaced. A sample of real entries from that dogfood:

- **gotcha** (`vite.config.ts`): *"Vite proxy with `changeOrigin: true` rewrites the Host header — server-side URL construction produces URLs pointing at the BACKEND port. Build user-facing URLs client-side via `window.location.origin`."*
- **gotcha** (`server/prisma/schema.prisma`): *"Prisma 6 `query_engine.dll.node` is locked while tsx watch is running; `prisma migrate dev` fails with EPERM on rename. Stop the dev server before migrating."*
- **gotcha** (`server/src/routes/members.ts`): *"Invite accept must NOT burn the token when the caller is already a member of the workspace — return early with the existing membership before marking acceptedAt."*
- **pattern** (`server/src/routes/columns.ts`): *"Position assignment for ordered children: next position = max(existing) + 1024. The 1024 step leaves room for ~10 inserts between two siblings without renumbering."*
- **pattern** (`server/src/access.ts`): *"Cross-entity auth helpers do `where: { memberships: { where: { userId } } }` via Prisma nested-select — one DB hop per assertion. Return 404 not 403 when not a member to avoid leaking existence."*
- **decision** (`server/src/auth.ts`): *"Opaque session tokens in a Session table (not JWTs) — chosen so we can revoke per-session (`deleteMany` on Session). bcryptjs over native bcrypt to avoid platform-specific binaries."*

These are the things you'd otherwise forget by next Tuesday and re-derive at 11pm on a Friday. They live in `.ai-memory/branches/*.jsonl` forever.

---

## VS Code extension

The companion extension is the visual surface over your memory:

- **Live sidebar** — ranked-by-relevance gotchas / decisions / attempts for whatever file you're editing.
- **Gotchas as Problems** — logged with a `file:line`? They appear as yellow squigglies in the editor and rows in the **Problems panel**, right next to your TypeScript errors. Both *you* and *Copilot* see the warning before making the same mistake again.
- **Status bar health score** — always visible: `🔥 B 65 · ⚠3 · ✓2 · ❌1 · 📋 Switch`. Click `Switch` to copy the handoff.
- **Copilot Chat integration** — `#amp_write` / `#amp_read` in the chat box; Copilot picks them up automatically via VS Code LMT (see above).
- **Keyboard-first logging** — `Ctrl+Alt+G` (gotcha) / `Ctrl+Alt+D` (decision) / `Ctrl+Alt+A` (ask) / `Ctrl+Alt+S` (switch) / `Ctrl+Alt+R` (recap). Right-click in the editor to log a gotcha for the current line.

```
ext install infernoflow.infernoflow
```

Or in the Marketplace: [infernoflow.infernoflow](https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow). Activates on any project with `.ai-memory/` (or legacy `inferno/`).

The extension is **window only** in v0.7.9+ — the CLI is the single canonical writer of rule files. No race between extension and CLI; the extension watches `.ai-memory/**/*.jsonl` and renders.

---

## Troubleshooting

- **I upgraded infernoflow but `amp_write` entries still look wrong.** Your IDE's MCP server is loaded into memory at session start and doesn't reload from disk. **Quit and reopen Cursor / Claude Code / VS Code.** `infernoflow doctor` will flag this with a "MCP runtime v… but CLI v…" warning.
- **`infernoflow` not found.** Use `npx infernoflow` until the global install resolves on your PATH.
- **PowerShell script execution blocked.** `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.
- **Box-drawing chars look broken.** Force UTF-8 first: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`. Should auto-fall-back to ASCII on legacy PowerShell. If not, open an issue.
- **`infernoflow doctor`** — full diagnostic if anything looks wrong. Includes the MCP runtime stamp check + AI provider detection + git hooks status.

---

## Why this matters

Code changes daily. What the system *actually does* under all those edits — the invariants, the constraints, the things that bit you last week — code can't tell you. infernoflow keeps that current and feeds it to the agent so the agent stops re-deriving from scratch.

That's the whole product. No vendor lock-in (it's JSONL on disk). No SaaS. One CLI, one VS Code extension, one open protocol, three rule files your IDE was reading anyway.

---

## Security & privacy

Local-first by design:

- 🚫 **No telemetry.** No analytics, no error reporting, no install pings.
- 🚫 **No `postinstall` script.** `npm install -g infernoflow` runs no code — it only copies files.
- 🚫 **No network calls in any default command path.** Everything runs on your machine.
- 🚫 **No auto-updates, no background processes, no cloud sync.**
- ✅ **Reads and writes only inside your project directory** (`.ai-memory/`, plus the three rule files at repo root).
- ✅ **Auto-injected content is wrapped in markers** (`<!-- infernoflow:start -->` / `<!-- infernoflow:end -->`) — your manual edits outside the block are never touched.
- ✅ **Secret patterns rejected on capture** — entries matching `sk-`, `ghp_`, `-----BEGIN` are refused at the AMP writer.

The optional `infernoflow ai setup` command wires an AI provider (Anthropic / OpenAI / Google / Ollama) for a few enrichment commands — same trust model as using that provider directly. Off by default.

Full policy: [SECURITY.md](./SECURITY.md). Vulnerability reports: `hello@infernoflow.dev` or [GitHub Security Advisory](https://github.com/ronmiz/infernoflow/security/advisories/new).

---

## License

MIT

## Links

- [GitHub](https://github.com/ronmiz/infernoflow) · [npm](https://www.npmjs.com/package/infernoflow) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow) · [Issues](https://github.com/ronmiz/infernoflow/issues) · [infernoflow.dev](https://www.infernoflow.dev)
- [AMP protocol spec](docs/protocol/PROTOCOL.md) — vendor-neutral memory format
- [Dogfood: what infernoflow caught while building infernotest_01](docs/dogfood-infernotest_01.md)
- [Why your AI coding assistant has amnesia](docs/BLOG_POST.md) — the case for the protocol
