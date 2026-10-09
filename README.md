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

## What's new in 0.46

- **Fresh memory every Claude Code session** — a SessionStart hook injects current memory (framed as information to verify, not instructions); `CLAUDE.md` no longer carries a copy that goes stale.
- **`infernoflow resume`** — "where were we?" in one call. Claude Code also leaves an automatic local resume point when a session ends.
- **Stale and resolved entries** — entries about a file that changed since are marked *may be stale*; `infernoflow resolve <id>` retires one from AI context.
- **Review what arrives through git** (0.46.1) — memory added by teammates is listed until you review it, and the GitHub Action shows memory changes in each PR.
- **Safer by default** — only read-only MCP tools are pre-approved; the memory-keeper agent is limited to single `infernoflow` commands; secrets are redacted; MCP is registered per project.
- **`infernoflow doctor --e2e`** (0.46.3) — an end-to-end self-test in a throw-away sandbox: CLI, the MCP server with every tool called, the prompt and session hooks, git drift, attribution. Also: prompt hooks ignore agent/tool text, memory-mode projects aren't offered contract tools, git drift reports git failures, and every entry names who wrote it.

Full list: [CHANGELOG.md](./CHANGELOG.md).

## Session bookmarks

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

## 🆕 Proactive capture — a Claude skill + a memory-keeper agent

`init` now installs two things into `.claude/` so the loop runs itself on Claude Code:

- **`infernoflow-memory` skill** (`.claude/skills/`) — teaches the agent to start warm (`resume`), then proactively `log` real gotchas, decisions-with-a-*because*, dead ends, and durable preferences, and drop a `bookmark` at stopping points or when you say *"bookmark this"*. Capture is **balanced** — it skips routine steps, anything obvious from the code, secrets, and duplicates.
- **`memory-keeper` subagent** (`.claude/agents/`) — a specialist you can delegate to. It sweeps the session, dedupes against what's already stored, logs what's worth keeping, drops bookmarks, and reports back. It never edits code or logs secrets, and a guard limits its shell to single `infernoflow` read/log commands (blocked if the guard can't run).

Both are installed automatically by `infernoflow init` (fresh **and** on re-run of an existing project) and ship in the package — nothing to set up by hand.

---

## The loop

Every new AI session today starts cold. The agent re-reads your code, re-derives the obvious, and re-makes the same wrong move someone else made yesterday. infernoflow closes that loop in four stages:

1. **Capture** — while you and the agent work, moments worth saving get logged automatically: a gotcha hit, a decision made, an attempted fix that failed, a pattern noticed, a resume point marked. The AI writes them via the `amp_write` MCP tool. A protocol block injected into the rule files teaches it exactly when. Prompt hooks (Claude Code `UserPromptSubmit`, Cursor `beforeSubmitPrompt`) backstop the AI by scanning **the text you typed** — subagent hand-backs, system reminders, fenced or indented code, quotes and stack traces are skipped — for trouble signals (`not working`, `still broken`, `same error`; `!!` / `retry` only in short prompts) and writing the entry deterministically when the AI doesn't. The Cursor hook also turns *"bookmark this"* into a bookmark.
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

`init --yes` does the whole setup: creates `.ai-memory/`, writes rule files for every supported IDE, wires the MCP server for Cursor / VS Code Copilot / Claude Code in one shot, installs the `infernoflow-memory` skill + `memory-keeper` agent into `.claude/`, applies the clean-tree git policy, and drops a visible demo entry so you can confirm the loop is alive with:

```bash
infernoflow status
```

---

## The 5-command core + 4

These cover 95% of usage:

| Command | What it does |
|---|---|
| `infernoflow log "..."` | Remember a gotcha / decision / attempt / note. `--type gotcha\|decision\|attempt\|preference` |
| `infernoflow resume` | **🆕 0.46** "Where were we?" in one call — last resume point, open dead ends, recent decisions, uncommitted work. `--file <path>` ranks by file |
| `infernoflow ask "..."` | Search your memory by keyword — gotchas surface first. `--file <path>` ranks entries about that file first |
| `infernoflow switch` | Generate a handoff for the next session. `--copy` puts it on your clipboard |
| `infernoflow recap` | End-of-session summary with health score + unlogged-change detection; lists memory that arrived through git and marks it reviewed |
| `infernoflow status` | Quick health check — entries, gotchas, decisions, last activity |
| `infernoflow bookmark "..."` | **🆕** Drop a named resume point — auto-captures the session transcript as its context. `list` / `show <id\|label>` / `rm` round it out. Surfaces in `switch`. Never auto-pruned. |
| `infernoflow refresh` | Manually rebuild `CLAUDE.md` / `.cursorrules` / `copilot-instructions.md` from memory |
| `infernoflow forget <id\|prefix>` | Delete a memory entry without hand-editing JSONL. `--last` for the newest |
| `infernoflow prune` | Archive stale `note` / `attempt` entries older than 30 days. Gotchas/decisions/bookmarks never auto-pruned. Default dry-run; `--apply` to act |
| `infernoflow resolve <id>` | **🆕 0.46** Mark an entry fixed/outdated — stays searchable, no longer injected. Entries whose file changed since they were written show **"may be stale"** |
| `infernoflow curate` | **🆕 0.46** Remove noise: old commit notes, duplicates, raw frustration prompts. Dry-run; `--apply` |
| `infernoflow move <id…> --to <dir>` | **🆕 0.46** Move misfiled entries to another project's memory. Dry-run; `--apply` |

Any command takes `--project <dir>` to work on another project's memory (multi-folder workspaces, hooks, agents).

In practice you barely run any of these — the MCP-aware AI does it for you. The CLI is for grep-style introspection.

`infernoflow commands` shows the full list (~23 commands, grouped by purpose).

---

## Works with GitHub Copilot Chat — via LMT + MCP

Copilot Chat has supported MCP servers since VS Code 1.102 (GA July 2025), so any MCP-based memory tool can plug in. infernoflow ships **two transports side by side** so Copilot picks up the same six `amp_*` tools whichever path is available:

- **VS Code Language Model Tools (LMT).** The infernoflow VS Code extension registers `amp_write` and `amp_read` as native LMT tools. No per-project config, no MCP client setup — install the extension and Copilot's tool picker shows `🔥 amp_write`. Call by hand with `#amp_write` / `#amp_read` in the chat box.
- **MCP server.** `infernoflow init` wires the MCP server into `.vscode/mcp.json` too, so Copilot's MCP client can call the same tools if you prefer that route (or want them available to agent mode).

Cursor, Claude Code, and any MCP-capable client use the same MCP server. **One product, one disk file, multiple transports** — pick whichever fits your setup; both write to the same `.ai-memory/`.

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
infernoflow setup   --max-memory 3 --max-commits 5 --max-entry-chars 200 --protocol-style compact
infernoflow refresh --targets CLAUDE.md,.cursorrules # only these get the block; the rest are stripped
infernoflow refresh --targets auto                   # canonical file for the IDE you're in (kills Copilot's double-load)
infernoflow prune --apply --max-age-days 14          # one-off cleanup
```

**Rotation** archives stale `note` / `attempt` / `detection` entries to `.ai-memory/archive/sessions-YYYY-MM.jsonl` — invisible to the merged read (so the AI, sidebar, `ask`, and `refresh` stop surfacing them) but still on disk if you want them back. `gotcha`, `decision`, `pattern`, and `bookmark` entries are **never auto-pruned** — that's the knowledge you logged infernoflow FOR.

**Two-tier bodies:** any entry can carry a rich `detail` — stored in a single `.ai-memory/details.jsonl` (consolidated in 0.44.18; older per-entry `details/<id>.md` sidecars auto-migrate on the next write), loaded on demand via `readDetail()`, and **never injected into rule files**. The lean index stays lean; you pay for the body only when you open it. `log --detail`, `--detail-file`, MCP `amp_write` `detail`, and the new `amp_bookmark` tool all feed it.

---

## Branch-aware memory + cross-machine sync

**Your teammate takes your branch — they inherit your memory.**

```
.ai-memory/
├── branches/
│   ├── main.jsonl              ← project-wide truths (git-tracked)
│   └── feature-auth.jsonl      ← your current branch's work (git-tracked)
├── details.jsonl               ← long-form entry bodies (git-tracked, loaded on demand)
├── details.local.jsonl         ← bookmark transcript snapshots (gitignored, this machine only)
├── global.jsonl                ← your personal preferences (gitignored)
└── sessions.jsonl              ← everything this machine wrote (gitignored mirror)
```

- **Captures on a feature branch travel with that branch via git.** When a teammate runs `git checkout feature-auth`, the JSONL is there. Their MCP server boots, reads it, regenerates their rule files — their AI is warm-started on *your* findings without you sending a message.
- **You see what arrives.** Entries that reach your machine through git and that you haven't reviewed are listed by `infernoflow resume` (and in Claude Code's session-start context); `infernoflow recap` shows them and marks them reviewed. Tracked locally per machine, from the entry's content — not from the author it claims. Retire a wrong one with `infernoflow resolve <id>`.
- **Review memory in pull requests.** The GitHub Action ([`action/`](./action)) comments on each PR with the memory entries it adds, edits or deletes, so they are reviewed like code before they reach everyone's AI.
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
| GitHub Copilot Chat (VS Code) | `.github/copilot-instructions.md` | **VS Code LMT** (from the extension) + MCP (from `init`) — both wired |
| GitHub Copilot (JetBrains) | `.github/copilot-instructions.md` | MCP (`amp_write`, manual wiring) — JetBrains Copilot supports MCP (agent mode GA); `init` auto-wiring planned |
| Windsurf | `.windsurfrules` | MCP (`amp_write`, manual wiring) — Windsurf/Cascade supports MCP; `init` auto-wiring planned |

The MCP server is wired by `infernoflow setup` / `init` into each tool's config file. No per-tool setup.

---

## MCP tools (for AI agents)

When the MCP server is wired, your AI agent can call these directly in chat:

| Tool | What it does |
|---|---|
| `amp_write` | Log an entry (`type`, `msg`, optional `file` / `line` / `tags` / `detail`). In a multi-folder workspace an entry about another open folder's file goes to that folder's memory |
| `amp_resume` | **🆕 0.46** "Where were we?" — last resume point, open dead ends, recent decisions, uncommitted changes |
| `amp_read` | Read entries with optional filters (`type`, `query`, `file` — entries about that file rank first) |
| `amp_search` | Keyword search across entries |
| `amp_bookmark` | **🆕** Drop a named resume point — auto-captures the current session transcript when no `note` is given |
| `amp_handoff` | Generate the handoff document for the next AI session |
| `amp_health` | Session health score (A–F) |
| `infernoflow_status` | Memory + project health at a glance |
| `infernoflow_check` | Validate the capability contract (read-only). **Full mode only** — not listed in memory-mode projects |
| `infernoflow_context` | Generate AI-ready context for a task. **Full mode only** |
| `infernoflow_git_drift` | Files changed in the last commits and working tree — and, in full mode, which capabilities they affect. Says so when git is unavailable instead of reporting "no changes" |

Entries are stamped with who wrote them: the MCP client that called the tool (Claude, Cursor, Copilot, Windsurf…), `claude` for CLI calls from Claude Code, `memory-keeper` / `hook` for the agent and the prompt hooks, `human` for you. Set `INFERNOFLOW_AGENT` to override the automatic detection. Like the author, this is what the writer claims — useful for triage, not proof.

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
- **Copilot Chat integration** — `#amp_write` / `#amp_read` in the chat box; Copilot picks them up via VS Code Language Model Tools registered by the extension (works even without an MCP client configured).
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
- **`infernoflow doctor --e2e`** — if memory isn't being captured or a tool fails, this runs the whole chain in a temporary sandbox (your project and settings aren't touched): log → ask → forget, the MCP server with every tool called, the prompt and session hooks with sample input, git drift, and attribution. Paste its output into an issue.
- **`infernoflow check` says *memory mode*.** That's expected after a plain `init`: capability contracts are optional. Enable them with `infernoflow init --mode full --adopt`. In CI use `infernoflow check --strict`, which fails when the contract is missing.

---

## Why this matters

Code changes daily. What the system *actually does* under all those edits — the invariants, the constraints, the things that bit you last week — code can't tell you. infernoflow keeps that current and feeds it to the agent so the agent stops re-deriving from scratch.

That's the whole product. No vendor lock-in (it's JSONL on disk). No SaaS. One CLI, one VS Code extension, one open protocol, three rule files your IDE was reading anyway.

---

## Security & privacy

Local-first by design:

- ✅ **Telemetry is opt-in and off by default.** After a few runs in an interactive terminal infernoflow asks once; nothing is sent unless you answer yes. It never sends code, file paths or memory content. Check or change it with `infernoflow telemetry status`.
- 🚫 **No `postinstall` script.** `npm install -g infernoflow` runs no code — it only copies files.
- 🚫 **No network calls in any default command path** (with telemetry off, which is the default).
- 🚫 **No auto-updates of the package, no background processes, no cloud sync.**
- ✅ **MCP is registered per project.** Claude Code gets the project's own `.mcp.json` (gitignored — it holds this machine's paths); Cursor and VS Code get `.cursor/mcp.json` / `.vscode/mcp.json`. All of them run the server from the installed package (`infernoflow mcp`), not a copy inside the repo.
- ⚠️ **Writes outside the project:** Claude Desktop has no per-project config, so `setup` adds one entry per project there (`infernoflow-<repo>`). Pre-0.45 versions left a single `infernoflow` entry in `~/.claude.json` / the Desktop config that pinned every project to one repo; it is removed automatically (backup in `~/.infernoflow/backups/`). Personal settings and API keys live in `~/.infernoflow/`.
- ✅ **Auto-injected content is wrapped in markers** (`<!-- infernoflow:start -->` / `<!-- infernoflow:end -->`) — your manual edits outside the block are never touched.
- ✅ **Secrets are redacted before anything is written** — GitHub/npm/OpenAI/Anthropic/AWS/Google/Slack/Stripe tokens, JWTs, private keys, URL credentials and `password=`-style values become `[REDACTED:<kind>]`. Memory files are still plain text committed with your repo, so treat them like code: review `.ai-memory/` diffs.
- ✅ **Bookmark transcript snapshots stay on your machine** (`.ai-memory/details.local.jsonl`, gitignored). Only context you write explicitly (`--note`, `detail`) is shared with the team.
- ✅ **API keys never live in the project** — environment variables are used as-is; pasted keys go to `~/.infernoflow/ai-credentials.json` (owner-only).
- ✅ **No shell is used to run commands** from the MCP server or the prompt hooks (since 0.44.20), and MCP tool arguments are validated against their schema.
- ✅ **Only read-only tools are pre-approved** in Claude Code (`permissions.allow` in `.claude/settings.json`). Tools that write memory ask for your permission like any other tool, so text the AI reads can't silently write to shared memory.
- ✅ **Memory is data, not instructions.** Injected memory is framed that way, each entry records its author and the tool that wrote it, entries about a changed file are marked *may be stale*, and memory that arrived through git is listed until you review it (`resume` / `recap`).
- ✅ **The frustration hook keeps only a 60-character prefix** of the prompt that triggered it, and skips agent hand-backs, system reminders, code, quotes and stack traces in it.

The optional `infernoflow ai setup` command wires an AI provider (Anthropic / OpenAI / Google / Ollama) for a few enrichment commands — same trust model as using that provider directly. Off by default.

Full policy: [SECURITY.md](./SECURITY.md). Vulnerability reports: `hello@infernoflow.dev` or [GitHub Security Advisory](https://github.com/ronmiz/infernoflow/security/advisories/new).

---

## Community

- 💬 [**GitHub Discussions**](https://github.com/ronmiz/infernoflow/discussions) — Q&A, ideas, show and tell. First stop for questions.
- 🐛 [**Issues**](https://github.com/ronmiz/infernoflow/issues) — bugs only. Feature requests go in Discussions → Ideas.
- 🔒 [**Security Advisories**](https://github.com/ronmiz/infernoflow/security/advisories/new) — private disclosure for vulnerabilities.

---

## License

MIT — see [`LICENSE`](./LICENSE).

## Links

- [GitHub](https://github.com/ronmiz/infernoflow) · [Discussions](https://github.com/ronmiz/infernoflow/discussions) · [npm](https://www.npmjs.com/package/infernoflow) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow) · [infernoflow.dev](https://www.infernoflow.dev)
- [AMP protocol spec](docs/protocol/PROTOCOL.md) — vendor-neutral memory format
- [Dogfood: what infernoflow caught 