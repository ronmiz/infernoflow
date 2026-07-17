# Twitter/X Thread — 6 tweets (simple + clear)

**When:** ~30 min after HN goes live.
**Rule:** every claim traces to a README line.

---

## Tweet 1 — Hook

Every new AI session starts cold.

The gotchas you found. The decisions you made. The dead ends you tried.

All gone.

I shipped a fix. 🧵

**📎 Image:** `HERO_og_image.png` (v1 dark hero).
**Cite:** README line 3.

---

## Tweet 2 — What it is

infernoflow — persistent memory for AI coding sessions.

Works with Cursor, Claude Code, Copilot Chat, Windsurf.
Local JSONL. Git-tracked. MIT.

npm i -g infernoflow
🔗 https://infernoflow.dev

**📎 Image:** none.
**Cite:** README lines 15, 168-172, 282.

---

## Tweet 3 — The killer feature

Session bookmarks with a twist:

Drop one on Claude Code with no note. The CLI reads Claude Code's on-disk transcript at

  ~/.claude/projects/<encoded-cwd>/*.jsonl

distills the last 40 turns to markdown, stores it as the bookmark's context.

Zero AI calls. Deterministic.

**📎 Image:** screenshot of `infernoflow show <bookmark>` — the harvested transcript rendered clean. **Highest priority visual.**
**Cite:** README line 29.

---

## Tweet 4 — Real example (dogfood)

Last week the assistant was about to run `prisma migrate dev`.

First, it called `amp_read` on the schema.

Pulled up a 3-week-old gotcha about Prisma 6 locking `query_engine.dll` during tsx watch.

Then asked me first.

**📎 Image:** screenshot of the actual chat interaction (Copilot Chat or Claude Code, whichever records cleanest).
**Cite:** README lines 205-206, 221.

---

## Tweet 5 — Setup

Setup, 60 seconds:

```
npm i -g infernoflow
cd your-project
infernoflow init --yes
```

Wires memory into Cursor, Claude Code, Copilot Chat, Windsurf.

Marker-wrapped so your existing rules survive.

**📎 Image:** none (or a small GIF of the install running).
**Cite:** README lines 55-62.

---

## Tweet 6 — Close + HN redirect

If your AI keeps making the same mistake — try it.

npm: infernoflow
site: https://infernoflow.dev
repo: github.com/ronmiz/infernoflow (MIT)

Also on HN → [link — insert after HN goes live]

/end

**📎 Image:** none.

---

## Visuals to record (3 total, all critical)

| # | Visual | For | How to make |
|---|--------|-----|-------------|
| 1 | `HERO_og_image.png` | Tweet 1 | Open `assets/HERO_og_image.svg` in Chrome → screenshot the tab, save as PNG 1200×630 |
| 2 | `bookmark_harvest_output.png` | Tweet 3 | Run `infernoflow bookmark "test"` in a Claude Code session, then `infernoflow show <id>`, screenshot the output |
| 3 | `chat_amp_read_prisma.png` | Tweet 4 | Screenshot the real chat interaction. If can't reproduce the Prisma case, use any recent example where the AI called `amp_read` |

**Time to record:** ~30 minutes total.

---

## Deprecated (do not use)

Old v1 draft had 14 tweets including these false claims — all removed:

- "GitHub Copilot Chat has no persistent memory tool."
- "Copilot Chat doesn't support MCP."
- "Every AI-memory tool skips Copilot."

Per `feedback_no_fabrication` memory: Copilot Chat supports MCP GA since VS Code 1.102 (July 2025).
