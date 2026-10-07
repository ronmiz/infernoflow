# GitHub Discussions — Setup Guide (5 min)

Everything ready to paste. Copy sections as needed.

---

## Step 1 — Enable Discussions on the repo

1. Go to https://github.com/ronmiz/infernoflow
2. Click **Settings** (top-right of repo header)
3. Scroll to **Features**
4. Check ✅ **Discussions**
5. Click **Set up discussions** when prompted

Takes 30 seconds.

---

## Step 2 — Create 4 categories

Once enabled, go to https://github.com/ronmiz/infernoflow/discussions/categories

GitHub gives you defaults (Announcements, General, Ideas, Polls, Q&A, Show and tell). Adjust to:

### Keep + rename

| Default | Rename to | Description | Icon |
|---|---|---|---|
| **Announcements** | Announcements | Releases, breaking changes, roadmap updates | 📢 |
| **General** | General | Anything that doesn't fit elsewhere | 💬 |
| **Q&A** | Q&A | Ask a question — mark answers with ✅ | 🙏 |
| **Ideas** | Ideas | Feature requests, protocol suggestions | 💡 |
| **Show and tell** | Show and Tell | Share how you're using infernoflow | 🎉 |

### Delete

- **Polls** — you're not running polls at this stage

---

## Step 3 — Post the seed message (Show and Tell)

**Category:** Show and Tell
**Title:**
```
Dogfooding infernoflow on itself — real .ai-memory/ entries from this repo
```

**Body:**
```
This repo uses infernoflow to track its own gotchas. If you're wondering what real-world entries look like — they're right there in `.ai-memory/sessions.jsonl` in this repository.

A few highlights from the log:

- **decision** — v0.44.11 published to npm successfully, dogfooded via Cowork chat installing global CLI in a Linux sandbox and running it on the mounted repo path. Public launch is now unblocked.
- **gotcha** — Cowork sandbox needs npm prefix workaround for global installs — `mkdir ~/.npm-global && npm config set prefix`. Otherwise EACCES on `/usr/lib`. Doesn't affect end-user installs, only relevant when demoing infernoflow inside sandboxed AI environments.
- **gotcha** — Two managed blocks in CLAUDE.md: `<!-- infernoflow:start -->` (new, refreshed on log) and `<!-- AMP:START -->` (older). Consolidate to one block to avoid drift.

These weren't written by me sitting down and typing them into a doc. They were logged mid-session by the AI (Claude in this case) as we hit each one, via the `amp_write` MCP tool.

If you install infernoflow in your project and want to share what it catches for you — post here. Especially interested in:

- Cross-tool gotchas (something the AI hit in Cursor that helped Copilot later, or vice versa)
- Bookmark auto-harvest working (or not) with your Claude Code setup
- Any weird interactions with your existing rule files

Meta enough for you? 🔥
```

---

## Step 4 — Post the pinned welcome message (General)

**Category:** General
**Title:**
```
👋 Welcome — start here
```

**Body:**
```
Hi, and thanks for checking out infernoflow.

**First stop for anything you're not sure about:** search Discussions before opening an Issue. Issues are for bugs only.

### Where to post what

- **Q&A** — "How do I…?" / "Why does it…?" / "Can it…?"
- **Ideas** — "It would be great if…" / "What if the AMP spec supported…?"
- **Show and Tell** — What infernoflow caught in your project. Screenshots welcome.
- **Announcements** — Read-only (I post here).
- **General** — Anything else.

### For bugs

Open an [Issue](https://github.com/ronmiz/infernoflow/issues) with:
- What you ran
- What you expected
- What happened
- `infernoflow doctor` output (paste the full text)

### For security disclosures

Please use [private advisories](https://github.com/ronmiz/infernoflow/security/advisories/new) or email `hello@infernoflow.dev`.

### Contributing

PRs welcome. See CONTRIBUTING.md (coming soon — for now, open a Discussion in Ideas before writing code so we can align).

Thanks for being early. 🔥
```

**After posting:** click **Pin discussion** so it appears at the top of General.

---

## Step 5 — After HN launches (Monday)

Post an **Announcements** entry linking the HN discussion:

**Title:**
```
🚀 Show HN launched — v0.44.11 is public
```

**Body:**
```
infernoflow is on Show HN today: [link to HN]

Come say hi in the comments. Feedback especially welcome on:

- The VS Code LMT integration (the reason Copilot Chat is supported)
- The bookmark + Claude Code transcript harvest
- The AMP protocol spec

Also happy to answer questions here in Discussions if the HN thread moves fast.
```

Only post this AFTER the HN thread is up and you have the URL.

---

## What NOT to do

- ❌ Don't create too many categories at launch. 5 is plenty.
- ❌ Don't leave categories empty. Every category needs at least one seed post.
- ❌ Don't post the seed messages under your name if you have a co-maintainer — coordinate first.
- ❌ Don't fake activity by posting multiple seed threads pretending to be users. HN readers can smell it.
