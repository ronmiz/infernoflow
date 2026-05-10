# Why your AI coding assistant has amnesia (and the open protocol I'm building to fix it)

You spent 90 minutes yesterday teaching Claude that your auth API returns `200` even on errors — check the response body, not the status code. Today you ask Claude the same kind of question and watch it write `if (response.ok) { return data }`.

The AI didn't get worse overnight. It just doesn't have memory.

Every Cursor / Claude Code / Copilot Chat conversation starts from zero. The agent re-reads your code, re-derives the patterns, re-makes the same wrong move someone else made yesterday. There's nothing for it to read between sessions.

I've been building a fix called **infernoflow** — a small CLI plus a VS Code extension that captures the things AI tools can't infer from code, and replays them into the next session. But the more important piece is what's underneath: **AMP, the AI Memory Protocol**. An open spec, MIT licensed, vendor-neutral. Any tool can read your memory file. The lock-in problem disappears the moment more than one tool implements it.

This post is about why this matters, what's actually working today, and what's deliberately unfinished.

## The shape of the problem

Three things AI coding assistants don't have access to that experienced engineers do:

**1. Things you tried that didn't work.** You spent two hours yesterday trying `react-query` to replace a custom hook, then reverted. The agent has zero idea. Tomorrow it'll suggest `react-query`.

**2. Decisions you made and the reasons.** "Use axios for all HTTP, not fetch — for consistency" is a decision that lives in your head. The codebase doesn't say "I picked axios over fetch because." Today's chat has no idea this constraint exists.

**3. Project-specific gotchas.** "Auth header must be lowercased on Express endpoints" or "the `find()` on this model returns null, not undefined." These aren't bugs to fix — they're the shape of the system. They cost you an hour to learn and they'll cost the AI an hour every session.

Code can't express these. Test files don't tell stories. Even a thorough README doesn't capture the lived friction.

## Why a protocol, not just a tool

I started by writing a CLI that wrote to `inferno/sessions.jsonl`. It worked. But it created a worse problem: lock-in.

If only my tool could read my memory, I just built the AI version of Notion — capture everything in our format, hostage forever. The AI tools you actually use — Cursor, Claude Code, Copilot, Windsurf — couldn't read my data without integrating with my CLI specifically. That's not memory, that's a database with extra steps.

So I extracted the storage format into a spec: **AMP (AI Memory Protocol)**. Append-only JSONL. ULID IDs. A handful of entry types: `gotcha`, `decision`, `attempt`, `note`. ~30 lines of spec. Anyone can implement it.

Today the canonical layout is:

```
.ai-memory/
├── sessions.jsonl      # one entry per line
├── amp.json            # project metadata
└── handoff.md          # generated handoff for AI agents
```

Each entry on disk is plain JSON, two hundred bytes:

```json
{"id":"01HP3K...","type":"gotcha","msg":"API returns 200 on errors","ts":1746555612345,"file":"src/api.js","line":25}
```

If `cat .ai-memory/sessions.jsonl | jq` works, you can read your memory with any tool. There's a reference TS library (`infernoflow-amp` on npm) for projects that want a typed wrapper, but the format is the contract.

## What's actually working today

I'm not going to oversell this. infernoflow is alpha. There are 0 stars on GitHub right now, you'd be among the first 20 installs. Here's the honest map of what's solid and what isn't.

### Solid (use these)

**Manual capture.** `infernoflow log "API returns 200 on errors" --type gotcha` writes a permanent entry. Your editor stays open, the entry is searchable forever.

**Automatic context injection.** When you run `infernoflow log`, the CLI quietly maintains sections in `.cursorrules`, `CLAUDE.md`, and `.github/copilot-instructions.md` between delimiter comments. AI tools read these files at session start. Your latest gotcha is in the AI's prompt without you copying anything.

**Auto-capture popup (VS Code extension).** When you edit the same file 5+ times in 10 minutes — a real signal of being stuck — a popup asks "Stuck on something?" with [Log Gotcha] [Log Attempt] buttons. Click one. The entry is auto-written with the file/line, the function name, the surrounding code, and any TypeScript errors near your cursor. Zero typing.

**File-ranked injection.** When you log a gotcha for `src/api.js`, that entry gets weight `+100` for relevance to that file. When you switch to `src/components/TaskRow.jsx`, the rule files quietly re-rank — TaskRow gotchas float to the top. AI tools opening a new chat see the right context first instead of getting buried.

**MCP integration.** 14 MCP tools exposed (`amp_read`, `amp_write`, `amp_search`, `amp_handoff`, `amp_health`, plus 9 vendor-specific). Cursor / Claude Code / Copilot agents can call infernoflow directly inside chat. `infernoflow setup` configures it once.

**Generate handoff.** `infernoflow switch --copy` builds a markdown summary of all your gotchas and copies it to clipboard. Paste into a fresh chat in any tool. The new session knows your project's landmines instantly.

### Honestly weak (don't rely on these yet)

**Cloud sync.** Off by default. If you opt in via `infernoflow login`, the CLI mirrors entries to a Supabase project using anonymous-key writes. This is not a real security boundary — anyone with the public anon key could write rows. **If your project is sensitive, run local-only.** A proper authenticated mode is on the roadmap; the schema is forward-compatible.

**Daily release cadence.** I've shipped 80+ versions in 10 weeks because I'm dogfooding heavily. Going forward, daily builds go to `npm install infernoflow@next`; stable promotes to `latest` on a slower cycle. Pinning a version in `package.json` is safe.

**Agent conversation harvesting.** If you've installed Cursor/Copilot hooks (`infernoflow install-cursor-hooks`), every agent exchange writes to a draft file. Auto-capture pulls failure-keyword AND resolution-keyword lines into your gotchas. Works great when you're going back and forth on a hard bug. Without hooks, this layer just adds nothing.

## Why "yet another VS Code extension" misses the point

If this were just a VS Code extension that wrote notes to a file, the value would max out at "a structured Notion." That's not the bet.

The bet is: **memory becomes interoperable infrastructure**. The same `.ai-memory/sessions.jsonl` file is read by Cursor's MCP integration, Claude Code's session prompt, Copilot's chat-instructions, and any future agent that adopts AMP. You write a gotcha once; every AI you use henceforth benefits.

That's only true if AMP is implemented by more than one tool. Today: just infernoflow. The protocol is worthless until it's not just mine.

If you're building an AI coding tool — please read the spec at `docs/protocol/PROTOCOL.md`. The reference TypeScript library (`infernoflow-amp` on npm) is 800 lines. Implementing read + write + handoff is half a day's work. If two more tools support it, the protocol becomes real and the network effect for users compounds.

## Try it (90 seconds)

```bash
npm install -g infernoflow
cd your-project
infernoflow init                     # 30-second setup
infernoflow log "API returns 200 on errors" --type gotcha
infernoflow log "use axios, not fetch — for consistency" --type decision
infernoflow switch --copy            # markdown handoff to clipboard
# Paste into your next Claude/Cursor/Copilot chat. The AI now knows.
```

Or install the VS Code extension: https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow

## What I want from you

If you try it and it doesn't work — open a GitHub issue. https://github.com/ronmiz/infernoflow/issues. I'll respond within a day.

If you find it useful — star the repo. Solo project, social proof matters more than usage stats right now.

If you build AI tools — read the AMP spec. Tell me what's bad about it. Implement it if you can. The protocol gets stronger with every other implementer.

If you're not sure it's for you — it might not be. If your AI workflow is "ask Copilot to autocomplete inside this function" you don't need memory. If your workflow is "spend an hour debugging with Claude, switch to Cursor for the next session, lose all the context" — that's the problem this exists to solve.

---

Repo: https://github.com/ronmiz/infernoflow
npm: https://www.npmjs.com/package/infernoflow
VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow
AMP spec: https://github.com/ronmiz/infernoflow/blob/main/docs/protocol/PROTOCOL.md
