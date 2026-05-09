# Changelog — infernoflow VS Code extension

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
- **Activity-bar icon now uses `currentColor`** so it's visible in both light and dark themes (was hardcoded black, invisible on dark themes).

### Restored
These features existed in the prototype `docs/infernoflow-vscode/` (v0.2.1) but were dropped in the v0.7.0 memory-first rewrite. Restoring them in v0.7.2 brings the published version back to parity with the auto-capture UX users had asked about.

## 0.7.1 — 2026-05-05

### Fixed
- **Activation hung on "Activating…"** — `.vscodeignore` was excluding `node_modules/**`, so the published `.vsix` shipped without the `infernoflow-amp` runtime dependency. Sidebar never rendered. Now bundled correctly.
- **Sidebar could appear blank** if `getChildren()` threw silently. Wrapped in defensive try/catch so the panel always renders something — a guidance row, a workspace prompt, or a readable error — never a fully blank tree.

## 0.7.0 — 2026-05-05

### Added
- **AMP layout support** — extension now activates on `.ai-memory/sessions.jsonl` (AMP) in addition to the legacy `inferno/` layout.
- **Marketplace metadata** — `bugs`, `homepage`, `galleryBanner`, AI category, expanded keywords (ai-memory, amp, copilot, cursor, claude, windsurf).

### Changed
- Description leads with "Persistent memory for AI coding sessions" instead of contract-first framing — matches the rest of the project's repositioning.

### Internal
- First version published to the VS Code Marketplace. Prior versions (0.1.0–0.6.0) shipped only as .vsix artifacts in the repo.
