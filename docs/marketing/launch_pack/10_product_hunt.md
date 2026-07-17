# Product Hunt Launch

**Best day:** Tuesday or Wednesday, 00:01 PT.
**Avoid:** Mondays (crowded with weekend backlog), Fridays (low traffic).

## Tagline (60 chars max)

```
Persistent memory for Copilot, Cursor, and Claude Code
```

Alternate: `Session memory for AI coding — local, git-tracked, LMT`

## Description (260 chars max)

```
Every new AI coding session starts cold. infernoflow keeps the gotchas, decisions, and dead ends. Bookmarks + auto-transcript capture. Works with Copilot Chat (via VS Code LMT), Cursor, and Claude Code. Local JSONL, git-tracked, no telemetry.
```

## Gallery images (upload 4-6)

1. **Hero image** (1270x760) — the site's hero shot with the "🆕 v0.44.10" badge visible
2. **Bookmark in action** — screenshot of `infernoflow bookmark "before auth rewrite"` output showing harvested transcript
3. **Copilot Chat calling `amp_read`** — screenshot of Copilot invoking the LMT tool mid-conversation
4. **In-editor squigglies** — VS Code screenshot with a yellow underline showing a logged gotcha as a hover
5. **Memory file** — `.ai-memory/sessions.jsonl` viewed in editor, showing the JSONL structure
6. **Setup gif** — 15-second animated gif of `npm i -g infernoflow && infernoflow init --yes` completing

## First comment (post immediately after go-live)

```
Hey Product Hunt 👋

I built infernoflow because every new AI coding session started cold. The gotcha I hit yesterday? Gone. The decision my teammate made in Cursor last week? Gone from my Copilot session today.

Three things that make this different from other AI-memory tools:

1. Works with **GitHub Copilot Chat**. infernoflow registers tools via VS Code's Language Model Tools API — Copilot invokes `amp_write` and `amp_read` natively, zero config (an MCP server ships too; Copilot supports MCP since VS Code 1.102).

2. **Session bookmarks with auto-transcript capture.** Say "bookmark this" in Cursor and a hook drops a resume point deterministically. On Claude Code, it also reads the session transcript already on disk and stashes it as the bookmark's context. Zero AI calls.

3. **Local-first & open protocol.** JSONL on disk. AMP is MIT-licensed. No telemetry, no postinstall, no network calls in the default command path.

Free forever. Ships as npm package (`infernoflow`) + VS Code extension. MIT-licensed.

Would love feedback — especially from people using Copilot at work with sensitive repos, or teams juggling Cursor + Claude Code in the same codebase.

Site: https://www.infernoflow.dev
Repo: github.com/ronmiz/infernoflow

Ask me anything!
```

## FAQs (add to product page)

**"Is it free?"**
Yes. MIT-licensed. Both the CLI and the VS Code extension. No paid tier planned right now.

**"Does it work offline?"**
Yes. All default command paths run locally. The only network calls are the ones you explicitly opt into via `infernoflow ai setup` for a couple of enrichment commands.

**"Any Windsurf support?"**
Rule files only for now. Full MCP integration is planned once Windsurf's extension API stabilizes.

**"What if my project already has `CLAUDE.md` or `.cursorrules`?"**
infernoflow writes to those files inside marker-wrapped blocks. Your existing rules outside the block are preserved. Init is safe to run on any project.

**"Does it work in a monorepo?"**
Yes — memory is scoped per directory. If you `infernoflow init` at the monorepo root, all packages share memory. If you init inside each package, each has its own.

## Hunter (optional but helpful)

If you know a Product Hunt hunter with good reach (100+ followers on PH), ask them to submit on your behalf. Popular in AI-tools: Chris Messina, Kevin William David.

If you're self-hunting: post yourself, and just be honest about it in the first comment ("I built this — happy to answer questions").

## Post-launch actions

**Hour 1:**
- Reply to every comment
- Tweet the PH link
- Share PH link in HN discussion (as a follow-up comment)

**Hour 6:**
- If ranked in top 10 of the day: cross-post to Reddit r/producthunt (drives more PH upvotes)
- If NOT ranked in top 10: don't panic. Sunday launches often edge out weekday ones.

**Hour 24:**
- Check final rank. Screenshot for the record.
- If top 5 of the day → apply for "Product of the Week" spotlight.

## Don't do

- Don't ask friends to leave "🔥🔥🔥" comments. PH filters them out and it damages the launch.
- Don't fake upvotes. PH detects and penalizes.
- Don't complain in comments if launch underperforms. Own it, iterate, relaunch next quarter with a bigger update.
