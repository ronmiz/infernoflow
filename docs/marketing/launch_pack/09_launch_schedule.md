# Launch Schedule — coordinated 7-day plan

**Assumption:** Day 1 = Monday. Adjust to your actual launch date.
**Goal:** compounding coverage. Each channel amplifies the ones before it.

## Pre-launch checklist (do BEFORE Day 1)

- [ ] Vercel DNS: `infernoflow.dev` (no www) redirects to `www.infernoflow.dev`
- [ ] `package.json` description updated
- [ ] `package.json` keywords updated (see `06_marketplace_listing.md` keyword list)
- [ ] `package.json` homepage → `https://www.infernoflow.dev`
- [ ] `SECURITY.md` visible in repo root
- [ ] `README.md` hero updated with new copy
- [ ] Site (`infernoflow-site/index.html`) deployed with v0.44.15 features
- [ ] npm `infernoflow@0.44.15` published — verify with `npm view infernoflow version` (VERIFIED LIVE 2026-08-07)
- [ ] VS Code extension v0.7.20 published to Marketplace with updated listing (verify live version before checking off)
- [ ] Repo pinned to your GitHub profile
- [ ] GitHub Discussions enabled (in repo Settings > Features)
- [ ] Twitter/X profile has infernoflow link in bio
- [ ] 3-5 people primed to upvote HN in first 10 min (natural, not fake)

---

## Day 1 — Monday: HN + Twitter

**08:00 PT (16:00 UTC):** Submit Show HN. See `01_show_hn.md`.

**08:30 PT:** Post pre-loaded Comment 1 (technical explanation) as author reply.

**08:45 PT:** Post pre-loaded Comment 2 (CLAUDE.md objection) as author reply.

**09:00 PT:** Start Twitter thread. See `05_twitter_thread.md`. Include link to HN in tweet 14.

**09:00-11:00 PT:** Reply to every HN comment. Answer questions. Thank early upvoters.

**11:00 PT:** Check HN rank. If it's on front page, do NOT cross-post to Reddit yet — HN traffic peaks 4-6 hours. Let it breathe.

**14:00 PT:** Cold outreach round — send Template A to 5 newsletter authors (see `08_cold_outreach.md`).

**17:00 PT:** Post-mortem — screenshot HN rank, tweet count, npm download bump. Save to `.ai-memory/details/launch_day1_metrics.md` (yes, use the tool for its own launch).

---

## Day 2 — Tuesday: r/cursor + r/GithubCopilot

**10:00 ET:** Post to r/cursor. See `02_reddit_cursor.md`.
**11:00 ET:** Post to r/GithubCopilot. See `04_reddit_copilot.md`. **This is the strongest post** — Copilot users have no alternative, so engagement should be high.

Different subreddits = different times so you can monitor both.

**Throughout day:** reply to comments in both subs.

**16:00 ET:** Cold outreach round — send Template B to 3 YouTube devrels.

---

## Day 3 — Wednesday: r/ClaudeAI + dev.to

**10:00 ET:** Post to r/ClaudeAI. See `03_reddit_claude.md`.

**12:00 ET:** Publish dev.to post. See `07_devto_post.md`. Reference the HN discussion at the bottom.

**Throughout day:** reply to comments.

**16:00 ET:** Cold outreach round — send Template D to 5 companies.

---

## Day 4 — Thursday: Broaden to niche subs

Candidates (post to 2-3, not all — spammy otherwise):

- r/programming (mods are strict — read rules first)
- r/webdev (broader audience, mixed signal)
- r/vscode (extension angle)
- r/typescript (dogfood story angle)
- r/opensource (AMP protocol angle)

Draft each fresh — do NOT copy-paste your r/cursor post. Reddit users hate cross-posting.

Cold outreach round — Template E follow-ups to anyone who replied Day 1-2 but didn't act.

---

## Day 5 — Friday: HN comment mining + Twitter thread #2

Any HN comment with real feedback → turn the insight into a follow-up tweet or a docs update.

**Second Twitter thread** (shorter, 5-7 tweets):
- "5 things I learned launching infernoflow on HN this week"
- Link to HN, dev.to, npm

---

## Day 6-7 — Weekend: quiet, monitoring

Weekend traffic is lower. Use the days to:
- Fix any bug reports from launch feedback
- Ship a v0.44.11 with any patches (users LOVE fast iteration)
- Post to Product Hunt on Sunday night for Monday launch (7-day feature window)

---

## Week 2 — Product Hunt + Medium republish

**Monday:** Product Hunt launch, 00:01 PT. See separate `10_product_hunt.md`.

**Wednesday:** Republish dev.to post to Medium with canonical link.

**Friday:** Weekly recap on Twitter — "1 week ago I launched infernoflow. Here's what happened."

---

## Metrics to track

Save to `launch_metrics.md` — update every 24h:

- HN: rank at 12h, total upvotes, comment count
- Twitter: thread impressions, follower delta, top tweet
- Reddit: upvotes + comments per post
- npm: `npm view infernoflow` download stats (7-day rolling)
- Site: analytics (Vercel or Cloudflare)
- GitHub: stars, issues, PRs
- Marketplace: installs, ratings

Don't obsess over hourly numbers. Check every 12h. Compare Day 7 vs Day 1.

---

## Red flags — pause and rework if you see these

- HN post stays below rank 30 after 4h → wrong title or wrong day. Wait a week, revise, retry with a different angle (LMT-focused vs bookmark-focused).
- Reddit posts <10 upvotes after 4h → title didn't land or you missed the community's tone. Delete, rewrite, retry different sub.
- Cold outreach 0/5 reply rate → over-targeted, too generic, or your subject line is spam-adjacent. Revise Template A subject line and try new prospects next week.

---

## When to stop launching and start iterating

The launch is a bump, not a runway. After Day 7-14, downloads and stars should plateau. That's expected. What matters is:

- **Did anyone open a real issue?** That's a user.
- **Did anyone open a PR?** That's a contributor.
- **Did any newsletter link to you?** That's evergreen traffic.

Iterate on those signals. Don't chase virality.
