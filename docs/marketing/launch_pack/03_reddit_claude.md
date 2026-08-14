# Reddit — r/ClaudeAI

**Best time:** Wednesday 10 AM - 12 PM ET (r/ClaudeAI's active window)
**Flair:** Coding / Tools / Showcase

## Title

```
I made Claude Code auto-harvest its own session transcripts as searchable memory (no API calls)
```

## Body

Claude Code already writes every session to disk — `~/.claude/projects/<encoded-cwd>/*.jsonl`. Every user turn, every assistant response, every tool call. The data is *right there*, just useless because you'd have to open the file manually to read it.

I wrote a CLI (`infernoflow`) that turns those transcripts into resume-point memory.

**How it works:**

Type `bookmark this` mid-session. A `beforeSubmitPrompt`-equivalent hook (in Cursor) or the `amp_bookmark` MCP tool catches it and calls `infernoflow bookmark "<label>"`. The CLI:

1. Encodes the current cwd the same way Claude Code does (`.replace(/[^a-zA-Z0-9]/g, '-')`)
2. Finds the newest `.jsonl` in that project folder
3. Parses out the last 40 user/assistant turns
4. Renders them as markdown, stores at `.ai-memory/details/<id>.md`
5. Adds a lean index entry to `.ai-memory/sessions.jsonl`

Zero AI calls. Deterministic. The transcript never leaves your machine.

Next Claude Code session, the memory index gets injected into your `CLAUDE.md` under a `## 🔖 Bookmarks — Resume Points` block (marker-wrapped, so your manual edits outside the block survive). Claude reads it as normal instructions and picks up where you left off — including the *why* of decisions, not just the code that resulted.

**Also has an MCP server** with 6 tools that Claude calls on its own:

- `amp_write` — log a gotcha / decision / attempt when Claude discovers something non-obvious
- `amp_bookmark` — Claude drops a bookmark before a risky change or when context is filling
- `amp_read` — pull recent memory before proposing changes to a file
- `amp_status` — check memory health
- `amp_recall` — semantic search
- `amp_bookmarks` — list existing resume points

The `CLAUDE.md` in every project init'd with infernoflow teaches Claude *when* to call each tool. My kanban project's `CLAUDE.md` has ~90 lines of triggers ("if user types `!!` or `not working` → `amp_write` with type='attempt'").

**Kept it local-first and open:**

- No telemetry, no cloud sync, no postinstall (`npm i -g` copies files; you explicitly run `init`)
- AMP protocol is MIT-licensed and vendor-neutral (Cursor, Windsurf, Copilot Chat all read the same JSONL)
- Secret-pattern rejection at write time (`sk-*`, `ghp_*`, `-----BEGIN`)
- Git-tracked, branch-aware — memory travels with the branch

Site: https://www.infernoflow.dev
npm: `infernoflow` (v0.44.15)
Repo: `ronmiz/infernoflow`

Quickstart:
```bash
npm i -g infernoflow
cd your-project
infernoflow init --yes
# then in Claude Code:
# type "bookmark this before I try the tricky refactor"
# infernoflow harvests the session, saves the resume point
```

Would love feedback from anyone using Claude Code in anger. Especially interested in edge cases with multi-repo workflows and how you currently structure your `CLAUDE.md`.

---

## Reply templates

**"Isn't this just what CLAUDE.md is for?"**
> CLAUDE.md is a static rules file — you write, Claude reads. infernoflow writes *to* CLAUDE.md automatically, in a marker-wrapped block, based on what Claude discovers mid-session. Your manual rules outside the block are preserved. Think of it as the compilation output vs. source: you keep authoring the source (rules), the compilation output (recent memory) is generated.

**"How is transcript harvest different from just reading the whole JSONL?"**
> Full JSONL of a typical session is 500KB-5MB. Injecting that on every AI turn would blow your context. The bookmark's `detail` is a distilled markdown snapshot of the last 40 turns (~4-8KB) and is only loaded on demand, not on every turn. The main memory index stays lean (headline + one-line description).

**"What if I don't want a bookmark to include the transcript?"**
> `infernoflow bookmark "label" --marker` — creates the resume point without the harvest. Just the label. Useful if the surrounding context is sensitive or noisy.

**"Any way to see the actual transcript being captured?"**
> `infernoflow show <id|label>` — prints the bookmark's tier-2 detail file inline. Or open `.ai-memory/details/<id>.md` directly.

**"MCP setup for Claude Code?"**
> `infernoflow init` writes `.mcp.json` in the project root with the stdio server config. Claude Code auto-discovers it. If you'd rather register globally, edit `~/.claude/mcp.json` — same schema.
