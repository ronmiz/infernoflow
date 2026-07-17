# Cold Outreach Templates

**Rule of thumb:** never send more than 15/day. Personalize the first line every time. If it takes 30 seconds to skim their profile and mention something specific, do it. Otherwise you're spam.

---

## Template A — Newsletter authors covering AI tooling

**Targets:** authors of "The Pragmatic Engineer" (Gergely Orosz), Simon Willison's blog, Latent Space (Swyx), Bytes newsletter, JavaScript Weekly, Copilot Chronicles.

**Subject line:**
```
Copilot Chat's first real memory tool (via VS Code LMT)
```

**Body:**
```
Hi <Name>,

Read your <specific piece — e.g., "your recent piece on Copilot's tool-calling limits">. The point about MCP support being uneven across editors is exactly the gap I've been shipping into.

Quick context: Copilot Chat supports MCP (since VS Code 1.102), but per-project MCP wiring is friction. VS Code also has a zero-config path — `vscode.lm.registerTool` — that lets extensions register tools Copilot can call natively.

I shipped that. It's called infernoflow. The extension exposes `amp_write` and `amp_read` through the LMT API, so Copilot Chat gets persistent, file-backed memory without any MCP layer. Same tools work over MCP for Cursor and Claude Code.

Real example from my kanban repo: Copilot called `amp_read` on its own before running a Prisma migration, found a Windows DLL-lock gotcha I'd logged 3 weeks earlier, and asked me if it should stop the file watcher first. That's the whole product.

Local JSONL, no telemetry, MIT-licensed, git-tracked so it travels with the branch.

If you're covering AI-tooling gaps and want to write something up, happy to send you a walkthrough or hop on a call. No pressure — just wanted to put it on your radar because it slots into a story you've been telling.

Site: https://www.infernoflow.dev
Repo: github.com/ronmiz/infernoflow

Best,
Ron
```

---

## Template B — YouTube devrel / educators

**Targets:** Theo (t3.gg), Fireship, ThePrimeagen, Web Dev Simplified, Kent C. Dodds.

**Subject line:**
```
5-min demo idea: Copilot Chat with persistent memory (via LMT, not MCP)
```

**Body:**
```
Hi <Name>,

Big fan of <specific video>. Wanted to send this because the framing ("Copilot with real memory, using the supported VS Code API instead of MCP hacks") felt like a topic you'd cover well.

TL;DR — I built an extension that registers memory tools (`amp_write`, `amp_read`) via VS Code Language Model Tools. Copilot picks them up like native tools. During a chat, Copilot checks past discoveries before making changes — I can share a screen recording of it happening.

Angle for a video: **"Copilot finally remembers things — and how it works under the hood."**

The under-the-hood story has some genuinely surprising bits:
- Claude Code writes sessions to `~/.claude/projects/…/*.jsonl` — the transcript is already on disk, we just harvest it.
- The `beforeSubmitPrompt` hook in Cursor is deterministic memory capture without AI cooperation.
- Auto-writes marker-wrapped blocks into `CLAUDE.md` / `.cursorrules` / `.github/copilot-instructions.md`, so your manual rules survive.

Local-first, no telemetry, MIT, on npm today (v0.44.10).

If you want to try it, `npm i -g infernoflow && infernoflow init --yes` gets you running. Happy to demo on a call or send code samples.

Site: https://www.infernoflow.dev

Best,
Ron
```

---

## Template C — Cursor / Claude Code power-user forums moderators (if you can reach them privately)

**Subject line:**
```
Would this be a useful post for the community?
```

**Body:**
```
Hi,

I'm about to launch a tool that adds persistent memory to Cursor / Claude Code sessions via MCP + a `beforeSubmitPrompt` hook. Before I post to the community, wanted to ask if that's a topic your regulars find useful — or if there's a similar tool I've missed.

Quick summary:
- Local JSONL memory, git-tracked
- Auto-captures via MCP tools the AI calls itself
- Bookmark hook that catches "bookmark this" deterministically (backstop against AI non-compliance)
- Works with Copilot Chat too (via VS Code LMT — zero config — plus MCP)

Site: https://www.infernoflow.dev

Happy to skip if this isn't the kind of post that lands well. Just checking before spamming.

Thanks,
Ron
```

---

## Template D — Company that could be a good early adopter / logo

**Targets:** small dev-tooling companies whose engineers publicly use Cursor/Claude/Copilot. Look for CTO or eng lead who blogs about tooling.

**Subject line:**
```
Team memory across AI sessions — thought it might fit <Company>
```

**Body:**
```
Hi <Name>,

Saw <specific post — e.g., "your team's writeup on standardizing Cursor across the eng org">.

I built a tool that might fit the pattern you're setting up. It's an open-protocol (AMP) persistent-memory layer for AI coding sessions — local JSONL, git-tracked, so when one engineer's session discovers a gotcha or decision, the whole team inherits it on branch checkout.

Works with Cursor, Claude Code, and Copilot Chat (via VS Code Language Model Tools + MCP — both wired).

Not selling anything — it's open-source, MIT-licensed, npm-installable. Just wanted to put it on your radar because "shared memory that travels with the branch" seems to line up with what you're organizing around.

If you want to try it out with the team, happy to help with the setup or answer questions on <preferred contact>.

Site: https://www.infernoflow.dev

Best,
Ron
```

---

## Template E — Follow-up (only if you got a reply-but-no-action)

**Subject line:**
```
Re: infernoflow — one question and a small update
```

**Body:**
```
Hi <Name>,

No pressure at all — just following up because you asked <specific question> and I wanted to close the loop.

<Direct answer to their question.>

Also: v0.44.10 shipped session bookmarks — the feature you mentioned would be useful. If you want to see it in action, `infernoflow bookmark "test"` inside a Claude Code session will auto-harvest the transcript and stash it as a resume point.

Happy to demo or answer more questions when you have time. Otherwise no follow-up beyond this.

Best,
Ron
```

---

## Don'ts

- **Don't mass-send.** Personalized 5 emails > sprayed 500.
- **Don't ask for retweets.** Ask them to try the tool. If they like it, they'll share.
- **Don't attach the whole README.** Link. Let them decide to read.
- **Don't chase.** One follow-up max. Silence after that means "no."
- **Don't lie about traction.** If they ask "how many users," say the truth: "just launched, looking for real early adopters." Honesty is a moat.
