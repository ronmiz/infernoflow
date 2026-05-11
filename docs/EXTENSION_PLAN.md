# 🔥 Infernoflow VS Code Extension — Build Plan

> Locked plan for rewriting `vscode-extension/` from contracts-first to memory-first
> (matching INFERNOFLOW_EXTENSION_DESIGN.md and the AMP repositioning).
>
> Author: Ron + Claude · Locked: 2026-05-05 · Status: ready to execute Phase 1.

---

## Locked decisions

| # | Question | Decision |
|---|---|---|
| 1 | AMP I/O — install `infernoflow-amp` dep, or inline? | **Install** the npm package (it's our own publish, MIT, zero deps inside it). |
| 2 | CLI shell-out vs. native AMP read? | **Native reads** for everything memory-related. Only shell out for `switch` (writes handoff.md), contract operations, and other CLI-side complex flows. |
| 3 | Activation timing? | **`workspaceContains:.ai-memory/sessions.jsonl` + `workspaceContains:inferno/sessions.jsonl` + `workspaceContains:inferno/contract.json`**. Not `onStartupFinished` — keep VS Code light for non-infernoflow projects. |
| 4 | Smart range matching for diagnostics? | **MVP: line if entry.line set, else line 1**. Function-name and keyword fallbacks deferred to v0.4+. |
| 5 | Marketplace publisher? | **`infernoflow`** (matches npm + GitHub). Verify ownership at https://marketplace.visualstudio.com/manage/publishers before first `vsce publish`. |

---

## Phase 1 — MVP for Marketplace publish (target: `v0.3.0`, ~3-4 days)

Deliverables:

- `src/amp.ts` — single source of truth for memory I/O. Uses `import { AMP } from "infernoflow-amp"`. Exposes:
  - `getAmpInstance(workspaceRoot)` — caches per-workspace
  - `readEntries()`, `appendEntry(entry)`, `health()`, `searchEntries(query)`
  - File-watcher `onChange(fn)` over both `.ai-memory/sessions.jsonl` and `inferno/sessions.jsonl`
- `src/treeProvider.ts` — sidebar TreeView. Sections:
  - 📊 Session Health (score, duration, entries)
  - ⚠ Gotchas (count badge, click → open file at line)
  - ✓ Decisions (count badge)
  - ❌ Failed Attempts (count badge)
  - ⚡ Quick Actions (Log Gotcha, Log Decision, Generate Handoff, Ask, Recap)
- `src/statusBar.ts` — `🔥 B 65 · ⚠3 · ✓2 · ❌1 · 📋 Switch`. Colour by grade. Click on score → open sidebar. Click on Switch → run `infernoflow switch --copy`.
- `src/diagnostics.ts` — `vscode.languages.createDiagnosticCollection('infernoflow')`. For each open document, surface gotchas where `entry.file === relativePath`. Severity = Warning.
- `src/commands.ts` — registers:
  - `infernoflow.logGotcha`, `logDecision`, `logAttempt`, `logNote` (each opens `showInputBox`, captures current file/line, appends via AMP)
  - `infernoflow.ask` (input → result peek using `vscode.window.showQuickPick`)
  - `infernoflow.switch` (shells out to CLI, then auto-copies)
  - `infernoflow.recap` (opens a temp Markdown editor with the recap output)
  - `infernoflow.openPanel`, `infernoflow.refresh`
- `src/extension.ts` — wires it all up, registers the file watcher.
- `package.json` — replace contracts-era `views` (Capabilities/Scenarios/Changelog) with memory views (Session Memory). Replace contracts commands with the memory ones above. Activation events per decision #3.

Marketplace prep:

- `vscode-extension/README.md` — keep current text but update screenshots to the new sidebar/diagnostics
- `vscode-extension/CHANGELOG.md` — add `v0.7.0` (already done) → bump to `v0.3.0` for Marketplace publish, OR push v0.7.0 directly
- 5 screenshots: status bar / sidebar tree / editor diagnostic / command palette / Switch output
- `vscode-extension/PUBLISH.md` — walkthrough already exists

`vsce publish` from `vscode-extension/`. Done.

---

## Phase 2 — polish (`v0.4.x`–`v0.6.x`, ~3-4 days)

| Version | Surface | Notes |
|---|---|---|
| v0.4 | **Gutter icons** | SVG: orange triangle (gotcha), green check (decision), red X (attempt). Light + dark variants. Hover shows tooltip with entry msg + age + actions. |
| v0.5 | **CodeLens** | Above each function declaration with logged entries: `🔥 2 gotchas · 1 decision — Click to view ▪ Log new`. Use `vscode.DocumentSymbolProvider` (lighter than regex). |
| v0.6 | **Auto-capture** | Mirror CLI watch heuristics: 5+ saves to same file in 10min → "Log a gotcha?", git-index change → "File reverted — log what you tried?", session-end (deactivate) → quick "anything to note?" prompt. All opt-out via `infernoflow.autoCapture.*` settings. |

---

## Phase 3 — the headliner (`v0.7.0`, ~2 days)

**Copilot Chat Participant API.** `@infernoflow add retry logic to upload` auto-prepends:

```
## ⚠️ Gotchas (don't repeat)
- API expects form-data not JSON (src/api.js)
…

## ❌ Failed attempts
…

## ✓ Decisions in effect
…

User's request: <original prompt>
```

Token budget management — default: last 10 gotchas + all decisions + last 5 attempts. Configurable via `infernoflow.chat.budget` setting.

Test against both Copilot Chat and Cursor's chat (which speaks the same API).

---

## Phase 4 — defer

- Bottom panel webview (timeline) — sidebar already does it; webview is heavier
- Cloud sync UI / "Pro" chrome — premature pre-launch
- Cross-project search — Pro-tier feature, no users yet
- Right-click context menu on editor — actually small enough to fold into Phase 1 if time permits

---

## Build sequence (linear, 1 commit per file usually)

1. `vscode-extension/package.json` — install `infernoflow-amp`, update activation events, replace views/commands.
2. `vscode-extension/src/amp.ts` — wrapper around `infernoflow-amp` lib + file watcher.
3. `vscode-extension/src/treeProvider.ts` — memory-focused tree.
4. `vscode-extension/src/statusBar.ts` — health-score chrome.
5. `vscode-extension/src/diagnostics.ts` — gotchas-as-warnings.
6. `vscode-extension/src/commands.ts` — log/ask/switch/recap registrations.
7. `vscode-extension/src/extension.ts` — wire up; activate/deactivate.
8. `vscode-extension/README.md` — update for memory framing.
9. `npm run compile` from `vscode-extension/`. Fix TS errors. `vsce package` to verify .vsix builds.
10. Manual smoke: open a real project with `.ai-memory/sessions.jsonl`, verify sidebar renders, status bar updates, log a gotcha via command palette, see it appear in tree + status bar + diagnostics.
11. `vsce publish` (after publisher verification + PAT setup per `PUBLISH.md`).

---

## Open follow-ups (do NOT do in MVP)

- **Smart range matching beyond line-or-1.** Function-name + keyword fallback deferred to v0.4+. Requires testing against TypeScript / JavaScript / Python / Go to be useful.
- **Webview bottom panel.** Sidebar is sufficient for v1.0. Add only if user feedback requests timeline view.
- **Pro tier** anything. Solo + pre-launch — don't paywall before there's a community.
- **Multi-workspace support.** Current code assumes one workspace folder. Multi-root is a v1.x problem.
- **i18n.** English only for now.

---

*Saved 2026-05-05 by Claude. Pick up at "Build sequence" step 1 when ready.*
