# 🔥 Making infernoflow Outstanding — Deep Strategic Plan

> Based on thorough analysis of infernoflow v0.36.1 (50+ commands, ~5K weekly downloads)
> Created: April 29, 2026

---

## Executive Summary

infernoflow has **two products hiding inside one CLI**:

1. **Session Memory** — log gotchas, handoff to next AI agent (simple, viral, mass market)
2. **Capability Contracts** — freeze/thaw, impact analysis, CI gates (powerful, enterprise, niche)

**The problem:** Both are mixed together, confusing new users and diluting the value prop.

**The plan:** Separate them into two clear tiers, nail the first-60-seconds experience, and build distribution channels that grow themselves.

---

## Part 1: The First 60 Seconds (CRITICAL)

### Current Experience (Broken)

```
$ npm install -g infernoflow
$ infernoflow init
→ Creates inferno/ with contract.json, capabilities, scenarios
→ User sees "capabilities", "contract", "scenarios" 
→ User thinks: "I just wanted to remember that auth needs a header"
→ User closes terminal, never comes back
```

### Target Experience (Outstanding)

```
$ npm install -g infernoflow
$ infernoflow init

🔥 infernoflow — let's get you set up (30 seconds)

Detected: React + Vite project (package.json)

What would you like to remember for your next AI session?
> The remove API returns 202 not 200, don't wait for sync response

✅ First gotcha logged! That's it — you're using infernoflow.

Quick commands:
  infernoflow log "..."    — remember something
  infernoflow switch       — generate handoff for next AI
  infernoflow recap        — see your session summary

💡 Tip: infernoflow switch --copy puts the handoff on your clipboard.
   Paste it into your next Copilot/Cursor/Claude chat.

Want the full tour? Run: infernoflow demo
```

### What to Change

| Current | Should Be |
|---|---|
| `init` creates contract.json, capabilities, scenarios | `init` asks for first gotcha, creates sessions.jsonl |
| First thing user sees is "capabilities" | First thing user sees is their logged gotcha |
| `--help` shows 50+ commands | `--help` shows 5 core commands + "run `commands` for all" |
| `status` shows contract health | `status` shows session health (gotchas, decisions, attempts) |

### Implementation

```
infernoflow init --mode memory    ← NEW default (just session memory)
infernoflow init --mode full      ← current behavior (contracts + memory)
infernoflow init --mode contract  ← contracts only
```

Default should be `--mode memory`. Contracts unlock after the user has logged 10+ entries or explicitly opts in.

---

## Part 2: The 5-Command Core (What 90% of Users Need)

### Hide Everything Except These

| # | Command | What It Does | Keyboard Feel |
|---|---|---|---|
| 1 | `infernoflow log "..."` | Remember a gotcha, decision, attempt, or note | Like git commit -m |
| 2 | `infernoflow ask "..."` | Search your memory | Like grep |
| 3 | `infernoflow switch` | Generate handoff for next AI agent | Like git stash |
| 4 | `infernoflow recap` | End-of-session summary with health score | Like git log --oneline |
| 5 | `infernoflow status` | Quick health check | Like git status |

### The Other 45+ Commands

Group them behind progressive disclosure:

```
infernoflow --help

🔥 infernoflow v0.36.1 — Persistent memory for AI coding sessions

  Core:
    log "..."     Remember something (--type gotcha|decision|attempt|note)
    ask "..."     Search your memory
    switch        Generate handoff for next AI agent
    recap         Session summary + health score
    status        Quick health check

  More: infernoflow commands          ← shows all 50+
  Setup: infernoflow setup            ← one-command install
  Tour:  infernoflow demo             ← 5-minute walkthrough
```

This is how `git` works — most people use 5 commands. The other 140+ exist but don't overwhelm.

---

## Part 3: Make `switch` the Killer Feature

`infernoflow switch` is **the viral moment**. When a developer pastes a handoff into their next AI session and the AI *instantly* knows all the gotchas — that's magic.

### Current Output (Good but Not Stunning)

```
Session #27B5E7 · 0m
Memory        0 entries this session  (total: 6)
Capabilities  3 registered
```

### Target Output (Screenshot-Worthy)

```markdown
# 🔥 Agent Handoff — phoneRemover
Session: 2h 14m | Health: B (72/100) | 14 entries

## ⚠️ STOP — Read These Before Doing Anything (3 gotchas)
1. **API returns 202, not 200** — don't await a sync response
   → File: src/api.js:42
2. **Bootstrap 5.3 broke modals** — use `data-bs-toggle` not `data-toggle`
   → File: src/App.jsx:88
3. **Image upload max is 5MB** — server rejects silently above this
   → File: src/handlers.js:15

## ❌ Things That Were Already Tried (Don't Repeat)
1. Canvas API for client-side image processing — too slow for 4K (tried Apr 28)
2. WebSocket for progress updates — server doesn't support it, use polling

## ✓ Decisions In Effect (Follow These)
1. Bootstrap over Tailwind — matches existing admin panel
2. Vite dev server proxy — avoids CORS issues
3. Error handling: toast notifications, not alert()

## 📁 Hot Files (Most Edited This Session)
- `src/App.jsx` — 12 edits — main upload flow
- `src/api.js` — 4 edits — API client with retry
- `src/handlers.js` — 2 edits — form handlers

## 🧊 Frozen Capabilities (Do Not Modify)
- CreateItem — production-stable, 100% scenario coverage

## 🎯 What Was Being Worked On
Implementing the image upload flow with progress indicator
and retry logic for failed uploads.
```

### What Makes This Outstanding

1. **Gotchas FIRST** — most valuable, prevents mistakes
2. **File references** — AI agents can navigate directly
3. **"Hot files"** — auto-detected from git, no manual logging needed
4. **"What was being worked on"** — auto-inferred from recent commits/edits
5. **Copy-to-clipboard** — `infernoflow switch --copy` puts it right on clipboard
6. **AI-optimized format** — tested to actually improve Copilot/Claude responses

### The Viral Loop

```
Developer uses infernoflow switch
  → Pastes handoff into new AI chat
    → AI performs noticeably better
      → Developer screenshots the handoff
        → Posts on X/Twitter: "This tool just saved me an hour"
          → 100 developers install infernoflow
            → Repeat
```

---

## Part 4: Auto-Capture (Zero-Effort Memory)

**This is the #1 retention feature.** Users forget to `log`. Auto-capture makes infernoflow valuable even when the user does nothing.

### Level 1: Git Hook Capture (Easy — 1 Week)

On every commit, auto-extract:
```
infernoflow setup --hooks

# Now on every git commit:
# - Detects which capabilities were touched
# - Adds a session note: "Modified CreateItem (src/api.js)"
# - If a frozen capability was touched: warns in commit message
```

### Level 2: Smart Detection (Medium — 2 Weeks)

```
# Detects patterns that indicate gotchas:
- Same file edited 5+ times → "Stuck? Log what's tripping you up"
- Test file deleted → "Removed test — was it failing? Log why"
- Dependency changed → "Switched from X to Y — log the decision"
- Error in terminal output → "Build failed — log the gotcha?"
```

### Level 3: Watch Mode (Advanced — 1 Month)

```
infernoflow watch

🔥 Watching your session... (Ctrl+C to stop)

10:32  Started session
10:45  [auto] Modified src/api.js — detected retry logic addition
10:52  [auto] Same file edited 6 times — prompted gotcha
11:15  [auto] npm install axios — logged dependency decision
11:30  [auto] Git commit: "Add upload progress" — linked to CreateItem
12:00  infernoflow recap → Session health: A (92/100) — 8 auto-captured entries
```

**The dream:** Code for 2 hours, never type `infernoflow` once, get a perfect handoff.

---

## Part 5: Fix the Contract System (Don't Remove — Reposition)

The capability contract system is actually **powerful and unique**. But it's mispositioned.

### Current Problem

- Shown to new users immediately → confusion
- Mixed with session memory → unclear what infernoflow IS
- "Contract" sounds legal/boring
- "Capabilities" is too abstract

### The Fix: Two Clear Tiers

```
┌─────────────────────────────────────────────────┐
│  TIER 1: Session Memory (Free, Default)         │
│                                                 │
│  log · ask · switch · recap · status            │
│  "Remember what matters between AI sessions"    │
│                                                 │
│  Target: Every developer using AI               │
│  Onboarding: 60 seconds                         │
│  Retention trigger: First successful handoff     │
└─────────────────────────────────────────────────┘
           │
           │  After 10+ logs, show:
           │  "Ready for the next level? Try infernoflow contracts"
           ▼
┌─────────────────────────────────────────────────┐
│  TIER 2: Capability Contracts (Pro Feature)     │
│                                                 │
│  scan · freeze · impact · graph · test · ci     │
│  "Protect what matters in your codebase"        │
│                                                 │
│  Target: Teams, lead developers, enterprises    │
│  Onboarding: 15-minute guided setup             │
│  Retention trigger: First CI gate that catches  │
│  a breaking change                              │
└─────────────────────────────────────────────────┘
```

### Rename for Clarity

| Current Term | Suggested Term | Why |
|---|---|---|
| Contract | Blueprint | Less legal, more technical |
| Capability | Component | Developers already think in components |
| Scenario | Checkpoint | Implies verification without "test" baggage |
| Frozen | Protected | Clearer intent |
| Liquid | Flexible | Matches mental model |

---

## Part 6: Distribution Strategy (How to Get to 50K Downloads)

### Current: ~5K Weekly Downloads (Organic/AI-Recommended)

### Channel 1: VS Code Extension (We're Building This)

- **Impact:** 3-5x current downloads
- **Why:** Visual, discoverable, zero CLI friction
- **Marketplace SEO:** "AI memory", "copilot context", "session handoff"
- **Growth mechanic:** Extension recommends CLI for power features

### Channel 2: GitHub Action / PR Bot

```yaml
# .github/workflows/infernoflow.yml
- name: infernoflow PR Check
  uses: infernoflow/action@v1
  with:
    check-frozen: true
    add-comment: true
```

PR comment:
```
🔥 infernoflow — PR Impact Report

⚠️ This PR touches 2 files with active gotchas:
  - src/api.js: "API returns 202 not 200"
  - src/handlers.js: "Image upload max is 5MB"

🧊 Protected components affected: CreateItem
   → 1 checkpoint at risk

Tip: Run `infernoflow impact CreateItem` locally for full analysis.
```

- **Impact:** Team virality — one person installs, whole team sees value
- **Growth mechanic:** Every PR comment is an ad for infernoflow

### Channel 3: CLAUDE.md / .cursorrules Auto-Injection

```
infernoflow context

# Auto-generates CLAUDE.md with:
- All gotchas
- All decisions
- Capability map
- File ownership

# AI agents read this automatically — zero paste needed
```

This is **huge**. If CLAUDE.md is auto-maintained, developers get handoff benefits **without doing anything**. Every AI session is automatically better.

### Channel 4: "Powered by infernoflow" Badge

```markdown
<!-- In README.md -->
[![infernoflow](https://img.shields.io/badge/memory-infernoflow-orange)](https://infernoflow.dev)
```

Like "Powered by Vercel" — social proof + backlink.

### Channel 5: AI Agent Integration

The ultimate play: infernoflow becomes the **memory layer** that AI agents use natively.

```
# In Copilot Chat:
@infernoflow what gotchas exist for the auth module?

# In Cursor:
# Auto-injected via .cursorrules — no user action needed

# In Claude:
# MCP server (already exists!) — tool calls for memory
```

---

## Part 7: Polish & Quality Fixes

### Fix These Immediately

| Issue | Fix | Priority |
|---|---|---|
| Unicode rendering broken in Windows PowerShell | Use ASCII fallbacks when terminal doesn't support UTF-8 | P0 |
| `@scarf/scarf` blocks npm install on Windows | Make it a soft dependency, don't fail install | P0 |
| `infernoflow changelog` runs on wrong project context | Detect when inside infernoflow-vscode subfolder | P1 |
| 50 commands shown by default | Progressive disclosure (5 core + `commands` for all) | P1 |
| `init` creates contracts by default | Default to session-memory-only mode | P1 |
| No README in VS Code extension | Add README.md with screenshots | P2 |
| Health score formula unclear | Show "log 2 gotchas to reach C, 3 decisions for B" | P2 |

### Windows PowerShell Unicode Issue

The box-drawing characters render as `ΓפאΓפא` garbage in Windows PowerShell. This is the **#1 polish issue** because many developers use PowerShell.

**Fix:** Detect terminal capabilities and use ASCII fallbacks:
```
# Current (broken in PowerShell):
  ──────────────────────────

# Should fallback to:
  ==============================

# Current:
  │ Capability │ Status │
  
# Fallback:
  | Capability | Status |
```

### The Scarf Install Bug

`npm install -g infernoflow` fails on Windows because `@scarf/scarf` postinstall script can't find `cmd.exe` path. This is **blocking new users from installing**.

**Fix:** Wrap the Scarf require in a try/catch that actually works on Windows:
```javascript
// Current (broken):
node -e "try{require('@scarf/scarf')}catch(e){}" 2>/dev/null

// Fix: Use node's --no-warnings and proper Windows redirect
node -e "try{require('@scarf/scarf')}catch(e){}" 2>NUL || exit 0
```

Or better: make Scarf optional and don't run it in postinstall.

---

## Part 8: Pricing & Business Model

### Free Tier (Individual Developer)

Everything in Tier 1 (Session Memory):
- log, ask, switch, recap, status
- Unlimited local entries
- CLAUDE.md / .cursorrules generation
- Git hook auto-capture
- VS Code extension

### Pro Tier — $12/month (Power Developer)

Everything in Tier 2 (Capability Contracts):
- scan, freeze, impact, graph, test
- AI-powered explain, why, review
- Cloud sync across machines
- Priority support

### Team Tier — $29/month per seat (Teams)

- Everything in Pro
- team-sync, share, pr-comment, pr-impact
- GitHub Action for CI gates
- Team dashboard
- Shared memory across team members

### Enterprise — $79/month per seat

- Everything in Team
- SSO/SAML
- Audit logs
- Custom integrations
- Dedicated support

---

## Part 9: Metrics That Matter

### North Star Metric

**Weekly Active Sessions with 3+ Entries**

Not downloads, not installs — actual usage. A session with 3+ entries means the user found value.

### Funnel to Track

```
npm install              → 100%
infernoflow init         →  60%  (40% never run init)
First log                →  30%  (50% drop at "what do I type?")
First switch/handoff     →  15%  (this is the magic moment)
Second session           →   8%  (retention cliff)
Weekly active (4 weeks)  →   4%  (these are your champions)
```

### Target Metrics (6 months)

| Metric | Current | Target |
|---|---|---|
| Weekly downloads | ~5,000 | 25,000 |
| Weekly active users | ~200 (est.) | 3,000 |
| 7-day retention | ~8% (est.) | 25% |
| Handoffs generated/week | unknown | 5,000 |
| VS Code extension installs | 0 | 5,000 |
| GitHub stars | ~50 | 500 |
| Paid conversions | 0 | 100 Pro, 20 Team |

---

## Part 10: 90-Day Execution Roadmap

### Month 1: "Make It Stick" (Retention Focus)

| Week | Deliverable |
|---|---|
| Week 1 | Fix Windows PowerShell unicode + Scarf install bug |
| Week 1 | Simplify `--help` to 5 core commands |
| Week 2 | New `init --mode memory` (session-only, 60-second onboarding) |
| Week 2 | Stunning `switch` output with file references + hot files |
| Week 3 | Auto-capture via git hooks (`setup --hooks`) |
| Week 3 | `switch --copy` clipboard support |
| Week 4 | VS Code extension on marketplace (what we built!) |
| Week 4 | Weekly impact email: "You saved X hours this week" |

**Success metric:** 7-day retention doubles from ~8% to 16%

### Month 2: "Make It Spread" (Growth Focus)

| Week | Deliverable |
|---|---|
| Week 5 | CLAUDE.md auto-maintenance (context command enhanced) |
| Week 5 | .cursorrules auto-generation |
| Week 6 | GitHub Action v1 (PR comments with gotcha warnings) |
| Week 6 | "Powered by infernoflow" badge for READMEs |
| Week 7 | Landing page with demo video |
| Week 7 | Hacker News / Reddit launch post |
| Week 8 | Content: "How we reduced AI redo-commits by 40%" blog post |

**Success metric:** Weekly downloads reach 15,000

### Month 3: "Make It Pay" (Revenue Focus)

| Week | Deliverable |
|---|---|
| Week 9 | Pro tier launch ($12/mo) — AI features + cloud sync |
| Week 9 | Team tier launch ($29/seat) — team-sync + PR integration |
| Week 10 | Copilot Chat participant (MCP-based) |
| Week 10 | In-product upgrade prompts (tasteful, not annoying) |
| Week 11 | Enterprise outreach to companies with 10+ infernoflow users |
| Week 12 | Case study: "How [Company] uses infernoflow for AI handoffs" |

**Success metric:** 100 paid subscribers, $2K MRR

---

## Part 11: The One Thing That Would Change Everything

If infernoflow could do **only one thing**, it should be this:

> **Make every AI session start with perfect context, automatically, with zero effort from the developer.**

That means:
1. Auto-capture gotchas, decisions, and failed attempts (git hooks + watch mode)
2. Auto-maintain CLAUDE.md / .cursorrules / .github/copilot-instructions.md
3. AI agents read it automatically — no paste, no copy, no manual step

**If infernoflow achieves this, it becomes infrastructure.** Like `.gitignore` — you set it up once and forget it exists, but removing it would be painful.

That's the difference between a tool developers *use* and a tool developers *keep*.

---

## Summary: The 5 Things to Do RIGHT NOW

| # | Action | Time | Impact |
|---|---|---|---|
| 1 | Fix Windows PowerShell unicode rendering | 2 days | Stops embarrassing first impression |
| 2 | Fix `@scarf/scarf` install failure on Windows | 1 day | Unblocks new users |
| 3 | Make `--help` show only 5 commands | 1 hour | Reduces overwhelm by 90% |
| 4 | New `init` that asks for first gotcha | 3 days | Magic moment in 60 seconds |
| 5 | Make `switch` output stunning with auto-detected hot files | 3 days | Creates the viral screenshot moment |

**Total: 10 days of work to go from "interesting tool" to "outstanding tool".**

---

*This plan was created by analyzing infernoflow v0.36.1 with 50+ commands, testing every major feature, reviewing the onboarding flow, and comparing against successful developer tools like commitizen, husky, and lint-staged.*
