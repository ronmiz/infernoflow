# Show HN Post — infernoflow

## Recommended timing
**Monday 8:00 AM Pacific Time (16:00 UTC)** — HN's peak organic-traffic window.
Have 3-5 friends/colleagues primed to upvote in the first 10 minutes (natural, not fake — just people who actually know about it).

## The submission

**Title (80 chars max):**
```
Show HN: Persistent memory for AI coding sessions, with resume-point bookmarks
```

**Positioning note (revised 2026-07-12 after MCP-support correction):** every claim here traces to a README line. No "the only" claim. Copilot Chat has supported MCP since VS Code 1.102 (GA July 2025) — infernoflow's angle is dual-transport (LMT + MCP) and the Claude-Code-transcript-harvest technique, not "only-tool-for-Copilot."

**Alternative titles:**
```
Show HN: Infernoflow — session bookmarks that harvest Claude Code transcripts
Show HN: I mine Claude Code's on-disk JSONL for AI-session resume points
```

**URL:**
```
https://www.infernoflow.dev
```

**Text (leave blank if using URL, or use this if allowed):**
```
Every new AI session starts cold — the gotchas you found, the decisions you made, don't survive. The agent re-reads your code, re-derives the obvious, and re-makes the same wrong move someone else made yesterday.

I built infernoflow to fix that.

It's a CLI + VS Code extension + open protocol (AMP) that captures gotchas / decisions / attempts / patterns during your session and replays them into the next one. Local JSONL on disk, git-tracked, no SaaS.

The v0.44 headline is session bookmarks — named resume points you drop mid-session. When you drop a bookmark on Claude Code without an explicit note, the CLI reads Claude Code's own on-disk transcript at ~/.claude/projects/<encoded-cwd>/*.jsonl, distills the last 40 user/assistant turns to markdown, and stores that as the bookmark's context. Deterministic. Zero AI calls.

Three ways to drop a bookmark, all writing to the same file, same schema:

1. CLI: `infernoflow bookmark "before the auth rewrite"`
2. MCP tool: the AI calls `amp_bookmark` on its own initiative
3. Chat phrase: a `beforeSubmitPrompt` hook in Cursor catches "bookmark this" / "mark this point" / "save this checkpoint" and drops the bookmark deterministically — backstop against the AI ignoring the phrase

Works with Cursor, Claude Code, GitHub Copilot Chat, and Windsurf. Two transports side by side: MCP for cross-client interop (Copilot Chat has supported MCP servers since VS Code 1.102, July 2025 GA), and VS Code Language Model Tools for Copilot Chat as an always-on path — registered by the extension itself, works even if no per-project MCP config is present.

The VS Code extension also renders logged gotchas as yellow squigglies in the editor and rows in the Problems panel. If a gotcha was logged with a file:line, you see the warning while typing, before the AI does.

Local-first: no telemetry, no postinstall script, no network calls in default command paths, secret patterns (`sk-`, `ghp_`, `-----BEGIN`) rejected on capture. MIT-licensed. Memory travels with your git branch — teammate checks out your feature branch, they inherit what you captured, no message needed.

44 versions of dogfood since Feb — I built a multi-tenant kanban with it (infernotest_01) and the README has real gotcha entries from that build (Vite proxy Host-header rewrite, Prisma 6 DLL locking during tsx watch, Prisma nested-select auth patterns).

Feedback welcome — especially on the AMP spec (docs/protocol/PROTOCOL.md) and on cross-tool edge cases.
```

## Pre-loaded comments (paste as soon as it goes up)

**Comment 1 — technical explanation, first 5 min:**
> Author here — happy to answer questions. Quick heads-up on how the harvest works since it's the most novel piece:
>
> Claude Code writes every session to disk as JSONL at ~/.claude/projects/<encoded-cwd>/*.jsonl (where <encoded-cwd> is the abs path with every non-alphanumeric replaced by "-"). When you drop a bookmark without a --note, infernoflow finds the newest transcript for the current project, parses the recent user/assistant turns, and stores them as a markdown snapshot in .ai-memory/details/<id>.md. Deterministic — the model isn't involved.
>
> For Cursor / Windsurf we fall back to marker-only bookmarks (label without context). Working on cross-transport harvest for other IDEs.

**Comment 2 — pre-answer the "isn't this just CLAUDE.md?" objection:**
> One expected question: "How is this different from writing rules into CLAUDE.md?"
>
> Static rules are one-way: you write, the AI reads. They don't grow with the project. Every gotcha you hit, every decision with a "because," every dead end you tried, has to be manually distilled and typed.
>
> infernoflow's difference: the AI captures them by itself, mid-session, via MCP or LMT. They persist in git-tracked, branch-aware JSONL. When your teammate checks out your branch, they inherit your memory automatically. Zero manual distillation.
>
> The static rule files (CLAUDE.md / .cursorrules / copilot-instructions.md) are output surfaces — infernoflow writes to them automatically, in a marker-wrapped block. Your manual edits outside the block are never touched.

## Response templates for likely questions

**Q: "Does this send my code somewhere?"**
> No. Zero network calls in any default command path. No telemetry, no analytics, no cloud sync (that was removed in v0.43.6). SECURITY.md has the full policy. The optional `infernoflow ai setup` command wires an AI provider (Anthropic/OpenAI/Google/Ollama) for a couple of enrichment commands — same trust model as using that provider directly. Off by default.

**Q: "Why is there a postinstall script?"**
> There isn't. `npm install -g infernoflow` runs no code — it just copies files. You explicitly run `infernoflow init` when you're ready to wire up an existing project.

**Q: "Why not just use ChatGPT's memory?"**
> ChatGPT's memory is (1) proprietary and locked to OpenAI, (2) not code-specific, (3) not cross-teammate. It won't help me when I'm using Cursor for one project and Copilot for another. AMP is the format the entire ecosystem can converge on.

**Q: "Windsurf?"**
> Cursor + Claude Code + Copilot Chat + generic MCP right now. Windsurf works through the rule files (.windsurfrules) — full MCP integration is planned once their extension API is stable.

**Q: "How does the beforeSubmitPrompt hook work?"**
> Regex triggers on the outgoing prompt: `/\bbookmark (?:this|it|here)(?: point)?\b/i`, `/\bmark this (?:point|spot|moment|here)\b/i`, `/\bsave (?:this )?(?:point|checkpoint|resume point)\b/i`. If any match, the hook spawns `infernoflow bookmark "<derived label>"` and the CLI does the transcript harvest. Deduplicated via a hash of the first 200 chars of the prompt so the same phrase doesn't fire twice.

**Q: "Isn't 'auto-captures the session transcript' just training on user data by another name?"**
> No — the transcript lives entirely on disk and is only ever read by infernoflow to render the bookmark's `detail` sidecar. It's not sent anywhere. And it's opt-in per bookmark: `--marker` skips the harvest entirely.

## After posting

- Reply to every comment in the first 2 hours
- Don't argue with the first drive-by "this is just X" — thank them and clarify
- Track the URL — if it hits front page, Vercel needs to be ready for traffic (Cloudflare Pages CDN is fine, but check analytics)
- **Don't cross-post to Reddit until at least 6 hours after HN**, unless HN clearly didn't take off. Different audiences.
