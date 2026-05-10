# PR submission template — awesome-mcp-servers

Target: https://github.com/punkpeye/awesome-mcp-servers

## PR title

`Add infernoflow — Persistent memory for AI coding sessions (AMP protocol)`

## Where to add it

The README has sections like "Developer Tools", "Knowledge & Memory", and "AI Coding". infernoflow fits **Knowledge & Memory** best because the wedge is "memory across sessions", and **AI Coding** as a secondary category since it's specifically for coding agents.

Best path: search the existing list for any "memory" or "context" entries, slot infernoflow alphabetically among them. If no memory section, propose adding one in the PR description.

## The line to add (markdown)

```markdown
- [infernoflow](https://github.com/ronmiz/infernoflow) — Persistent memory for AI coding sessions. 14 MCP tools (5 AMP-spec aliases + 9 vendor-specific) for read/write/handoff/search/health. Captures gotchas, decisions, failed attempts; auto-injects them into `.cursorrules` / `CLAUDE.md` / `copilot-instructions.md`. Reference implementation of [AMP — the AI Memory Protocol](https://github.com/ronmiz/infernoflow/blob/main/docs/protocol/PROTOCOL.md), an open spec for vendor-neutral session memory. CLI + VS Code extension. Zero deps. (Node, TypeScript)
```

## PR description (paste into the GitHub PR form)

```markdown
Adding **infernoflow** — an MCP server that gives AI coding agents persistent memory across sessions.

**What it does**
- Captures the things AI tools can't infer from code: gotchas (API quirks), decisions (architectural choices), failed attempts (don't try this again).
- Stores them in `.ai-memory/sessions.jsonl` (open AMP format).
- Exposes 14 MCP tools so Cursor / Claude Code / Copilot / Windsurf / any AMP-compliant client can read & write memory.
- Auto-injects file-relevance-ranked memory into `.cursorrules` / `CLAUDE.md` / `.github/copilot-instructions.md` so every new chat in any tool starts with the right context.

**MCP tools exposed (full list)**
- 9 vendor: `infernoflow_run`, `infernoflow_apply`, `infernoflow_check`, `infernoflow_status`, `infernoflow_context`, `infernoflow_implement`, `infernoflow_review`, `infernoflow_git_drift`, `infernoflow_scan_ui`
- 5 AMP-spec aliases (vendor-neutral): `amp_read`, `amp_write`, `amp_search`, `amp_handoff`, `amp_health`

**Why I think this fits**
Most MCP servers do single tasks (search Slack, query DB). infernoflow is **about MCP itself** — making AI agents smarter across sessions by giving them durable memory. Open protocol, zero deps, MIT licensed, public source.

**Usage**
```bash
npm install -g infernoflow
infernoflow init
infernoflow setup    # configures the MCP server in Cursor / Claude Code config
```

Repo: https://github.com/ronmiz/infernoflow
npm: https://www.npmjs.com/package/infernoflow
AMP spec: https://github.com/ronmiz/infernoflow/blob/main/docs/protocol/PROTOCOL.md
```

## Submission checklist

- [ ] Verify the markdown line is alphabetized correctly within its section
- [ ] Run any linting the awesome list uses (some have `markdown-link-check` or `awesome-lint`)
- [ ] Make sure the GitHub repo is public and the README renders cleanly
- [ ] Make sure the npm package is live (`npm view infernoflow version` returns something)
- [ ] PR title format matches the project's convention (check 5 recent merged PRs for the pattern)

## Backup plan if rejected

If punkpeye's awesome-mcp-servers rejects (their bar may be high), submit to:
- https://github.com/wong2/awesome-mcp-servers (alternate list)
- https://github.com/appcypher/awesome-mcp-servers
- https://mcpservers.org (community directory)
- https://glama.ai/mcp/servers (paid/free hybrid)
