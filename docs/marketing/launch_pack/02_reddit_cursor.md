# Reddit — r/cursor

**Best time:** Tuesday morning, 9-11 AM ET
**Flair:** Discussion / Tools (whatever the subreddit prefers)

## Title (300 chars max, aim for ~80-100)

```
I built a "bookmark this" hook for Cursor sessions — resume points that auto-capture your session transcript
```

## Body

I got tired of restarting Cursor sessions and having to re-explain what the previous session figured out. So I built `infernoflow bookmark` — a resume-point system that hooks into Cursor's `beforeSubmitPrompt` and does the work deterministically.

**The flow:**

1. You're mid-refactor and want a safety net. Type "bookmark this before the auth rewrite" in the chat.
2. The `beforeSubmitPrompt` hook catches the phrase (regex triggers on "bookmark this" / "mark this point" / "save this checkpoint") *before* the prompt goes to the AI.
3. It spawns `infernoflow bookmark "before the auth rewrite"`.
4. If you're on Claude Code the CLI reads the session transcript already on disk (`~/.claude/projects/…/*.jsonl`), distills the last 40 turns to markdown, and stores it as the bookmark's context. Deterministic, no model call.
5. Next session, `infernoflow switch` surfaces the bookmark under a `## 🔖 Bookmarks — Resume Points` section with the most recent context inlined.

**Why the hook and not just an AI-driven MCP tool?**

Because the AI sometimes doesn't follow instructions. If I say "bookmark this" and the AI just ignores it or paraphrases, I've lost the resume point. The `beforeSubmitPrompt` hook catches the phrase *deterministically* — the prompt gets flagged before the AI even sees it. It's a backstop against AI non-compliance.

There's an `amp_bookmark` MCP tool too, so the AI can drop bookmarks on its own initiative (when context is filling up, before a risky change, etc.). Both paths write to the same JSONL file, same schema.

**Setup:**

```bash
npm install -g infernoflow
cd your-project
infernoflow init --yes
```

The `init` wires the MCP server into `.cursor/mcp.json`, drops the `beforeSubmitPrompt` hook into `.cursor/hooks/`, and generates the `.cursorrules` block that teaches the AI when to log gotchas / decisions / attempts / bookmarks.

Bookmarks never auto-expire. `list` / `show <id|label>` / `rm` for management. It's a `note` entry tagged `bookmark` in `.ai-memory/branches/<branch>.jsonl` — vendor-neutral, JSONL on disk, MIT-licensed. If you use anything AMP-compatible you can read the same file.

Site: https://www.infernoflow.dev — npm: `infernoflow` (v0.44.15) — repo: `ronmiz/infernoflow`

Interested in your feedback, especially edge cases in your Cursor setups.

---

## Reply templates

**"Does this work with agent mode?"**
> Yes — agent mode calls the MCP tools directly. `amp_bookmark`, `amp_write`, `amp_read` are wired into `.cursor/mcp.json` by `infernoflow init`. The hook is a backstop for chat mode where the AI might paraphrase.

**"Cursor already has memory features"**
> Rules files and @-mentions of past docs — yes, but those are one-way (you write, AI reads) and static. The infernoflow difference is auto-capture: the AI logs gotchas mid-session via `amp_write`, they're git-tracked and travel with the branch. Teammate checks out your branch → they inherit your context.

**"Where's the transcript stored?"**
> `.ai-memory/details/<id>.md` — Tier-2 sidecar. Loaded on demand via `readDetail()`. Doesn't bloat the main memory index that's injected on every AI turn. So you don't pay tokens for it unless you explicitly recall it.

**"Windows support?"**
> Yes — Node 18+ on Windows works, but force UTF-8 in PowerShell first: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`. Otherwise the emoji output shows as garbage. Docs mention this in troubleshooting.
