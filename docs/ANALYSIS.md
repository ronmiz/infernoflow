# infernoflow — Product Analysis & Growth Roadmap

## What infernoflow Is

A persistent memory layer for AI coding sessions. Captures what AI agents can't infer from code — gotchas, decisions, failed attempts — and replays them into the next session. Ships as:

- **CLI** (`infernoflow` npm, v0.43.4) — core engine, 15 MCP tools, git hooks, cloud sync
- **VS Code Extension** (v0.7.4, marketplace) — sidebar UI, diagnostics, CodeLens, status bar
- **Library** (`infernoflow-amp` npm) — shared read/write layer for `.ai-memory/sessions.jsonl`
- **AMP Protocol** (v1.0) — vendor-neutral spec for AI session memory

## Current State

| Metric | Value |
|--------|-------|
| CLI npm version | 0.43.4 |
| CLI releases | 80+ in ~2.5 months |
| Extension version | 0.7.4 |
| Extension installs | 2 |
| GitHub stars | 0 |
| GitHub forks | 0 |
| GitHub repo visibility | Private (404) |
| Paying customers | 0 |

## What's Working

- **Real problem, no competitor.** No one else provides persistent cross-session memory for AI coding agents
- **Solid architecture.** CLI / extension / library separation is clean. AMP protocol is well-designed
- **15 MCP tools.** `infernoflow_implement`, `infernoflow_review`, `infernoflow_git_drift`, `infernoflow_scan_ui` go beyond basic note-taking
- **AMP-spec aliases** (`amp_read`, `amp_write`, etc.) — vendor-neutral positioning
- **Zero runtime dependencies** in CLI — installs fast, no supply chain risk
- **Multi-editor support** — works with Copilot, Cursor, Claude, Windsurf
- **Extension is now a thin UI layer** — delegates to CLI, shares format via `infernoflow-amp`

## What's Not Working

### Trust Problem
- GitHub repo is private — developers can't inspect source before installing a global CLI
- `postinstall` script in a closed-source package is a security red flag
- No public issue tracker (bugs URL → 404)

### Stability Problem
- 80+ npm releases in 2.5 months ≈ 1 release/day
- Signals debugging in production, not intentional iteration
- Users who install today get a different tool next week

### Discovery Problem
- 2 installs on VS Code marketplace
- 0 stars on GitHub
- No blog posts, no demo videos, no social proof
- "AMP protocol" has no credibility until someone else implements it

### Product Problem
- Pricing page exists but no Pro product is ready
- Cloud sync admitted to be insecure (anonymous Supabase writes)
- Team features are vaporware (waitlist only)

---

## Growth Roadmap: What To Do

### Phase 1: Trust (Week 1-2)

**Goal: Make developers comfortable installing infernoflow.**

1. **Open the GitHub repo.** This is non-negotiable. No developer installs a global CLI with a postinstall script from a 404 repo. MIT license is already declared — publish the source
2. **Remove the postinstall script** or make it a no-op that logs a welcome message. Every npm security guide flags postinstall scripts
3. **Add a `SECURITY.md`** explaining what the CLI does on disk, what data it collects, what cloud sync sends
4. **Pin a stable release.** Tag one version as "stable", document it, stop publishing daily to `latest`

### Phase 2: Stability (Week 2-4)

**Goal: Ship less, ship better.**

1. **Use `next` tag for pre-releases.** Publish daily to `npm install infernoflow@next`. Only promote to `latest` weekly/biweekly
2. **Write a real CHANGELOG.** Group changes by version. Developers need to know what changed and what broke
3. **Add CI smoke tests on every PR.** You already have smoke scripts — wire them to GitHub Actions
4. **Fix the cloud sync auth model.** Anonymous Supabase writes are a liability. Use proper auth or remove cloud sync from the free tier until it's secure

### Phase 3: Distribution (Week 4-8)

**Goal: Get to 100 installs and 10 active users.**

1. **Write one blog post:** "Why your AI coding assistant forgets everything and how to fix it." Post on Dev.to, Hashnode, and Reddit r/programming
2. **Record a 2-minute demo video.** Show: install → log gotcha → switch session → AI reads the handoff. Post on YouTube, embed on landing page
3. **Submit to awesome-mcp-servers list** on GitHub. MCP is hot right now — people are actively looking for MCP tools
4. **Post in AI coding communities:** Cursor forum, GitHub Copilot discussions, Claude Discord
5. **Ask 5 developers you know personally to try it.** Watch them install and use it. Note where they get confused

### Phase 4: Product (Month 2-3)

**Goal: Validate whether anyone will pay.**

1. **Don't build Pro yet.** Validate demand first. Add a "Pro waitlist" counter — if it stays at 0, there's no market
2. **Focus the free tier on one use case:** solo dev → log gotchas → handoff to next AI session. Don't promote team features, cloud sync, or CI integration until the core loop is proven
3. **Add delete/edit for entries.** Users will make typos. Immutable-only entries frustrate people
4. **Add a file watcher** on `.ai-memory/sessions.jsonl` so the extension updates live when the CLI writes entries
5. **Track one metric:** weekly active `infernoflow log` commands. If this number grows, the product works. If it doesn't, the problem is UX, not features

### Phase 5: Positioning (Month 3+)

**Goal: Own the category.**

1. **Get one other tool to implement AMP.** The protocol is worthless until it's not just yours. Reach out to Aider, Continue.dev, or smaller AI coding tools
2. **Publish the AMP spec as a standalone repo** with its own README, examples, and reference implementation
3. **Write a GitHub Action** that runs `infernoflow check` on PRs — this is the wedge into teams
4. **Consider renaming.** "infernoflow" doesn't communicate what it does. "AI Session Memory" or "Agent Memory Protocol" is clearer

---

## Key Metrics to Track

| Metric | Target (30 days) | Target (90 days) |
|--------|------------------|-------------------|
| npm weekly downloads | 50 | 500 |
| VS Code installs | 20 | 100 |
| GitHub stars | 10 | 50 |
| Active users (weekly log commands) | 5 | 25 |
| Pro waitlist signups | — | 20 |

---

## What 10/10 Looks Like

### Trust: 10/10

| Now | 10/10 |
|-----|-------|
| Private GitHub repo (404) | Public repo, visible source, visible issues |
| postinstall script nobody can inspect | No postinstall, or a transparent one-liner |
| No security docs | `SECURITY.md` + privacy policy explaining data flow |
| Anonymous Supabase writes | Proper auth (OAuth/JWT), encrypted at rest |
| Unknown who's behind it | Clear "About" page, author identity, company entity |
| No audit trail | Published security audit or at minimum dependency scan in CI |

### Engineering: 10/10

| Now | 10/10 |
|-----|-------|
| 80+ releases in 2.5 months | Semantic versioning, `latest` = stable, `next` = bleeding edge |
| No tests visible | 90%+ test coverage, CI badge on README |
| Smoke scripts only | Unit tests + integration tests + E2E for MCP tools |
| No CHANGELOG | Conventional commits, auto-generated changelog per release |
| Extension code in this workspace is v0.2.1 | Monorepo or synced repos, single source of truth |
| sessions.jsonl read 10+ times per refresh | Cached in memory, file watcher for external changes |
| No error handling for corrupted files | Graceful degradation, backup/recovery |

### Product-Market Fit: 10/10

| Now | 10/10 |
|-----|-------|
| 2 installs | 10,000+ installs |
| 0 paying users | 100+ Pro subscribers ($6/mo = $600 MRR minimum) |
| You use it, nobody else does | 5+ testimonials from real developers on the landing page |
| "I think this is useful" | Data: users who log gotchas retain at 60%+ weekly |
| Features built on assumption | Features built from user feedback/requests |
| Solves your problem | Solves a problem verified by 50+ users in interviews |
| No community | Discord/Slack with 200+ members discussing usage |

### Distribution: 10/10

| Now | 10/10 |
|-----|-------|
| No content | Blog with 10+ posts ranking for "AI coding memory", "AI context switching" |
| No video | YouTube demo with 5K+ views |
| No social proof | Featured in "awesome-mcp-servers", mentioned in 3+ newsletters |
| Nobody talks about it | 10+ organic tweets/posts from users (not you) |
| No SEO | Page 1 Google for "AI session memory" and "persistent AI coding context" |
| No partnerships | Integrated/mentioned by at least 1 major AI coding tool |
| AMP protocol = just yours | AMP implemented by 2+ other tools |
| Landing page exists but no funnel | Landing → install → first gotcha → handoff in <5 minutes, tracked |

---

## Priority Order — What To Do First

Steps 1-5 can be done in 2 weeks. They take you from ~2/10 to ~5/10 average across all dimensions.

```
 #  Action                                  Impact              Time
 1. Open the GitHub repo                    Trust 3→7           1 day
 2. Get 10 real users                       PMF 2→4             2-4 weeks
 3. Write 1 blog post + 1 demo video        Distribution 1→4    1 week
 4. Stabilize releases (semver + changelog)  Engineering 6→8     1 week
 5. Get on awesome-mcp-servers list          Distribution 4→5    1 day
 6. Collect 5 testimonials                   PMF 4→6             2 weeks
 7. Get 1 other tool to implement AMP        Distribution 5→7    months
 8. Hit 1,000 installs                       PMF 6→8             months
 9. Launch Pro with 20+ waitlist             PMF 8→9             months
10. Get featured in a newsletter/podcast     Distribution 7→9    luck + effort
```

The gap between 7/10 and 10/10 is not code — it's people using it, talking about it, and paying for it. No amount of engineering gets you there. Only distribution and proven value do.

---

## Current Scores

| Dimension | Score | Bottleneck |
|-----------|-------|------------|
| Concept | 8/10 | — |
| Trust | 3/10 | Private repo, postinstall script, no security docs |
| Engineering | 6/10 | Release cadence, no tests, no changelog |
| Product-Market Fit | 2/10 | 2 installs, 0 paying users |
| Distribution | 1/10 | No content, no social proof, no community |

## One-Line Summary

**Stop building features. Start building trust and distribution. The code is ahead of the market — close the gap.**
