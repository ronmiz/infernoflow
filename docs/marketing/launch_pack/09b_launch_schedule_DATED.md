# Launch Schedule — DATED (real calendar, Aug 2026)

**Built:** 2026-08-07 (Fri). Supersedes the generic Day1=Monday plan in `09_launch_schedule.md`.
**npm @latest = 0.44.15 — VERIFIED LIVE 2026-08-07. Bookmarks are shipping.**
**Timezones:** times shown as source-zone → **Israel (IDT, UTC+3)**. PT = US Pacific (UTC-7), ET = US Eastern (UTC-4).

Anchor decision: **Show HN on Tuesday Aug 11** (Tue–Thu mornings PT are HN's strongest window), not Monday. WhatsApp/Telegram soft-launch goes out this weekend to warm groups first.

---

## Phase 0 — Pre-launch (Fri Aug 7 → Sun Aug 9)

Owned surfaces must be perfect BEFORE any announcement — every link drives here.

- [ ] npm README hero shows bookmarks + install (verify render on npmjs.com)
- [ ] `npm view infernoflow version` → 0.44.15 ✓ (done)
- [ ] Site www.infernoflow.dev: bookmark + Copilot sections visible; hero badge → 0.44.15
- [ ] GitHub repo: About/topics filled, repo pinned to profile, Discussions enabled, SECURITY.md present, social-preview image set
- [ ] VS Code Marketplace listing current (verify live version) + **publish to Open VSX** (Cursor/Windsurf/VSCodium install from there)
- [ ] Twitter/X bio has infernoflow link
- [ ] Prime 3–5 people to upvote HN in the first 10 min (natural, not fake)
- [ ] **Sat–Sun: WhatsApp + Telegram soft launch** — bookmark-led text (`12_whatsapp_announcement.md`) to IL + intl dev groups. Answer every reply within the hour.

---

## Day 1 — Tue Aug 11: Hacker News + Twitter

- **08:00 PT → 18:00 IL** — Submit Show HN (`01_show_hn.md` / `PASTE_HN_*`).
- **08:30 PT → 18:30 IL** — Author reply Comment 1 (technical). 
- **08:45 PT → 18:45 IL** — Author reply Comment 2 (CLAUDE.md objection).
- **09:00 PT → 19:00 IL** — Start Twitter thread (`05_twitter_thread.md`); HN link in tweet 14.
- **09:00–11:00 PT → 19:00–21:00 IL** — Reply to every HN comment; thank early upvoters.
- **11:00 PT → 21:00 IL** — Check HN rank. If on front page, do NOT cross-post to Reddit yet — let it breathe.
- **14:00 PT → 24:00 IL** — Cold outreach Template A to 5 newsletter authors (`08_cold_outreach.md`).
- **17:00 PT → 03:00 IL (next morning)** — Post-mortem: screenshot HN rank, tweet count, npm bump.

---

## Day 2 — Wed Aug 12: r/cursor + r/GithubCopilot

- **10:00 ET → 17:00 IL** — r/cursor (`02_reddit_cursor.md`).
- **11:00 ET → 18:00 IL** — r/GithubCopilot (`04_reddit_copilot.md`) — **strongest angle**.
- Throughout — reply to comments in both subs.
- **16:00 ET → 23:00 IL** — Cold outreach Template B to 3 YouTube devrels.

---

## Day 3 — Thu Aug 13: r/ClaudeAI + dev.to

- **10:00 ET → 17:00 IL** — r/ClaudeAI (`03_reddit_claude.md`).
- **12:00 ET → 19:00 IL** — Publish dev.to post (`07_devto_post.md`); reference the HN thread at the bottom.
- **16:00 ET → 23:00 IL** — Cold outreach Template D to 5 companies.

---

## Day 4 — Fri Aug 14: niche subs + LinkedIn

- Post to 2–3 of: r/programming (strict — read rules), r/vscode, r/typescript, r/opensource, r/LocalLLaMA, r/ChatGPTCoding. Draft each FRESH — no copy-paste.
- LinkedIn personal post (dev-audience narrative + link).
- Cold outreach Template E follow-ups to anyone who replied Day 1–2.

---

## Weekend — Sat Aug 15 / Sun Aug 16: monitor + patch

- Fix any bug reports from launch feedback.
- Ship a small patch (users love fast iteration).
- Prep Product Hunt assets for Monday.

---

## Week 2

- **Mon Aug 18 — 00:01 PT → 10:01 IL** — Product Hunt launch (`10_product_hunt.md`). Be online all day IL time to reply.
- **Wed Aug 20** — Republish dev.to post to Medium + Hashnode with canonical link back to dev.to.
- **Fri Aug 22** — Weekly recap tweet: "1 week ago I launched infernoflow — here's what happened" + metrics.

---

## Metrics — update every 12h (`launch_metrics.md`)

HN rank/upvotes/comments · Twitter impressions/replies · Reddit upvotes per post · npm 7-day downloads (`npm view infernoflow`) · GitHub stars/issues · Marketplace + Open VSX installs · site pageviews. Compare Day 7 vs baseline 10–30/day.

## Red flags (from `09_launch_schedule.md`)

HN below rank 30 after 4h → wrong title/day; wait a week, revise angle. Reddit <10 upvotes after 4h → delete, rewrite, different sub. Cold outreach 0/5 → too generic; personalize line 1.
