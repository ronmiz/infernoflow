# Reddit — r/GithubCopilot

**Best time:** Tuesday or Thursday, 10 AM ET
**Angle** — Copilot Chat has no built-in persistent memory. infernoflow registers memory tools via VS Code LMT (zero per-project config) and also ships an MCP server — Copilot supports MCP since VS Code 1.102.

## Title

```
Copilot Chat now has persistent memory — I registered amp_write/amp_read as VS Code Language Model Tools so Copilot calls them itself
```

## Body

TL;DR — Copilot Chat supports MCP (since VS Code 1.102), but VS Code's Language Model Tools API needs zero per-project setup. I shipped an extension that registers memory-management tools through that API, and Copilot picks them up as native tools it can invoke mid-conversation. No config, no manual copy-paste, no separate chat window.

**Why this matters:**

Most AI memory tools target Cursor / Claude Code first. Copilot Chat gained MCP support in VS Code 1.102 (GA July 2025), but wiring an MCP server per project is friction most Copilot users never bother with. So if you use Copilot at work (which most of us do, because it's the one your org actually paid for), you've been stuck with static `copilot-instructions.md` and manual notes.

VS Code's Language Model Tools API (`vscode.lm.registerTool`) is the supported path for extending Copilot's capabilities. I registered two tools:

- **`amp_write`** — Copilot calls it when you (or Copilot itself) discovers a gotcha, decision, or dead end
- **`amp_read`** — Copilot calls it before making changes to a file, to check what past sessions logged about the same area

The tools appear in Copilot Chat's tool selector automatically once you install the extension. They read/write to `.ai-memory/` in your project — plain JSONL, git-trackable, cross-teammate.

**Concrete example from my kanban repo:**

Last week I asked Copilot to add a Prisma migration. Instead of just running `prisma migrate dev`, Copilot first called `amp_read({ path: 'prisma/schema.prisma' })` on its own. It got back a gotcha I'd logged three weeks earlier: *"Prisma 6 holds a DLL on query_engine.dll while tsx watch is running — kill the watcher before migrate or it fails with EBUSY."* Copilot's response: "I noticed a logged gotcha about Prisma 6 DLL locking. Do you want me to stop the tsx watcher first?"

That's the whole product in one interaction.

**Also captures the gotchas going forward:** if I hit the same DLL error and typed "same error", Copilot would call `amp_write({ type: 'attempt', msg: 'Prisma DLL lock again — killed watcher didn't help' })`. Now the next session has three data points on the same problem.

**Local-first:**

- Extension has no telemetry, no network calls
- Memory is git-tracked so teammates inherit it on branch checkout
- Secret patterns rejected at write time
- Base CLI (`infernoflow`) is on npm, MIT-licensed, open protocol (AMP)

Marketplace: search "infernoflow" in VS Code Extensions view
Site: https://www.infernoflow.dev
Repo: `ronmiz/infernoflow`

Setup:
```bash
# 1. Install VS Code extension "infernoflow" (marketplace)
# 2. In terminal:
npm install -g infernoflow
cd your-project
infernoflow init --yes
```

The `init` writes `.github/copilot-instructions.md` with a marker-wrapped block that teaches Copilot when to call which tool. Your existing rules outside the block are untouched.

Feedback / edge cases welcome — especially interested in how this feels for people using Copilot at work with sensitive repos.

---

## Reply templates

**"Does Copilot actually invoke the tools reliably?"**
> More reliably than I expected, honestly. `vscode.lm.registerTool` is the same API GitHub uses for its own workspace tools, so Copilot treats infernoflow tools with the same routing. The `.github/copilot-instructions.md` block that `init` generates gives Copilot explicit triggers ("if user says 'not working' → call `amp_write`") — that pushes reliability up further. Not 100%, but high enough to be useful.

**"Won't this leak sensitive code into the memory file?"**
> The memory file (`.ai-memory/**`) contains only what Copilot chose to log — which is the *lessons* (gotchas, decisions), not code. Secret-pattern regex rejects `sk-*`, `ghp_*`, `-----BEGIN` at write time. And it's git-tracked, so nothing gets committed you haven't reviewed. If you want a repo-local exclusion, add `.ai-memory/` to `.gitignore` — everything still works, but nothing gets shared.

**"Does this work in Copilot workspace vs. Copilot Chat?"**
> Both. LMT-registered tools are available to any tool-capable Copilot surface. Codespaces too.

**"What's the difference from GitHub's own workspace memory feature?"**
> GitHub's memory (Enterprise Cloud feature) is server-side, org-managed, opaque. infernoflow is on-disk, per-project, version-controlled, and you can read/edit the files with a text editor. Different use case — some teams will want both. AMP is designed to be layerable with anything.

**"How's this different from just adding memory to `copilot-instructions.md` manually?"**
> Static instructions are one-way — you write, Copilot reads. infernoflow captures Copilot's own discoveries mid-session. Your codebase's tribal knowledge grows automatically. `copilot-instructions.md` is the *output surface* (infernoflow writes a marker-wrapped memory block into it); your manual rules outside the block survive.
