# dev.to / Medium long-form post

**Publish 24 hours after HN**, so you can link to the HN discussion for social proof.
**Cross-post to Medium 48 hours later** with a canonical link back to dev.to.

## Title

```
Your AI Coding Assistant Has Amnesia — Here's How I Fixed It (Local, Git-Tracked, Copilot-Compatible)
```

## Subtitle

```
An open protocol (AMP) and a small extension turn Cursor, Claude Code, and Copilot Chat into agents that remember what they learned yesterday.
```

## Body

Six months ago I was pair-programming with Claude on a multi-tenant kanban. We hit a Prisma migration issue — turns out on Windows, Prisma 6 holds an exclusive lock on `query_engine.dll` while `tsx watch` is running. Kill the watcher, migration works. Non-obvious. It took us 40 minutes to figure out.

Two weeks later, new Claude session, different file, same repo. I asked for a schema change. Claude ran `prisma migrate dev`, got EBUSY. "Hmm, let me try a different approach — maybe restart the terminal..." **We were about to relearn the same lesson.**

That's the moment I started building infernoflow.

## The problem isn't "AI memory," it's "session amnesia"

There's a category confusion in the AI-tools space right now. When people say "AI memory," they usually mean one of these:

1. **Conversation history** — the context window inside a single chat. Works fine but resets when you close the tab.
2. **User memory** (ChatGPT's "Memory" feature) — remembers your name, preferences, style. Proprietary, cross-app, not code-aware.
3. **RAG over a codebase** — vector index of your files. Useful for search, useless for gotchas that never made it into the code.
4. **Static rules files** — `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`. Great, but one-way: you write, the AI reads.

None of them capture *what the AI figured out during the last session*. The lesson lives in the disappearing chat, not in the code.

That's the gap. That's session amnesia.

## What "captured" would actually mean

For the fix to work, three things have to be true:

1. **The AI has to log its own discoveries** mid-session, without me interrupting to type "please remember X." If I have to be in the loop, I'll forget.
2. **The memory has to be local and git-tracked** so it travels with the branch. If my teammate checks out my branch, they inherit my session's context.
3. **It has to work with the AI I'm already using at work** — which is Copilot Chat for the majority of developers, even the ones who wish it were something else.

Point 3 is where most tools add friction. Copilot Chat supports MCP (GA since VS Code 1.102, July 2025), but an MCP server still needs per-project wiring — so memory tools that ship *only* as MCP servers leave Copilot users with extra setup.

## The workaround: VS Code Language Model Tools

VS Code has a supported API for extending Copilot's capabilities: `vscode.lm.registerTool`. It's the same API GitHub uses for its own workspace tools. You register a tool with a schema, and Copilot Chat can invoke it during a conversation.

I registered `amp_write` (log a discovery) and `amp_read` (recall past discoveries) as Language Model Tools. Copilot picks them up automatically.

Now I get interactions like this — literally happened last Tuesday:

> Me: "Add a migration to normalize the tags column."
>
> Copilot: *[silently calls `amp_read({ path: 'prisma/schema.prisma' })`]*
>
> Copilot: "I noticed a logged note about Prisma 6 holding a DLL lock during `tsx watch`. Want me to stop the watcher before running migrate?"

That's the whole product. The AI checks its own memory before acting. When it discovers something new, it calls `amp_write` on its own. The memory grows.

## The rest of the architecture

For the MCP clients (Cursor, Claude Code, and anything MCP-compatible), the same tools are exposed via an MCP server. Two transports, one memory file:

```
.ai-memory/
├── sessions.jsonl              # lean index — one line per entry
├── details/<id>.md             # tier-2 detail (transcripts, long notes)
└── branches/<branch>.jsonl     # branch-scoped memory
```

Everything is plain JSONL. You can `cat` it. You can grep it. You can commit it.

For Cursor specifically, there's a third path: a `beforeSubmitPrompt` hook. It runs before the prompt goes to the AI. It regex-matches phrases like "bookmark this" or "mark this point" and calls `infernoflow bookmark` deterministically. That's the backstop against AI non-compliance — if the model ignores your phrasing, the hook still catches it.

## Session bookmarks: the resume-point feature

The v0.44.10 addition I'm most proud of. Say you're mid-refactor, hitting a stopping point, want a safety net before the risky change:

```
you: bookmark this before the auth rewrite
```

Three things happen (whichever path fires first, all land in the same place):

1. **Cursor** — hook catches "bookmark this", spawns `infernoflow bookmark "before the auth rewrite"`.
2. **Claude Code / MCP** — AI calls `amp_bookmark({ label: 'before the auth rewrite' })`.
3. **You** — you type `infernoflow bookmark "before the auth rewrite"` in a terminal.

The CLI then:

- Encodes the current cwd the same way Claude Code does (`.replace(/[^a-zA-Z0-9]/g, '-')`)
- Finds the newest `.jsonl` in `~/.claude/projects/<encoded-cwd>/` — Claude Code's session log
- Parses the last 40 user/assistant turns
- Renders them as markdown at `.ai-memory/details/<id>.md`
- Adds a lean line to the session index

Zero AI calls. Deterministic. The transcript never leaves the machine.

Next session, `infernoflow switch` surfaces the bookmark under a `## 🔖 Bookmarks — Resume Points` section in the AI's rules file. The AI reads it and resumes with the full context — including the *why* of decisions, not just the code.

## AMP — the protocol

The memory format is documented as an MIT-licensed spec called AMP (AI Memory Protocol). Vendor-neutral. Versioned. Anyone can implement it.

I care about this because I think memory shouldn't be locked to any one vendor's cloud. If the next hot AI-coding tool ships tomorrow and it can read AMP JSONL, my memory transfers instantly. If everyone builds their own proprietary format, users get fragmented and every switch is a total reset.

## What I didn't build

- No cloud sync (removed in v0.43.6 after I decided the SaaS angle diluted the local-first pitch)
- No telemetry (never had it)
- No `postinstall` script (`npm i -g` copies files only; you run `init` explicitly)

Secret patterns (`sk-*`, `ghp_*`, `-----BEGIN`) are rejected at write time. It's not a comprehensive DLP system, but it prevents the most common accidents.

## Try it

```bash
npm install -g infernoflow
cd your-project
infernoflow init --yes
```

Then install the "infernoflow" extension in VS Code (Marketplace search).

Open Copilot Chat, Cursor, or Claude Code, and start coding. The next session that hits a gotcha, watch what your AI logs. Then check `.ai-memory/sessions.jsonl` and see the entry it wrote itself.

Site: [infernoflow.dev](https://www.infernoflow.dev)
Repo: [github.com/ronmiz/infernoflow](https://github.com/ronmiz/infernoflow)

## Feedback

Especially interested in:

- Multi-repo workflows — does the branch-scoped memory make sense across microservices?
- Windsurf integration — currently rule-files only, want to add LMT/MCP once their API stabilizes.
- AMP protocol edge cases — schema decisions I'd like to lock down before more implementations ship.

Reply here or open an issue on GitHub.

---

*Discussion on Hacker News: [link — insert after HN launch]*
