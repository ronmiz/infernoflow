# Changelog — infernoflow VS Code extension

## 0.7.11 — 2026-05-26 — auto-capture reliability + Node-free sidebar

Pairs with CLI 0.44.3. Focus: the extension is useful the moment it's installed,
and the AI auto-capture path is reliable rather than silently broken.

### Fixed
- **No more npm dead-end when Node.js is missing.** The CLI install and the MCP server both need Node, but the old flow offered `npm install -g infernoflow` unconditionally and dead-ended on `spawn npm ENOENT` — telling the user to run the exact command that just failed. Now it detects Node first; if missing, it shows an upfront message ("auto-capture needs Node.js; the sidebar works without it") with an **Install Node.js** button.
- **The AI now learns the capture protocol even without the CLI.** The Memory-protocol block (which tells the AI when to call `amp_write`) was written only by the CLI, so an extension-only install left the AI with no capture instructions. The extension now writes it natively once on activation (idempotent, shared markers — no duplicate block, no per-edit churn).
- **`switch` and `recap` work with no CLI / no system Node.** They shelled out to the CLI before; they now run in-process via the bundled `infernoflow-amp`, so the sidebar degrades gracefully.

### New
- **Restart reminder after wiring.** Once MCP is registered, a one-time toast tells you to restart your AI tool so it loads the memory server — the most common silent cause of "installed it, the AI does nothing."

## 0.7.10 — 2026-05-25 — drop sidebar/palette entries for CLI commands deleted in v0.44

The CLI v0.44 surface cull deleted `scan`, `watch`, `freeze`, `impact`, `graph`, and the whole `contract` subsystem. The extension still registered four palette commands and a sidebar "Code Map" section that invoked them — clicking any of these in v0.7.9 against CLI v0.44+ produced "Unknown command" errors in the terminal.

### Removed
- **Palette commands:** `infernoflow.cliScan` (Scan codebase), `infernoflow.cliWatch` (Watch auto-capture), `infernoflow.cliCodeMap` (Show code map), `infernoflow.cliCloudStatus` (orphan — was declared in package.json contributes but never registered).
- **Sidebar section:** the "Code Map" parent and its two action nodes ("Scan codebase", "Show code map"). The whole section is gone — visual code-map was a feature of the contract/scan track that v0.44 removed.

### Pairs with CLI 0.44.2
Everything in the extension's command palette and sidebar now routes to a CLI verb that actually exists in v0.44.2.

### Migration
No action — install the new version. If you specifically used the "Code Map" or "Scan codebase" actions, those features are gone with the CLI cull. Use `infernoflow doctor` for setup diagnostics instead.

## 0.7.9 — 2026-05-19 — pairs with CLI 0.44.0 (branch-aware memory + single-writer rule files)

This release closes the boundary issue between the extension and the CLI flagged in the v0.44 audit — the two were racing each other on rule-file writes and the extension was blind to v0.44's branch-aware layout. Both halves fixed here.

### Fixed — extension now sees writes that land outside `sessions.jsonl`

The CLI 0.44.0 introduced branch-aware memory: new entries route into `.ai-memory/branches/<branch>.jsonl` (git-tracked, travels with the branch) and `.ai-memory/global.jsonl` (personal). The extension's file watcher only listened to `{.ai-memory,inferno}/sessions.jsonl` — so anything written under the new layout was invisible to the sidebar, status bar, diagnostics, and CodeLens.

Pattern widened to `{.ai-memory,inferno}/**/*.jsonl`. Every branch + global write now fires the watcher.

### Fixed — the duplicate rule-file writer race

The extension's `rebuildAiRuleFiles` and the CLI's `refreshRuleFilesFromMemory` were both rewriting `CLAUDE.md` / `.cursorrules` / `.github/copilot-instructions.md` with the same `<!-- infernoflow:start -->` markers, on different cadences. In a project where both were running, they overwrote each other every ~1.5 s.

The extension's per-edit auto-refresh is removed. Rule files now refresh exclusively from the CLI: once at MCP server boot, plus on explicit `infernoflow refresh` invocations. The user-triggered `infernoflow.rebuildAiRules` command stays — clicking it explicitly is fine, racing the CLI on every keystroke was not.

### Pairs with CLI 0.44.0
This release expects the CLI to be on 0.44.0 or later. The CLI's mirror-write policy (every entry also lands in `sessions.jsonl` for live-watcher compatibility) means **prior extension releases keep working with CLI 0.44** — but you'll only see entries in the legacy file. Upgrade to 0.7.9 to see the full branch + global picture.

### Migration
- No action required. Just upgrade.
- If you were depending on the old per-edit rule-file refresh (e.g. you'd open a file and expect `.cursorrules` to re-rank within 1.5 s), use the explicit `infernoflow.rebuildAiRules` command instead — it's the same code path, just user-driven.

## 0.7.8 — 2026-05-13 — auto-capture popup off by default

### Changed
- **`infernoflow.autoCapture.repeatedEdits` now defaults to `false`.** The 5-edits-in-10-min popup was originally meant to catch "stuck on something?" moments, but in practice fired on low-signal noise — the reviewer's example was a tiny `<div>loading…</div>` getting edited 5 times in a row, surfacing as a captured gotcha. The Memory protocol skill block (shipped 0.7.5) now does this job from the AI side: the AI itself decides what's worth logging. If you specifically want the popup back, flip the setting in `infernoflow.autoCapture.repeatedEdits`.

## 0.7.7 — 2026-05-13 — one install, everything works

### Fixed — installing the extension is now enough
Before: install extension → AI agent reads the Memory protocol skill block, tries to call `amp_write`, no tool registered, nothing logged. User had to separately run `npm install -g infernoflow` and `infernoflow setup`. Two more steps no one knew about.

Now: on first activation in a workspace the extension:
1. Probes for the `infernoflow` CLI (runs `infernoflow --version`).
2. If missing, asks once: "Install infernoflow CLI now?" — runs `npm install -g infernoflow@latest` with a progress toast.
3. Runs `infernoflow setup --yes` in the workspace so MCP servers are registered for **all four** AI tools (Cursor / VS Code Copilot Chat / Claude Code / generic AMP) in one shot.
4. Tracks completion per-workspace in `globalState` so the prompt never fires twice. Re-runs setup silently if a required artifact (`.ai-memory/`, `.cursor/mcp.json`, `.vscode/mcp.json`) is missing.

Never blocks activation — runs entirely in the background. Never throws — if `npm install` fails (e.g. permissions), the extension still works; only MCP wiring is missing.

### Pairs with CLI 0.43.9
CLI's `setup` now writes `.vscode/mcp.json` (VS Code Copilot Chat) in addition to `~/.claude.json` (Claude Code) and `.cursor/mcp.json` (Cursor). Previously Copilot users had no `amp_write` tool to call.

## 0.7.6 — 2026-05-13 — pairs with CLI 0.43.8

### Improved
- **Companion to CLI branch-switch fix.** CLI 0.43.8 now writes `.ai-memory/`, `.cursorrules`, `CLAUDE.md`, and `.github/copilot-instructions.md` into the project's `.gitignore` on `infernoflow init`. The extension does no extension-side work here — but bumping the version keeps the two in lockstep so users on `npm install -g infernoflow@latest` get a Marketplace extension that matches.
- Same feature set as 0.7.5: Memory protocol skill auto-sync block, sidebar cull (6 sections), Code Map.

## 0.7.5 — 2026-05-11 — focus pivot (sidebar cull)

### Removed
- **AI Context for [file]** section — CodeLens already shows the same data inline at file:line, where you actually need it. Sidebar duplication was visual noise.
- **CLI Tools** section (11 items) — all the one-time-setup buttons (Init, Setup MCP, AI setup, Install hooks, etc.) move to the command palette only. Sidebar = daily-use actions only.
- **Cloud status** action — cloud sync removed entirely from infernoflow (see CLI v0.43.6 notes)
- **"Rebuild AI rule files now"** button — auto-sync already runs the rebuild on every memory change; the button was theater.
- Reduced Quick Actions from 9 → 6 (folded "Cleanup orphaned" into "Manage entries", moved "Show Recap" and "Summarize session with AI" to command palette only)

### Added
- **Code Map** section (collapsed by default) with two actions: "Scan codebase" and "Show code map" — the visual companion to memory, opens the interactive flow chart in your browser

### Sidebar now has 6 focused sections (was 7 noisy ones)
1. Session Health · grade + entry counts
2. Gotchas · click any → jump to file:line
3. Decisions
4. Failed Attempts
5. Memory Actions (6 items: Log Gotcha, Log Decision, Log Failed Attempt, Generate Handoff, Ask Memory, Manage entries)
6. Code Map (collapsed: Scan + Show map)

### Click-to-jump behavior preserved
Click any gotcha/decision/attempt → editor opens at its file:line. Unchanged. Locked UX.


### Added — Memory protocol skill (auto-sync injects it)
Auto-synced rule files (`.cursorrules` / `CLAUDE.md` / `copilot-instructions.md`) now include a "Memory protocol" block at the top instructing the reading AI to proactively call the `amp_write` MCP tool on:
- User frustration markers (`!!!`, `not working`, `still broken`)
- Plan / numbered-steps generation
- Decision moments
- Non-obvious discoveries
- Branch or context switches (session snapshot)

This replaces the 5-edits-in-10-min auto-capture popup (deprecated for noise). The AI itself becomes the capture intelligence. Cross-tool by design — works wherever AMP/MCP is wired up.

## 0.7.4 — 2026-05-09

### Added
- **New icon set** — swapped the activity-bar SVG and Marketplace PNG to a cleaner dual-path flame (outlined outer + solid inner core). Theme-adaptive via `currentColor`. Visible in both light and dark themes.

### Notes
- Same feature set as 0.7.3 (which was built but never uploaded to Marketplace). 0.7.4 ships everything 0.7.3 had — AI Context section, auto-sync rule files, recent git commits in injection, AI session summarize, agent conversation harvest with success/failure keywords, bulk delete + orphan cleanup, CodeLens, 11 CLI passthroughs — plus the new icon.

## 0.7.3 — 2026-05-06

### Added — closing the injection loop
- **"AI Context for [current file]" section** in the sidebar — shows the top 5 most-relevant gotchas/decisions/attempts for whatever file you're currently editing, ranked by:
  - Same file (+100)
  - Same directory (+40)
  - Same file extension (+10)
  - Logged in last 7 days (+20 bonus)
  - Type-weighted (gotcha 1.5×, attempt 1.2×, decision 1.0×, note 0.6×)
  Updates automatically every time you switch editors. Visible proof of what the AI will see for this file.
- **"🔄 Rebuild AI rule files now" action** in that section. Rewrites `.cursorrules`, `CLAUDE.md`, and `.github/copilot-instructions.md` with the same ranking applied — top 5 entries in full, the rest collapsed under a `<details>` block. AI tools read these files as system context at session start, so the next AI conversation sees the right gotchas first instead of getting buried in noise.
- **Idempotent rule-file injection** — uses `<!-- infernoflow:start -->` / `<!-- infernoflow:end -->` markers so re-running is safe; doesn't duplicate, doesn't trample your manual edits outside the markers.
- **Same command in palette** — `Ctrl+Shift+P → infernoflow: Rebuild AI rule files`.

### Why this matters
Before this release, capturing memory was strong but injecting it into the AI's context relied on dumping everything into rule files in chronological order. After 50+ entries, AI tools start ignoring or glossing the rules. Now the most relevant entries for the file you're working in are at the top — same context budget, much higher signal.

### Added — auto-sync
- **`infernoflow.autoSyncRules` (default true)**. When enabled, the extension automatically rebuilds `.cursorrules` / `CLAUDE.md` / `.github/copilot-instructions.md` whenever memory changes (new gotcha, deleted entry, CLI write) OR when you switch active editors. Debounced to 1.5s so rapid edits don't thrash the disk. Idempotent — only writes if content actually changed.
- **What this fixes:** when a developer opens a NEW AI chat in the SAME VS Code session, the AI tool reads the rule files at chat start. Before this, the files reflected only the last manual "Rebuild" click — any gotchas logged since were missing. Now, every new chat gets the current memory ranked for the file in focus, no manual step required.
- Disable via Settings → search `infernoflow.autoSyncRules` → uncheck. Manual rebuild still available via the sidebar action or command palette.

### Added — recent git commits in AI context
- **`.cursorrules` / `CLAUDE.md` / `copilot-instructions.md` now include the last 10 git commits** at the top of the infernoflow-managed section. Format: `\`<hash>\` _<date>_ <subject>` plus the changed files (capped at 5 files for the 5 most recent commits to keep cost bounded).
- **Why:** when you open a new AI chat, the agent now sees "what was just done" alongside "what to avoid." Example — you commit `fix: handle empty arrays in parser` 30 min ago, open Claude, ask "help me debug parser." Claude already knows that commit happened. No more wasted re-discovery.
- Failsafe: if the workspace isn't a git repo or git isn't on PATH, the commits section is silently skipped — no error, no noise.

### Added — agent conversation captures successes too
- **Resolution-keyword harvesting**. The auto-capture popup's draft-tail scan now matches success/breakthrough phrases (`got it`, `fixed`, `working now`, `the issue was`, `the trick is`, `turns out`, `ah, of course`, `the fix was`, etc.) in addition to failure keywords. So future-you sees both the breakdown AND the breakthrough — the gotcha tells the full arc, not just where things went wrong. Toggle: `infernoflow.captureSuccessSignals` (default true).

### Added — AI-summarized session sweep
- **"Summarize session with AI" action** in Quick Actions (also `Ctrl+Shift+P → infernoflow: Summarize session`). Reads `CONTEXT.draft.md`, asks an AI provider to extract 1–6 structured memory entries (gotchas / decisions / attempts / notes), shows them in a multi-select picker pre-checked to "keep all," lets you uncheck the ones you don't want, saves the rest. Captures conceptual learnings the keyword-based harvest misses — architectural decisions, "we agreed to do X because Y," etc.
- **Provider: VS Code LM API first** (zero config — uses your Copilot subscription if signed in), falls back to the CLI's configured AI provider (`infernoflow ai setup`). If neither is available, points the user at `infernoflow ai setup`.
- **Privacy note**: this sends the recent agent transcript to whichever provider is active. Disable by not invoking the command — there's no auto-trigger.

### Added
- **Auto-capture now harvests the AI agent conversation**. When the popup fires and you click "Log Gotcha" / "Log Attempt", the auto-message now includes recent failure-signal lines from `.ai-memory/CONTEXT.draft.md` (or legacy `inferno/CONTEXT.draft.md`) — the file that the Cursor/Copilot hooks write after every agent exchange. So when you and the AI have been going back and forth on the same problem without success, the actual transcript of that struggle gets captured into the gotcha. No more "Stuck on X — 5 edits" with no idea WHY you were stuck. You see the actual error messages the AI was hitting.
- **Failure-keyword detection** — looks for lines containing `error`, `Error:`, `fail`, `doesn't work`, `still`, `again`, `TypeError`, `cannot`, `broke`, etc. Pulls the last 5 such lines from the recent (≤30-min-old) draft.
- **Pre-requisite for this feature**: install hooks first via `infernoflow install-cursor-hooks` or `infernoflow install-vscode-copilot-hooks`. If hooks aren't installed, this layer just adds nothing — no harm, no error.

## 0.7.2 — 2026-05-05

### Added
- **AutoCapture** — when you edit the same file 5 times in 10 minutes, a popup appears: "🔥 You've edited X 5 times in 10 minutes. Stuck on something?" with [Log Gotcha] [Log Attempt] [Dismiss] buttons. Configurable via `infernoflow.autoCapture.repeatedEdits` (default true) and `infernoflow.autoCapture.repeatedEditsThreshold` (default 5). 60-second cooldown per file prevents popup spam.
- **CodeLens** — inline annotations above files with logged entries: `$(flame) 2 gotchas · 1 failed · 1 decision`. Per-line CodeLens at gotcha/attempt locations show truncated message + clickable to view full entry detail (Open file / Copy message). Configurable via `infernoflow.showCodeLens` (default true).
- **Master enable/disable switch** — `infernoflow.enabled` (default true) — turn the whole extension off without uninstalling.
- **Failed attempts now show in Problems panel** — as Information diagnostics (blue squiggle), distinct from gotchas (yellow Warning). More context, no extra noise.
- **`infernoflow.showEntry` command** — invoked by per-line CodeLens; opens a quick-pick with [Open file] [Copy message] [Dismiss] for the entry.
- **11 new CLI passthrough commands** — Status, Check, Doctor, Scan, Init (adopt), Setup MCP, AI setup, Install Cursor hooks, Watch, Cloud status, Show context. Each runs in a single reusable "infernoflow" terminal so output streams live and you keep scrollback across runs. Available from `Ctrl+Shift+P → infernoflow:` and from the new "CLI Tools" section in the sidebar (collapsed by default).
- **Delete an entry** — right-click any gotcha/decision/attempt/note in the sidebar → "Delete this entry". Or click an entry, then pick "Delete this entry" in the quick-pick. Confirms first; rewrites the JSONL minus the entry.
- **Bulk manage entries** — new "Manage entries…" action in Quick Actions (and command palette) opens a multi-select picker grouped by date (Today / Yesterday / Last 7 days / Older). Tick anything you want gone, hit Enter, confirm — all deleted in one shot. Type to filter by message/file. Designed for projects with 10+ entries where one-at-a-time deletion is painful.
- **Orphaned entry detection** — entries whose file no longer exists on disk (e.g., after a refactor that deleted source files) are auto-detected and shown with a `(deleted)` marker, a `circle-slash` icon, and a tooltip explaining what happened. Clicking an orphaned entry shows a soft prompt offering [Delete entry] or [Keep for history] — never silently errors with "file not found".
- **Cleanup orphaned entries** — new action that opens a bulk picker pre-filtered to only orphaned entries. After a big refactor, run this once to clean up stale references in your memory.
- **Help tooltips** on every sidebar item — hover any action or section header and a tooltip explains what it does, when to use it, what happens when clicked, and the keyboard shortcut (if any).
- **Auto-capture writes meaningful content** — instead of asking you to type, the popup auto-logs an entry with: timestamp prefix `[YYYY-MM-DD HH:MM]`, file:line + enclosing function, 5-line code context window with cursor marker, full diagnostic messages from the Problems panel. Click "Log Gotcha" once → entry is written, no typing.
- **Activity-bar icon now uses `currentColor`** so
