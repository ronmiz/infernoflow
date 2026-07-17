# infernoflow — Positioning v2 (README-derived, honest)

**Prepared:** 2026-07-12 (evening — after MCP-support correction)
**Rule (memory feedback_no_fabrication):** Every claim on this page cites a README line. No inventions.
**Supersedes:** `11_POSITIONING.md` (v1 — contained the fabricated "Copilot doesn't support MCP" moat).

---

## Step 1 — Every verifiable claim, cited

### What infernoflow is

| Claim | README source |
|---|---|
| "Persistent memory for AI coding sessions" | Line 3 (hero blockquote) |
| Captures "gotchas, decisions and dead ends" | Line 5 |
| CLI + VS Code extension + open protocol (AMP) | Line 15 |
| Local-first, JSONL on disk, no SaaS | Line 15 |
| MIT license | Line 11, 282 |

### What's new in v0.44.10 → v0.44.13 (bookmarks)

| Claim | README source |
|---|---|
| Session bookmarks — named resume points | Line 21 |
| `beforeSubmitPrompt` hook catches "bookmark this" etc. | Line 27 |
| MCP tool `amp_bookmark` — AI can drop bookmark itself | Line 27 |
| Auto-harvest Claude Code transcript when no `--note` | Lines 29 |
| Distills last 40 turns to markdown, deterministic | Line 29 |
| Bookmarks never auto-pruned; surface in `switch` | Line 36 |

### Cross-tool coverage (the corrected version)

| Tool | Reads | Writes | Source |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | MCP | Line 168 |
| Cursor | `.cursorrules` | MCP + hook | Line 169 |
| **Copilot Chat (VS Code)** | `.github/copilot-instructions.md` | **LMT (extension) + MCP (init)** — both wired | Line 170 *(post-fix)* |
| Copilot (JetBrains) | `.github/copilot-instructions.md` | rule files only | Line 171 |
| Windsurf | `.windsurfrules` | MCP planned | Line 172 |

### Dual-transport claim (the honest replacement for the "only" claim)

> "Copilot Chat has supported MCP servers since VS Code 1.102 (GA July 2025), so any MCP-based memory tool can plug in. infernoflow ships **two transports side by side** so Copilot picks up the same six `amp_*` tools whichever path is available."
> — README lines 92–100 (post-fix)

### Rule-file architecture

| Claim | README source |
|---|---|
| Writes to `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md` (marker-wrapped) | Line 47, 174 |
| Marker blocks preserve user edits outside them | Line 263 |
| Lean defaults — 4 entries, 5 commits, 200-char truncation | Line 104 |
| Configurable via `.ai-memory/amp.json` | Lines 106–121 |

### Storage architecture

| Claim | README source |
|---|---|
| `.ai-memory/branches/*.jsonl` — git-tracked, per-branch | Line 46, 143 |
| `.ai-memory/global.jsonl` — personal, gitignored | Line 46, 149 |
| `.ai-memory/details/<id>.md` — Tier-2 rich bodies, loaded on demand | Line 134, 147 |
| Cross-machine sync via any OS-synced folder | Line 154 |
| `merge=union` — no manual conflict resolution | Line 159 |

### AMP tools (verifiable in code)

| Tool | Source |
|---|---|
| `amp_write`, `amp_read`, `amp_search`, `amp_bookmark`, `amp_handoff`, `amp_health` | Lines 183–189 |
| `infernoflow_status`, `_check`, `_context`, `_git_drift` | Lines 190–193 |
| Follows AMP MCP spec §7.3 (vendor-neutral) | Line 195 |

### VS Code extension (the visual surface)

| Claim | README source |
|---|---|
| Live sidebar — ranked-by-relevance memory for current file | Line 220 |
| **Yellow squigglies in editor + Problems panel** for gotchas with `file:line` | Line 221 |
| Status-bar health score | Line 222 |
| Keyboard shortcuts for logging | Line 224 |

### Security (verifiable in code)

| Claim | README source |
|---|---|
| No telemetry | Line 258 |
| No postinstall script | Line 259 |
| No network calls in default command path | Line 260 |
| No auto-updates, no background processes, no cloud sync | Line 261 |
| Secret patterns (`sk-`, `ghp_`, `-----BEGIN`) rejected on capture | Line 264 |

### Dogfood (verifiable in `.ai-memory/` of this repo)

| Claim | README source |
|---|---|
| Developed by building `infernotest_01` (kanban) | Line 203 |
| 6 real gotcha/pattern/decision examples in-README | Lines 205–210 |

---

## Step 2 — What's genuinely differentiating (from cited claims only)

Cross-referencing the cited claims against the 2026-07-10 competitive audit (Mem0, Zep, Letta, Cline Memory Bank, Roo Code, memory-bank-skill, MemNexus, Hindsight, Basic Memory, cursor-memory-bank, Cursor Memories):

| Feature | Unique to infernoflow? | Verified how |
|---|---|---|
| Bookmark auto-harvest from Claude Code JSONL transcript | ✅ **Yes** — no competitor reads `~/.claude/projects/*.jsonl` | Web search + README line 29 |
| Yellow squigglies in editor from logged gotchas with `file:line` | ✅ **Yes** — no competitor VS Code extension does this | Web search + README line 221 |
| Dual-transport (LMT + MCP) in one product | 🟡 **Rare packaging** — most tools pick one | Web search — MemNexus / Hindsight both MCP-only |
| AMP as a documented open spec (not just implementation) | 🟡 **Rare** — most tools have implicit format | Web search — memory-bank-skill has a format but no spec doc |
| Cross-machine sync via OS-synced folder | ✅ **Distinctive design** | Web search |
| Multi-tool coverage (Cursor + Claude + Copilot + Windsurf) | ❌ **Table stakes** — memory-bank-skill covers 8 tools | Competitive audit |
| Local-first, no telemetry, no postinstall | ❌ **Table stakes** in 2026 | Competitive audit |
| Auto-capture by AI via MCP tools | ❌ **Table stakes** | Competitive audit |
| Git-tracked, branch-aware | ❌ **Table stakes** for markdown-based tools | Competitive audit |

**Genuine differentiators (verified):**
1. **Bookmark auto-harvest from Claude Code transcripts** (unique — literally reads Anthropic's on-disk JSONL)
2. **In-editor gotcha squigglies** (unique — VS Code extension turns memory into Problems panel entries)

**Rare/distinctive** (weaker moats):
3. Dual LMT+MCP transport packaged together
4. AMP as documented open spec
5. Cross-machine sync design

---

## Step 3 — Proposed positioning (derived from Steps 1 & 2)

### The one-line headline

> **Persistent memory for AI coding sessions. Bookmarks that resume where you left off. Gotchas that show up as squigglies in your editor.**

Everything in that sentence is cited to a README line.

### The 6-word test

> **Persistent AI memory with editor squigglies.**

(Not "the only" anything. Not any comparison. Just what it is.)

### Sub-hero (for site / dev.to)

> Works with Cursor, Claude Code, GitHub Copilot Chat, and Windsurf — through MCP and VS Code Language Model Tools. Local JSONL, git-tracked, MIT. Open protocol (AMP). No telemetry, no cloud, no SaaS.

Every clause cited above.

### What each channel leads with

| Channel | Angle | Why |
|---|---|---|
| **HN** | Bookmark + Claude Code transcript harvest | Novel, technical, sparks curiosity. HN loves "I read Anthropic's on-disk JSONL to do X." |
| **r/GithubCopilot** | LMT-registered tools (no MCP config needed) | Genuine value for Copilot users who haven't wired MCP |
| **r/cursor** | `beforeSubmitPrompt` hook + bookmark | Cursor-specific angle |
| **r/ClaudeAI** | Transcript harvest from `.claude/projects/*.jsonl` | Claude Code-specific angle |
| **Twitter** | In-editor squigglies (visual, GIF-friendly) | Visual medium wants visual claim |
| **dev.to** | AMP protocol + architecture depth | Long-form audience wants depth |

### The 4 posts that need rewriting

Based on Step 2, these v1 assets contain the fabricated claim and must be rewritten:

1. `01_show_hn.md` — title + body (currently: "since it lacks MCP")
2. `05_twitter_thread.md` tweet 1 (currently: "because every AI memory tool ships as MCP")
3. `04_reddit_copilot.md` — leads with the false LMT-only claim
4. `assets/DIAGRAM_1_lmt_vs_mcp.svg` — visual reinforces the false claim
5. `assets/HERO_og_image.svg` / `_v3_code.svg` — headline "The only memory tool for Copilot Chat"

---

## Step 4 — Honest re-writes for each channel

### HN — new title candidates (from README, no invention)

- Option A (bookmark angle): *"Show HN: Persistent memory for AI coding sessions with resume-point bookmarks"*
- Option B (transcript harvest): *"Show HN: I mine Claude Code's on-disk transcripts for AI-session bookmarks"*
- Option C (broad + honest): *"Show HN: Infernoflow — persistent memory for Cursor, Claude Code, Copilot Chat, Windsurf"*

**Recommend Option B** — the transcript-harvest technique is the most novel-per-README-line-29, and HN rewards clever technique stories.

### Twitter tweet 1 candidates

- Option A: *"AI coding assistants forget everything between sessions. I built a resume-point system that reads Claude Code's on-disk transcripts and stashes the last 40 turns as a jumpable bookmark. 🧵"*
- Option B: *"What if `bookmark this` in your AI chat actually saved a resume point? I built that. 🧵"*

**Recommend Option A** — technical hook, verifiable via README line 29.

### Homepage hero

> **infernoflow — persistent memory for AI coding sessions.**
> Bookmarks + editor squigglies + open protocol.
> Cursor · Claude Code · Copilot Chat · Windsurf.

Every word cited.

---

## Step 5 — What must NOT appear anywhere

Per feedback memory `feedback_no_fabrication`:

- ❌ "The only memory tool for GitHub Copilot Chat" (false — MCP is supported)
- ❌ "Because Copilot doesn't support MCP" (false — GA since VS Code 1.102, July 2025)
- ❌ "No other tool works with Copilot" (false)
- ❌ "MCP-only tools skip Copilot" (false)
- ❌ Any "only" / "no one else" / "the first" claim without a verified source

---

## Step 6 — Recovery path (what to fix, in order)

1. ✅ **README** — corrected (this task, 3 edits made)
2. **Site `index.html`** hero badge — leave as-is or align to new positioning line
3. **`11_POSITIONING.md` v1** — archive as `.deprecated.md` with a header linking here
4. **`01_show_hn.md`** — rewrite title + body to Option B (transcript harvest)
5. **`05_twitter_thread.md`** — rewrite tweets 1-3 (currently lead with the false claim)
6. **`04_reddit_copilot.md`** — rewrite lede (currently frames LMT as the only path)
7. **`assets/DIAGRAM_1_lmt_vs_mcp.svg`** — remove "Doesn't support MCP" panel, replace with dual-transport diagram
8. **`assets/HERO_og_image.svg`** — replace headline "The only memory tool for GitHub Copilot Chat" with the README-derived headline
9. **`assets/HERO_og_image_v3_code.svg`** — replace headline "Your Copilot Chat finally remembers" (implies previous state) with something factual
10. **`memory/infernoflow_positioning.md`** — update to reflect this brief

**Time budget:** ~90-120 minutes of focused edits. All source-verifiable.
