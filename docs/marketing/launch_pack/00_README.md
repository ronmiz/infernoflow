# infernoflow — Launch Pack

Coordinated launch materials for v0.44.15. Read `09_launch_schedule.md` first — everything else slots into that timeline.

## Files

| # | File | What it is | When to use |
|---|------|------------|-------------|
| 00 | This README | Index | First |
| 01 | `01_show_hn.md` | Show HN post + pre-loaded comments + Q&A | Day 1, 08:00 PT |
| 02 | `02_reddit_cursor.md` | r/cursor post | Day 2, 10:00 ET |
| 03 | `03_reddit_claude.md` | r/ClaudeAI post | Day 3, 10:00 ET |
| 04 | `04_reddit_copilot.md` | r/GithubCopilot post — strongest angle | Day 2, 11:00 ET |
| 05 | `05_twitter_thread.md` | 14-tweet thread | Day 1, 09:00 PT (with HN) |
| 06 | `06_marketplace_listing.md` | VS Code Marketplace copy + package.json fields | Pre-launch |
| 07 | `07_devto_post.md` | Long-form dev.to post | Day 3, 12:00 ET |
| 08 | `08_cold_outreach.md` | 5 email templates for outreach | Day 1-4 rolling |
| 09 | `09_launch_schedule.md` | 7-day coordinated timeline | Reference throughout |
| 10 | `10_product_hunt.md` | Product Hunt launch (Week 2) | Day 8, 00:01 PT |

## The pitch — one paragraph

Every new AI coding session starts cold. The gotchas you found yesterday, the decisions you made with the "because," the dead ends you already tried — none of it survives. infernoflow makes them stick. Local JSONL memory, git-tracked, auto-captured by the AI itself via MCP (Cursor, Claude Code) or VS Code Language Model Tools (GitHub Copilot Chat — zero-config; Copilot Chat also supports MCP since VS Code 1.102, and infernoflow wires both transports). Session bookmarks with auto-transcript capture on Claude Code. Open protocol (AMP), MIT-licensed. No telemetry, no postinstall, no network calls in the default path.

## Three angles — pick the right one per channel

| Angle | Best for | Files that lead with it |
|---|---|---|
| **Copilot LMT** (the unique moat) | HN, r/GithubCopilot, dev.to | 01, 04, 07 |
| **Bookmark + transcript harvest** | r/cursor, r/ClaudeAI, Twitter | 02, 03, 05 |
| **Open protocol, no telemetry** | Show HN comments, cold outreach to security-conscious teams | Q&A sections, 08 |

## Pre-flight checklist

Before Day 1:

1. Vercel: `infernoflow.dev` → `www.infernoflow.dev` redirect
2. `npm view infernoflow version` returns `0.44.15`
3. VS Code Marketplace listing shows v0.7.19 with updated categories (AI first)
4. `www.infernoflow.dev` loads with new bookmark + Copilot sections visible
5. GitHub Discussions enabled on the repo
6. `SECURITY.md` in repo root
7. `.github/copilot-instructions.md` marker-wrapped block correct
8. 3-5 people primed to upvote HN

## Metrics — save these to `.ai-memory/details/launch_metrics.md`

Update every 12h during launch week:

- HN rank + upvotes + comments
- Twitter thread impressions + reply count
- Reddit upvotes per post
- npm 7-day downloads
- GitHub stars + issue count
- VS Code Marketplace installs
- Site pageviews (Vercel analytics)

## Common failure modes — and the fix

**HN post stalls below rank 30 after 4h**
→ Wrong day or wrong title framing. Wait a week, revise, retry with a different angle.

**Reddit post gets <5 upvotes**
→ Title didn't land or you missed the sub's tone. Delete after 4h, rewrite, try a different sub.

**No cold-outreach replies**
→ Personalize the first line more. Sending 5 personalized > 500 templated.

**Twitter thread <100 impressions**
→ Wrong hook. First tweet has to promise the payoff explicitly.

## Follow-up (Week 2+)

- Product Hunt launch (`10_product_hunt.md`)
- Weekly "here's what shipped" tweet
- Ship v0.44.11 based on launch feedback (fast iteration = user love)
- Second Twitter thread: "5 things I learned from launching infernoflow on HN"

Good luck.
