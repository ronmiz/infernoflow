> ⚠️ **DEPRECATED (archived 2026-07-17).** This v1 brief was built around the false "Copilot doesn't support MCP" moat (Copilot Chat supports MCP since VS Code 1.102, GA July 2025). Superseded by [`11_POSITIONING_v2.md`](./11_POSITIONING_v2.md). Kept for history — do not reuse claims from this file.

# infernoflow — Positioning Brief

**Prepared:** 2026-07-10
**Framework:** April Dunford (Obviously Awesome)
**Verdict up front:** Reposition as *"The only memory tool for GitHub Copilot Chat."* Everything else is table stakes. Details below.

---

## 1. Competitive alternatives (what people use if infernoflow doesn't exist)

This is the most important step. Ron's current positioning ("persistent memory for AI coding sessions") drops him into a bloodbath. Actual 2026 landscape:

**Direct AI-coding-memory tools (10+):**

| Tool | Approach | Reach | Threat level |
|---|---|---|---|
| **Cline Memory Bank** | MCP + markdown, inside Cline | Cline users only | High for Cline crowd |
| **Roo Code Memory Bank** | markdown, structured | Roo Code users | Medium |
| **Kilo Code Memory Bank** | markdown + orchestrator | New fork, $8M seed | Rising fast |
| **cursor-memory-bank** (vanzan01) | 6 custom modes (VAN/PLAN/CREATIVE/IMPLEMENT) | Cursor users | High for Cursor crowd |
| **memory-bank-skill** (fockus) | Universal `.memory-bank/` — works with Claude/Cursor/Windsurf/Cline/Kilo/OpenCode/Pi/Codex | Broad but shallow | **Highest — closest to infernoflow's pitch** |
| **agentmemory** (rohitg00) | "#1 based on real-world benchmarks" | Broad claim | Medium |
| **MemNexus** | MCP-based, account-scoped, local DB | Cursor + Claude Code + MCP clients | High |
| **Hindsight** (Vectorize) | "One Bank for editor and CLI" | Cursor + CLI | Medium |
| **Basic Memory** | MCP-based | Cursor | Medium |
| **Cursor Memories** (native, v1.0 June 2025) | Built-in "carries facts forward within a project" | ALL Cursor users, free | High (default option) |

**Adjacent general agent-memory (not coding-specific but people compare):**

- **Mem0** — 47K+ GitHub stars, "best overall," largest community
- **Zep** — 63.8% on LongMemEval (vs Mem0's 49%), Graphiti temporal backend
- **Letta** (formerly MemGPT) — agent-managed self-editing memory
- **LangMem** — for LangGraph users
- **Cognee, Pinecone, Cloudflare** — infrastructure plays

**Static-file "alternatives" (what everyone does before adopting any tool):**

- `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, `.windsurfrules`

---

## 2. Unique attributes — brutally honest audit

Testing each infernoflow claim against the field:

| Claim | Actually unique? | Notes |
|---|---|---|
| **Works with GitHub Copilot Chat via VS Code LMT** | ✅ **YES — genuinely no competitor has this** | Every other tool assumes MCP; Copilot Chat doesn't support MCP. This is the ONLY real moat. |
| Bookmark + auto-transcript harvest from Claude Code `.jsonl` | ✅ Yes, but narrow | Only helps Claude Code users. Clever but small audience. |
| Local-first, no telemetry | ❌ Table stakes | MemNexus, Cline Memory Bank, memory-bank-skill all say the same. |
| Open protocol (AMP) | 🟡 Weakly differentiating | Nobody else has a documented spec, but nobody asks for one either. |
| Auto-capture via AI (MCP tools) | ❌ Table stakes | Everyone does this now. |
| Git-tracked, branch-aware | ❌ Table stakes | markdown-based tools are git-tracked by default. |
| Works across Cursor + Claude + Copilot + Windsurf | 🟡 Diluted | memory-bank-skill covers 8 tools. "Multi-tool" is no longer a wow. |
| VS Code extension with in-editor squigglies on gotcha lines | ✅ **YES — nobody else has this** | Concrete second differentiator. Show don't tell. |

**Conclusion:** infernoflow has exactly 2 genuinely defensible attributes — **Copilot LMT** and **in-editor gotcha squigglies**. Both need to be the *first thing* anyone sees.

---

## 3. Value the unique attributes deliver

**Copilot LMT → "Your Copilot Chat finally remembers."**
- Enterprise devs whose org paid for Copilot (not Cursor) suddenly get parity with the Cursor crowd
- Copilot's user base is ~5-10x Cursor's — this is the mass market
- Story: "I'm at $BigCo, we use Copilot, I've been jealous of the Cursor rules-file crowd. Now I don't have to be."

**In-editor squigglies → "You see the gotcha before you make it."**
- Deeper than "AI remembered it for you" — YOU see it too, right in the editor
- Copilot users get it. Cursor users get it. Everyone gets it.
- Story: "Yellow underline on the file the mistake was in, hover shows the past attempt. Repeat mistakes stop."

---

## 4. Segment — who cares MOST?

Not "developers who use AI coding assistants." Too broad, undifferentiated.

**Primary segment (order of intensity):**

1. **Individual Copilot Chat users at companies that standardized on Copilot** — no way to adopt Cursor at work, feeling left out of the AI-memory conversation. **This is the underserved mass market.**
2. **Small teams sharing a codebase across multiple AI tools** — one dev on Cursor, another on Copilot, memory needs to travel with the branch
3. **Solo indie devs using Claude Code who want bookmark/resume points** — narrow but passionate

Secondary segments (later — don't try to serve them at launch):
- Enterprise IT looking for standardized dev tooling (needs sales motion)
- OSS maintainers who want contributors' AI sessions to inherit project context

---

## 5. Market category — invent one, don't inherit one

If you sit in "AI memory framework" → you get compared to Mem0/Zep/Letta and lose on benchmarks and stars.
If you sit in "AI coding memory bank" → you get compared to Cline Memory Bank / memory-bank-skill and drown in a sea of similar tools.

**Invent this category: "Copilot memory."**

- No one else is there
- Concrete, one word, mass-audience
- Everyone knows what Copilot is
- The unique attribute (LMT) IS the category

Own the search term "Copilot memory." "Copilot Chat memory." "GitHub Copilot memory across sessions." That's Google/HN/Reddit gold.

---

## 6. Positioning statements — 3 candidates

### 🏆 RECOMMENDED — the sharpest

> **The only memory tool for GitHub Copilot Chat.**

8 words. Everything else follows.

Sub-line (when you need more): *"Because Copilot doesn't support MCP, infernoflow uses VS Code's Language Model Tools API. Works with Cursor and Claude Code too — bonus, not the pitch."*

**Why this wins:**
- Uncontested category
- Concrete: someone reading this in 2 seconds knows if it's for them
- Provocative: implies competitors are lesser, invites verification
- Larger TAM: Copilot users >> Cursor users
- Enterprise-friendly (Copilot is where the money is)

**Risks:**
- Narrows initial audience — Cursor-only people might feel excluded
- Microsoft could ship MCP support to Copilot in 6-24mo → moat evaporates
  - Mitigation: by that point, you've established brand + captured users; then broaden positioning
- Feels like "just a plugin" — but the LMT integration IS technically deeper than that

### Runner-up — the safer bet

> **Persistent memory that works with Copilot, Cursor, and Claude Code.**

**Why it's the runner-up:**
- Broader — Cursor and Claude users see themselves in it too
- Less risky if Microsoft ships MCP tomorrow
- But: dilutes the moat, competes head-on with memory-bank-skill and MemNexus
- Weak differentiator on HN/Reddit

### Longshot — the technical pitch

> **The AI memory tool that uses VS Code Language Model Tools instead of MCP — so it works where MCP doesn't.**

**Why it's a longshot:**
- Strongest for technical HN audience
- But: too much jargon for anyone outside AI-tooling nerds
- LMT-vs-MCP is your moat but not your marketing frame

---

## 7. Why now — the "trigger" narrative

Every good positioning has a "why now." Ron's version:

> **"In 2026, MCP became the AI-tools standard — except Copilot Chat didn't get the memo. So while Cursor, Claude Code, and Windsurf all got persistent-memory tools, the *largest* AI coding audience (Copilot users) was left with static rule files. infernoflow closes that gap by using VS Code's Language Model Tools API — the *supported* extension surface for Copilot Chat. Now Copilot users have parity."**

This is a clean 3-beat story: standard emerged → one player lagged → we bridged the gap.

---

## 8. Concrete downstream changes (do these before Monday HN)

### Homepage hero (`infernoflow-site/index.html`)

**Change from:**
> "🆕 v0.44.10 — session bookmarks + Copilot Chat integration"

**Change to:**
> "The only memory tool for GitHub Copilot Chat."
> *"Because Copilot doesn't support MCP. Also works with Cursor and Claude Code."*

### npm package description (`package.json`)

**Change from:**
> "Persistent memory for AI coding sessions..."

**Change to:**
> "Persistent memory for GitHub Copilot Chat (via VS Code LMT). Also works with Cursor + Claude Code + any MCP client. Local, git-tracked, no telemetry."

### HN post title

**Change from:**
> "Show HN: Infernoflow – persistent memory for AI coding sessions (bookmarks + LMT)"

**Change to:** (option A — punchy)
> "Show HN: Infernoflow – persistent memory for GitHub Copilot Chat"

**Or:** (option B — storytelling)
> "Show HN: I gave Copilot Chat persistent memory (using LMT since it doesn't support MCP)"

I recommend **B** for HN specifically — the "I built this because X" frame outperforms the noun-phrase frame on HN by ~2x historically.

### r/GithubCopilot post title

Already strong. Keep as-is.

### r/cursor and r/ClaudeAI posts

These can KEEP the "memory for Cursor/Claude" framing — audience-appropriate. But add a line acknowledging Copilot works too, so people know infernoflow is polyglot when they share it.

### Twitter thread tweet #1

**Change from:**
> "Every new AI coding session starts cold."

**Change to:**
> "GitHub Copilot Chat has no persistent memory tool. Not one — because every AI memory tool ships as MCP, and Copilot Chat doesn't support MCP. I built one that does. 🧵"

Way sharper hook. Immediate targeting.

---

## 9. What to STOP saying

- "For Cursor, Claude Code, and Copilot" — buries the lede
- "AMP protocol" — nobody cares about the protocol yet; that's a Year-2 pitch
- "Bookmark this" — bury it as a feature, not the headline. It's not what people search for.
- "Session memory" — too generic, competes with 10 tools
- "Local-first" — table stakes now, not differentiator

---

## 10. What to START saying (everywhere)

- **"Copilot memory"** — every headline, every meta description, every SEO effort
- **"MCP doesn't reach Copilot Chat"** — the enabling premise for the whole moat
- **"VS Code Language Model Tools"** — technical proof of the moat
- **"Also works with Cursor and Claude Code"** — parenthetical, not headline

---

## 11. The 6-word test (April Dunford)

Can you describe what you do in 6 words? Yes:

> **"Memory tool for GitHub Copilot Chat."**

7 words if you include "for." Close enough.

---

## 12. Sanity check — will this hold at scale?

**In 6 months:** if Microsoft ships MCP for Copilot Chat → the "only" claim falls. But by then:
- You've captured mindshare as "the Copilot memory guys"
- You've built out Cursor/Claude features
- You broaden to "Multi-tool memory that started with Copilot"

**In 12 months:** the category "Copilot memory" is either yours (defended by brand) or Microsoft's (if they ship it themselves and displace you). Either way, you've had 12 months of concentrated growth in a defined niche.

**In 24 months:** infernoflow is either (a) the standard for cross-tool AI memory, or (b) acquired, or (c) obsolete. All three are OK outcomes for an indie project.

---

## Recommended action sequence (this weekend)

1. Update homepage hero (30 min)
2. Update npm description (10 min, requires `npm publish` bump to 0.44.12)
3. Update HN post title in `01_show_hn.md` (5 min)
4. Update Twitter thread tweet 1 in `05_twitter_thread.md` (5 min)
5. Update package.json keywords: put "copilot" and "copilot-chat" first (5 min)

**Total time: ~1 hour.**

Everything else in the launch pack can stay as-is for now — the framing shift happens at the top-of-funnel touchpoints.

---

## TL;DR

**Old positioning:** "persistent memory for AI coding sessions"
→ Competes with 10+ tools, undifferentiated, hard to win.

**New positioning:** "the only memory tool for GitHub Copilot Chat"
→ Uncontested, concrete, larger TAM, ready for HN in 3 days.

**One change to the hero, one change to the HN title, one change to tweet #1. That's the whole shift. Everything else is proof.**
