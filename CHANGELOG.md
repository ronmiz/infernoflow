# Changelog — infernoflow

## 0.43.12 — 2026-05-13 — extension is now optional

### Changed — `infernoflow log` keeps rule files fresh by itself
Up to now, when you ran `infernoflow log "..."` from CLI, the entry landed in `.ai-memory/sessions.jsonl` but the AI's rule files (`.cursorrules`, `CLAUDE.md`, `.github/copilot-instructions.md`) stayed **frozen** at whatever was written at init time. Refreshing them required the VS Code extension's auto-sync watcher. CLI-only users (Cursor / Claude Code / Copilot without our extension) had a memory store the AI never saw new entries from.

`log` now calls `refreshRuleFilesFromMemory(cwd)` after every successful entry. The rule files always reflect the latest memory + last 10 git commits. Non-fatal if the refresh errors (e.g. read-only FS).

**Impact:** the VS Code extension is now **optional UX polish**, not a hard dependency for the core memory-to-AI flow. Cursor users, Claude Code-in-terminal users, anyone using any MCP-aware AI tool — they all get fresh rule files just by running `infernoflow log`.

### Changed — upgrade-check now writes memory-aware rule files
The 0.43.11 silent upgrade backfill called `writeInitRuleFiles` which produced an empty stub. On upgrade in a project that already had 30 logged entries, the rule file showed "no entries yet" — wrong. Now uses `refreshRuleFilesFromMemory` so the post-upgrade rule file accurately reflects existing memory.

### What "memory-aware" includes (CLI side)
- Memory protocol skill block (same as before)
- Recent commits — last 10, from `git log`
- Recent entries — last 10 by timestamp, newest first
- Memory entries grouped by type (gotcha / decision / attempt / note) with icons + file refs

The CLI does NOT do per-file relevance ranking (it has no editor state to know what file you're looking at). That's still the extension's job. CLI gives you "what's been happening lately"; extension gives you "what's relevant to the file you're editing right now."

## 0.43.11 — 2026-05-13 — upgrades are transparent now

### Fixed — upgrading the CLI no longer leaves your setup half-wired
**The bug** (caught in dogfood, 30 minutes after 0.43.10 shipped): a user on 0.43.4 ran `infernoflow init`. Then they upgraded to 0.43.10 via `npm install -g infernoflow@next`. The new init has auto-MCP-setup baked in — but their existing project never re-ran init, so MCP was silently NOT wired up. They had to discover and run `infernoflow setup --yes` as a separate manual step. "One install = everything works" broke on every upgrade.

**The fix:** new `lib/upgradeCheck.mjs` runs at the top of every CLI invocation. It reads `.ai-memory/.last-cli-version` (or `inferno/.last-cli-version` for legacy projects) and compares to the running version. If they differ, it silently re-runs the bits of init that need to be fresh:

- `writeInitRuleFiles` — refreshes `.cursorrules`, `CLAUDE.md`, `.github/copilot-instructions.md` with the latest Memory protocol skill block.
- `ensureGitignoreEntries` — re-adds the developer-local memory block if missing.
- `autoSetupMcp` — copies the MCP server, registers it in `~/.claude.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, and `.claude/settings.json`.

Then writes the current version to the marker file so it never re-runs for the same version twice.

**Visibility:** if anything was actually written (first upgrade in this project, or new MCP files needed), one line goes to stderr: `infernoflow: upgraded X → Y, wired MCP servers + rule files`. Otherwise silent.

**Safety:** the entire check is wrapped in try/catch at the call site. Failures are completely invisible — the user's command always runs. Skip-list covers `--help`, `--version`, `init`, `setup`, `doctor`, `uninstall` (commands that don't need it or do their own setup).

### Fixed — false "update skipped" warning on `setup`
Cosmetic but trust-eroding: `infernoflow setup --yes` was printing `[!] .vscode/mcp.json update skipped: gray is not defined` even though the file was correctly written. The `gray` helper wasn't in `setup.mjs`'s import list — the write succeeded but the success-log line crashed and got caught by the surrounding try/catch as if the write had failed. Added `gray` to the import. File now writes silently with no false warning.

## 0.43.10 — 2026-05-13 — trust pass on dogfood feedback

### Fixed — bugs caught by an outside agent reviewing the product
The agent dogfooding 0.43.9 flagged seven friction points. The four "trust-eroding" ones are fixed here:

- **`init --help` now actually shows help.** Used to run interactive init with the flag ignored. Agents piping `init --help | head` got an interactive prompt; humans typing it lost faith. Added a real help printer and a short-circuit at the top of `initCommand`.
- **`contract sync --auto` now detects CONTEXT.md drift.** Previously only checked git-diff impact via `pr-impact`; said "no drift detected" while CONTEXT.md still claimed an obsolete policyId / version. New `detectContextMdDrift` compares H1, version token, and capability ids in CONTEXT.md against contract.json. Surfaces in JSON output as `contextDrift` and reason code `CONTEXT_MD_STALE`.
- **`status` no longer nags about contracts when contracts already exist.** The "Want capability contracts + CI gates? Run: infernoflow init --mode full" hint always printed in memory-mode, even after the user had set up the full mode (because amp.json + contract.json can coexist). Now gated on `!fs.existsSync(inferno/contract.json)`.
- **Capability scanner no longer mistakes our own scaffolding for user code.** `.cursor/hooks/inferno-session-draft.mjs` was being attributed to user-domain capabilities like ReadTasks. Added `.cursor`, `.vscode`, `.claude`, `.ai-memory`, `inferno`, `legacy` to `SKIP_DIRS` and an `inferno-*.mjs` filename filter.

### Added — `doctor` detects stale npm scripts from old releases
`infernoflow doctor` now audits `package.json` scripts for references to commands that no longer exist on the current surface (post-0.43 cull). Surfaces them with the script name + bad verb so the user knows what to delete. Doesn't auto-fix — your CI may depend on those references and we don't trust ourselves to rewrite them.

### Changed — `.gitignore` opinion is now transparent
On `init`, the .gitignore-block log line used to say only "Updated .gitignore". It now prints the exact list of patterns added and tells the user how to undo (delete the `# --- infernoflow ---` block). Reviewers flagged that silently adding `CLAUDE.md` to a developer's gitignore is a strong philosophical claim some teams will disagree with — make the claim visible.

## 0.43.9 — 2026-05-13 — `init` is enough

### Fixed — Memory protocol skill now actually works after `init`
Before this release, `infernoflow init` only created `.ai-memory/`. The Memory protocol skill block — which tells the AI "call `amp_write` when you see frustration / decisions / etc." — was injected by the **VS Code extension** on auto-sync. CLI-only users got `.ai-memory/`, no rule files, no MCP server, no `amp_write` tool. The AI had nothing to call. **Nothing got logged.**

`init` now does what `setup` used to do — automatically. Specifically:

- **Writes rule files directly** — `.cursorrules`, `CLAUDE.md`, and `.github/copilot-instructions.md` get the Memory protocol skill block on the very first `init`, no extension required. New shared module `lib/ruleFiles.mjs` is the single source of truth; the extension will refresh these files with ranked memory using the same delimiter markers (`<!-- infernoflow:start --> ... <!-- infernoflow:end -->`).
- **Auto-runs MCP setup** — copies `.cursor/inferno-mcp-server.mjs`, registers it in `~/.claude.json`, and writes `.claude/settings.json` with pre-approved tool names. So when the AI reads the protocol block and tries to call `amp_write`, the tool is actually there.

Both pieces are idempotent and non-fatal — `init` finishes successfully even if `~/.claude.json` is locked.

### Backfill on re-run
Re-running `infernoflow init` on a project that was set up with an older version backfills the rule files, gitignore block, and MCP server registration. No flag needed.

## 0.43.8 — 2026-05-13 — branch-switch fix

### Added — memory is developer-local, not branch-attached
`infernoflow init` now writes a managed block into your project's `.gitignore`:

```
# --- infernoflow (developer-local AI memory; do not commit) ---
.ai-memory/
.cursorrules
CLAUDE.md
.github/copilot-instructions.md
# --- /infernoflow ---
```

**Why:** before this, checking out another branch swapped in *that* branch's memory (or wiped it entirely). The AI would suddenly read stale gotchas from a feature you abandoned three branches ago. Memory belongs to *you*, not to a branch — same model as `.env.local`.

**Idempotent:** re-running `infernoflow init` on an existing project backfills the block without duplicating anything. Safe to run on projects that already had the patterns added manually.

## 0.43.6 — 2026-05-11 — focus pivot ("ONE thing")

### Strategic decision
infernoflow now does ONE thing: **persistent project memory that any AI tool can read.** Cloud sync, dashboard, pricing tiers, and vestigial init prompts have been moved out of the way (preserved in `legacy/`) so users see a focused, coherent product.

### Removed (preserved in `legacy/`)
- `cloud` command + sub-verbs — anonymous-key auth was alpha-quality
- `login` / `logout` / `whoami` — cloud-only, no purpose without sync
- `dashboard` (local web UI on :7337) — duplicated the VS Code sidebar
- Silent cloud-push from `infernoflow log` — memory is fully local now
- The capability comma-prompt in `init --adopt` — friction users can't answer at init time. Inferred capabilities auto-accept now; refine `inferno/capabilities.json` later

### Effect
- Help output shorter — no more cloud/dashboard groups
- ~46 visible commands (was 51)
- 100% local-first — zero network calls in default command paths
- Tag `v0.43.5-pre-cleanup` preserves the last pre-pivot state
- `legacy/commands/` + `legacy/cloud/` contain full source for revival


### Added — Memory protocol skill (auto-capture via AI, not regex)
Rule-file injection (`.cursorrules` / `CLAUDE.md` / `copilot-instructions.md`) now includes a "Memory protocol — capture as you go" block. Instructs the reading AI to proactively call `amp_write` MCP tool when it detects:
- User frustration (`!!!`, `not working`, `still broken`)
- Plan/numbered-steps generation
- Decisions ("use X over Y because Y")
- Non-obvious gotchas discovered mid-session
- Branch / context switches → session snapshot

Replaces the noisy 5-edits-in-10-min auto-capture trigger with AI-judged capture. Works across any AMP-compatible tool (Cursor, Claude Code, Copilot, Windsurf) — no extension code changes needed per tool.

### Added — `infernoflow contract graph --html` flow-chart redesign
Replaced D3 force-directed "floating circles" with hierarchical Mermaid layout. Entry component → child components → capabilities → UI elements reads left-to-right with orthogonal lines. Drag-to-pan via the scroll wrapper. Native browser zoom (Ctrl+wheel / pinch). Dark theme tuned for code-architecture diagrams.

## 0.43.5 — 2026-05-09 — trust pass

### Removed
- **`postinstall` script removed entirely.** Was previously a 2-line no-op (no network, no side effects), but its existence trips npm security audits. Now the package has no install-time code execution at all.

### Added
- **`SECURITY.md` at repo root** — honest disclosure of what the CLI writes to disk, what (if anything) it sends over the network, what the cloud-sync auth model actually is, and how to report security issues.
- **`.gitignore` updated** to keep build artifacts (`vscode-extension/*.vsix`) out of git.
- **README** — added alpha-status badge + security disclosure callout at the top so visitors know what they're getting before installing. Fixed stale references (51 commands → 12 visible, v0.38.x → v0.43.x).

### Notes
- This is a **trust-focused release**, not a feature release. Going forward, daily/experimental builds will publish to `npm install infernoflow@next` and only stable cuts get promoted to `latest`.
- Cloud sync auth model is still anonymous-key-based — disclosed openly in SECURITY.md. Run local-only for sensitive projects until proper authenticated mode ships.

## 0.43.4 — 2026-05-09

Promoted to "latest" via `npm dist-tag add` after the publish API errored despite tarballs landing on the CDN. Same content as 0.43.3 — slim package + updated README.

## 0.43.3 — 2026-05-06

### Internal
- **Slimmer npm package** — drops ~30 KB from the unpacked install:
  - `CHANGELOG.md` no longer ships in the npm tarball (still in the GitHub repo). npm doesn't render it separately, so this is pure waste removed. Saves ~25 KB.
  - Build now uses `legalComments: "none"` in esbuild — strips license header comments from minified output. Saves a few KB across 49 modules.
  - Removed redundant `dist/lib/templates` entry from the `files` array (already shipped via `dist/templates`).
- **No functionality changes** — all 49 commands work identically. Pure size cut.

## 0.43.2 — 2026-05-06

### Added
- **Component composition tree** — graph now shows parent → child component relationships. When `App.jsx` renders `<TaskList>` and `<TaskList>` renders `<TaskRow>`, those edges appear in the graph. The diagram reads like the actual JSX tree of your app, not just an unconnected list of components. Detection uses regex matching of `<CapitalizedTagName` patterns inside each component's JSX.
- **Entry-point detection** — components living in `src/App.{jsx,tsx,js,ts,vue,svelte}`, `src/main.*`, `src/index.*`, `pages/_app.*`, or `app/layout.*` are flagged as the entry. Rendered larger (radius 18 vs 11 for normal components), with a distinct pink color (`#e91e63`) and "🚪 entry" label in Mermaid output. Lets you see the root of the tree at a glance.

### Effect on the visual
Now rooted at the entry component. Before this change, the graph showed disconnected tiers (UI / Component / Capability) with no narrative flow. After: **App (entry) → child components → their UI elements → their capabilities**. The diagram tells the story of how the app is composed.

## 0.43.1 — 2026-05-06

### Fixed
- **UI element regex broke on multi-line JSX attributes**. `<button\n  onClick={handler}\n>` was being missed because `[^>]*` doesn't span newlines. Switched to `[\s\S]*?` so multi-line attributes work. UI elements should now actually appear in the graph.

### Added
- **Component layer in scan + graph**. `infernoflow scan` now also detects React/Vue/Svelte function components by Capitalized-name pattern (`function ComponentName`, `export default function`, `const Component = (...) =>`, etc.). Each component becomes a hexagon-shaped node in Mermaid output and an orange circle in HTML output, sitting **between** UI elements and capabilities. Three-tier visual: UI → Component → Capability.
- **Component-aware UI wiring**. UI elements now prefer wiring through their containing component's hexagon (so you see "Add Task button → TaskComposer component → CreateTask capability") instead of jumping directly to capabilities.
- **Better legend** in HTML output covering all 4 node kinds (capability / component / UI / frozen).

## 0.43.0 — 2026-05-06

### Added
- **`infernoflow contract graph` auto-runs scan first** if `inferno/scan.json` is missing or older than 5 minutes. No more two-step "scan then graph" — one command does both.
- **UI layer in scan + graph** — `infernoflow scan` now also walks JSX/TSX/Vue/Svelte files for interactive elements: `<button onClick={...}>`, `<input onChange={...}>`, `<form onSubmit={...}>`, `<a onClick={...}>`, `<select onChange={...}>`. Each element's handler is mapped back to the capability that owns it. The graph shows a separate UI tier so you can see "click 'Add Task' button → CreateTask capability → API call" as a visual flow.
  - In Mermaid output: UI nodes appear as round-cornered nodes with a tag emoji (🔘 button, ⌨️ input, 📝 form, 🔗 link, ▾ select).
  - In HTML output: UI nodes are smaller green dashed circles, distinct from the capability circles. Tooltip shows the element type.
- **Combined workflow** — for the "show me how the app works" view, run:
  ```
  infernoflow contract graph --html
  ```
  Auto-scans, builds the dep tree, attaches UI elements, generates the interactive D3 page. One command.

## 0.42.9 — 2026-05-06

### Added
- **Visual graph output** for `infernoflow contract graph` — two new flags:
  - `--mermaid` prints Mermaid syntax to stdout. Color-coded by stability (frozen=red, stable=yellow, experimental=blue). Renders directly in GitHub markdown, VS Code preview (with the Mermaid extension), or paste into https://mermaid.live for instant browser rendering. Pipe to a file: `infernoflow contract graph --mermaid > graph.md`.
  - `--html` generates a self-contained `inferno/graph.html` with an interactive D3 force-directed graph: drag nodes, scroll to zoom, hover for details. Open it in any browser. No external runtime needed beyond a one-time D3 fetch from cdnjs.

### Notes
- The default ASCII output is unchanged. `--mermaid` and `--html` are opt-in alternatives for when you want a real diagram.

## 0.42.8 — 2026-05-06

### Fixed
- **`infernoflow doctor` no longer reports a false-positive "CLI not found on PATH" on Windows**. `npm install -g` creates an `infernoflow.cmd` shim on Windows, not an `.exe`, and `spawnSync` won't resolve `.cmd` files without `shell: true`. The PATH-check now passes the right flag on Windows. Belt-and-suspenders: if doctor is running, the CLI is by definition reachable, so the check now defaults to pass even if the spawn probe fails on exotic shells.

## 0.42.7 — 2026-05-06

### Fixed
Same content as 0.42.6 — that version got registered on npm during a flaky publish attempt but the dist contents were stale. 0.42.7 is the actual usable build with these fixes:

## 0.42.6 — 2026-05-06

### Fixed
- **`infernoflow contract graph` no longer crashes with cryptic "Cannot read properties of undefined (reading 'add')"**. Two issues addressed:
  1. Friendly error when `inferno/scan.json` is missing — tells the user to run `infernoflow scan` first instead of crashing.
  2. Defensive guard around the dependency-edge build — stale or duplicate scan entries can no longer trigger the undefined-Set crash.
- **MCP server: `infernoflow setup` no longer registers a phantom `infernoflow_suggest` tool**. The MCP_TOOLS pre-approval list in `lib/commands/setup.mjs` was out of sync with the actual MCP server (`templates/cursor/inferno-mcp-server.mjs`) — it included one tool that was never implemented and was missing several real ones. Now lists all 14 actual tools: 9 `infernoflow_*` (added `infernoflow_apply`) + 5 `amp_*` aliases (`amp_read`, `amp_write`, `amp_search`, `amp_handoff`, `amp_health`).
- **MCP server: CLI failures are surfaced as proper JSON-RPC errors**. Previously `runCmd()` swallowed all command failures and returned the raw error text as if it were successful output, so AI agents got garbled stderr mixed into their tool replies. `runCmd()` now returns a structured `{__error, message, stderr, stdout, status}` object on failure; a central check at the dispatcher converts these into `sendError()` calls. `amp_health` and `amp_handoff` defensively handle CLI failures instead of throwing on `.trim()`.

### Notes
- VS Code extension `infernoflow.infernoflow@0.7.2` shipped on the same day. To get the matching auto-capture popup, CodeLens, bulk-delete, and orphan-handling features, install the extension from the VS Code Marketplace.
- Existing users running `infernoflow setup` after upgrading to 0.42.6 will see all 14 MCP tools pre-approved correctly. Old `.claude/settings.json` files with the phantom `infernoflow_suggest` entry won't cause harm — that tool just isn't available — but re-running `setup` will clean it up.

## 0.42.5 — 2026-05-05

### Added
- **VS Code extension Phase 1 — memory-first MVP rewrite** (`vscode-extension/` source, ships separately to the Marketplace, not via npm). The extension is now built around `.ai-memory/sessions.jsonl` instead of the old contract-system views. Five new TypeScript modules:
  - `src/amp.ts` — wraps the `infernoflow-amp` npm package, single source of truth for memory I/O. File-watcher over both `.ai-memory/` and legacy `inferno/` so any CLI write triggers a refresh.
  - `src/treeProvider.ts` — sidebar TreeView with Session Health, Gotchas, Decisions, Failed Attempts, and Quick Actions sections. Click an entry → jump to file:line.
  - `src/statusBar.ts` — `🔥 B 65 · ⚠3 · ✓2 · ❌1 · 📋 Switch` with click-to-open-sidebar and click-to-copy-handoff. Colour-coded by health grade.
  - `src/diagnostics.ts` — gotchas surface as Warnings in the Problems panel (Copilot reads them, so AI knows about gotchas before repeating mistakes).
  - `src/commands.ts` — log gotcha/decision/attempt/note, ask (search), switch, recap, refresh, openPanel, migrateAmp. All with Ctrl+Alt+G/D/A/S/R bindings.
- **Right-click editor menu** — log gotcha or decision for the current line directly from the editor context menu (file/line auto-captured).
- **Extension settings** — `cliPath`, `showStatusBar`, `showDiagnostics`, `notifications` (all/important/none).
- **`vscode-extension/README.md`** rewritten to lead with "AI Session Memory" instead of contract-first framing.

### Changed
- `vscode-extension/package.json` — replaced contracts views (Capabilities/Scenarios/Changelog) with a single Session Memory view. Replaced the 7 contracts commands with 10 memory-focused ones. Added 5 keybindings + right-click menu items. Added `infernoflow-amp@^1.0.0` as a runtime dependency.

### Internal
- TypeScript compile clean (~850 lines across 6 files). Phase 2 (gutter icons + CodeLens + auto-capture), Phase 3 (Copilot Chat participant), and Phase 4 (cloud sync UI) deferred per the locked plan in `docs/EXTENSION_PLAN.md`.
- Marketplace publish itself stays manual: `cd vscode-extension && npm install && npx vsce package && npx vsce publish` after `vsce login infernoflow` is set up. See `vscode-extension/PUBLISH.md`.

## 0.42.4 — 2026-05-05

### Added
- **Cross-platform CI matrix** — `.github/workflows/ci.yml` now runs the smoke suite on **ubuntu-latest + windows-latest + macos-latest** across Node 18/20/22 (7 cells total). Catches Windows path / line-ending / shell-quoting bugs at PR time, not after a release.
- **Production audit job in CI** — `npm audit --omit=dev --audit-level=high` runs on every push so any introduced vulnerability fails the build.
- **VS Code extension shipped to v0.7.0** — `vscode-extension/package.json` modernised: leads with "Persistent memory for AI coding sessions", expanded keywords (ai-memory, amp, copilot/cursor/claude/windsurf), AI Marketplace category, gallery banner. Activates on the AMP layout (`.ai-memory/sessions.jsonl`) AND on the legacy `inferno/` layout.
- **`vscode-extension/PUBLISH.md`** — one-time setup walkthrough (Azure DevOps PAT + `vsce login`) and recurring `npx vsce publish` workflow for shipping the extension to the VS Code Marketplace.
- **`vscode-extension/CHANGELOG.md`** — Marketplace renders it on the listing page.

### Internal
- Marketplace publish itself is a manual step (needs the maintainer's Azure DevOps PAT). All the prep — version, README, CHANGELOG, manifest fields, gallery banner — is in place; `npx vsce publish` from `vscode-extension/` ships it.

## 0.42.3 — 2026-05-05

### Added
- **`infernoflow amp` subsystem** — first-class verbs (status / migrate / validate / version) for the AI Memory Protocol. Already surfaced via the `amp` namespace dispatcher.
- **AMP MCP tool aliases** — `amp_read`, `amp_write`, `amp_handoff`, `amp_search`, `amp_health` exposed alongside the existing `infernoflow_*` tools in the bundled MCP server.
- **`switch` output redesign** — handoff is now screenshot-worthy:
  - `## ⚠️ STOP — Read These Before Doing Anything (N gotchas)` banner
  - Numbered lists for gotchas, decisions, attempts (not bullets)
  - File paths shown inline next to gotchas (`→ File: src/api.js`)
  - Session health score in header (`Health: A (90/100)`)
  - Dropped redundant "Open threads" and "Recent session log" sections
- **Trust badges in README** — `dependencies-0` and `npm-audit-0-vulnerabilities`. Backed by `npm audit` returning clean.
- **Demo GIF recording guide** at `docs/DEMO_GIF.md` — 30-second shot list with timings.

### Fixed
- `switch` health-score computation referenced an undefined `notes` filter; corrected so it builds against the actual gotcha/decision/attempt counts (max 90 instead of 100, since notes don't materialise here).
- Smoke test's gotcha-section assertion updated to match the new "STOP" header.

## 0.42.2 — 2026-05-03

### Added
- **AMP MCP tool aliases** — the bundled MCP server (`templates/cursor/inferno-mcp-server.mjs`) now exposes the 5 vendor-neutral AMP tools alongside the existing `infernoflow_*` tools: `amp_read`, `amp_write`, `amp_handoff`, `amp_search`, `amp_health`. AMP-only clients (any tool that follows AMP MCP §7.3) can call infernoflow without knowing the `infernoflow_` prefix. Backward compat preserved — all 9 `infernoflow_*` tools still work.
- **README MCP table updated** — lists all 14 tools, marks the AMP-spec aliases distinctly with a pointer to the protocol spec.

### Internal
- New install of `infernoflow install-cursor-hooks` ships the 14-tool MCP server. Existing installs continue to work; re-run `install-cursor-hooks` to pick up the AMP aliases.

## Unreleased

> Changes since v0.42.1

### Changed
- v0.42.1 — `infernoflow amp` subsystem; protocol package renamed @amp/core → ai-memory-protocol for npm publish



- VS Code Marketplace badge + extension install section

- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- infernoflow CLI v0.42.7: graph crash fix + MCP setup/error-handling hotfixes; README v0.7.2 extension features
- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- extension v0.7.3 + CLI v0.43.2: AI context injection loop (auto-sync rule files, file-ranked memory), agent conversation harvesting, visual graph w/ component+entry+UI layers, doctor Windows fix
- infernoflow CLI v0.42.7: graph crash fix + MCP setup/error-handling hotfixes; README v0.7.2 extension features
- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- v0.7.3 + CLI v0.43.x: AI injection loop closed (auto-sync rules, recent commits, ranked memory), AI session summarize, success-signal harvesting, MCP fixes, visual graph w/ component+UI tiers, doctor Windows fix
- extension v0.7.3 + CLI v0.43.2: AI context injection loop (auto-sync rule files, file-ranked memory), agent conversation harvesting, visual graph w/ component+entry+UI layers, doctor Windows fix
- infernoflow CLI v0.42.7: graph crash fix + MCP setup/error-handling hotfixes; README v0.7.2 extension features
- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- v0.7.3 extension + CLI v0.43.3: AI context loop, summarize, agent harvest, new icon, slimmer npm package
- v0.7.3 + CLI v0.43.x: AI injection loop closed (auto-sync rules, recent commits, ranked memory), AI session summarize, success-signal harvesting, MCP fixes, visual graph w/ component+UI tiers, doctor Windows fix
- extension v0.7.3 + CLI v0.43.2: AI context injection loop (auto-sync rule files, file-ranked memory), agent conversation harvesting, visual graph w/ component+entry+UI layers, doctor Windows fix
- infernoflow CLI v0.42.7: graph crash fix + MCP setup/error-handling hotfixes; README v0.7.2 extension features
- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- v0.7.3 extension + CLI v0.43.3: AI context loop, summarize, agent harvest, new icon, slimmer npm package
- v0.7.3 + CLI v0.43.x: AI injection loop closed (auto-sync rules, recent commits, ranked memory), AI session summarize, success-signal harvesting, MCP fixes, visual graph w/ component+UI tiers, doctor Windows fix
- extension v0.7.3 + CLI v0.43.2: AI context injection loop (auto-sync rule files, file-ranked memory), agent conversation harvesting, visual graph w/ component+entry+UI layers, doctor Windows fix
- infernoflow CLI v0.42.7: graph crash fix + MCP setup/error-handling hotfixes; README v0.7.2 extension features
- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- v0.7.3 extension + CLI v0.43.4: AI context loop, summarize, agent harvest, new icon, slimmer npm package, README updated
- v0.7.3 extension + CLI v0.43.3: AI context loop, summarize, agent harvest, new icon, slimmer npm package
- v0.7.3 + CLI v0.43.x: AI injection loop closed (auto-sync rules, recent commits, ranked memory), AI session summarize, success-signal harvesting, MCP fixes, visual graph w/ component+UI tiers, doctor Windows fix
- extension v0.7.3 + CLI v0.43.2: AI context injection loop (auto-sync rule files, file-ranked memory), agent conversation harvesting, visual graph w/ component+entry+UI layers, doctor Windows fix
- infernoflow CLI v0.42.7: graph crash fix + MCP setup/error-handling hotfixes; README v0.7.2 extension features
- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- v0.43.5 trust pass — remove postinstall, add SECURITY.md, README accuracy + alpha badge, repo cleanup, blog/PR drafts queued
- v0.7.3 extension + CLI v0.43.4: AI context loop, summarize, agent harvest, new icon, slimmer npm package, README updated
- v0.7.3 extension + CLI v0.43.3: AI context loop, summarize, agent harvest, new icon, slimmer npm package
- v0.7.3 + CLI v0.43.x: AI injection loop closed (auto-sync rules, recent commits, ranked memory), AI session summarize, success-signal harvesting, MCP fixes, visual graph w/ component+UI tiers, doctor Windows fix
- extension v0.7.3 + CLI v0.43.2: AI context injection loop (auto-sync rule files, file-ranked memory), agent conversation harvesting, visual graph w/ component+entry+UI layers, doctor Windows fix
- infernoflow CLI v0.42.7: graph crash fix + MCP setup/error-handling hotfixes; README v0.7.2 extension features
- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- v0.43.5 trust pass — remove postinstall, add SECURITY.md, README accuracy + alpha badge, repo cleanup, blog/PR drafts queued
- v0.7.3 extension + CLI v0.43.4: AI context loop, summarize, agent harvest, new icon, slimmer npm package, README updated
- v0.7.3 extension + CLI v0.43.3: AI context loop, summarize, agent harvest, new icon, slimmer npm package
- v0.7.3 + CLI v0.43.x: AI injection loop closed (auto-sync rules, recent commits, ranked memory), AI session summarize, success-signal harvesting, MCP fixes, visual graph w/ component+UI tiers, doctor Windows fix
- extension v0.7.3 + CLI v0.43.2: AI context injection loop (auto-sync rule files, file-ranked memory), agent conversation harvesting, visual graph w/ component+entry+UI layers, doctor Windows fix
- infernoflow CLI v0.42.7: graph crash fix + MCP setup/error-handling hotfixes; README v0.7.2 extension features
- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- Publish AMP — AI Memory Protocol v1.0 spec + TypeScript reference implementation
- v0.43.5 trust pass — remove postinstall, add SECURITY.md, README accuracy + alpha badge, repo cleanup, blog/PR drafts queued
- v0.7.3 extension + CLI v0.43.4: AI context loop, summarize, agent harvest, new icon, slimmer npm package, README updated
- v0.7.3 extension + CLI v0.43.3: AI context loop, summarize, agent harvest, new icon, slimmer npm package
- v0.7.3 + CLI v0.43.x: AI injection loop closed (auto-sync rules, recent commits, ranked memory), AI session summarize, success-signal harvesting, MCP fixes, visual graph w/ component+UI tiers, doctor Windows fix
- extension v0.7.3 + CLI v0.43.2: AI context injection loop (auto-sync rule files, file-ranked memory), agent conversation harvesting, visual graph w/ component+entry+UI layers, doctor Windows fix
- infernoflow CLI v0.42.7: graph crash fix + MCP setup/error-handling hotfixes; README v0.7.2 extension features
- infernoflow CLI v0.42.6: graph crash fix + MCP setup/error-handling hotfixes
- extension v0.7.2 + CLI hotfixes: auto-capture, CodeLens, bulk + orphan delete, MCP setup tools fix, graph crash guard
- VS Code Marketplace badge + extension install section

- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified

- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified
- remove internal planning docs from public repo

- v0.43.6 + ext v0.7.5: Memory protocol skill (AI proactively logs via amp_write) + Mermaid flow-chart for --html graph
- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified
- remove internal planning docs from public repo

- bump 0.43.6 → 0.43.7 (phantom-publish workaround)
- v0.43.6 + ext v0.7.5: Memory protocol skill (AI proactively logs via amp_write) + Mermaid flow-chart for --html graph
- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified
- remove internal planning docs from public repo

- v0.43.7 dist rebuild + remove lib/cloud + lib/commands/{cloud,dashboard,login} (moved to legacy/)
- bump 0.43.6 → 0.43.7 (phantom-publish workaround)
- v0.43.6 + ext v0.7.5: Memory protocol skill (AI proactively logs via amp_write) + Mermaid flow-chart for --html graph
- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified
- remove internal planning docs from public repo

- block internal planning docs from git
- v0.43.7 dist rebuild + remove lib/cloud + lib/commands/{cloud,dashboard,login} (moved to legacy/)
- bump 0.43.6 → 0.43.7 (phantom-publish workaround)
- v0.43.6 + ext v0.7.5: Memory protocol skill (AI proactively logs via amp_write) + Mermaid flow-chart for --html graph
- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified
- remove internal planning docs from public repo

- gitignore .ai-memory/ + rule files so memory survives branch switches (0.43.8)
- block internal planning docs from git
- v0.43.7 dist rebuild + remove lib/cloud + lib/commands/{cloud,dashboard,login} (moved to legacy/)
- bump 0.43.6 → 0.43.7 (phantom-publish workaround)
- v0.43.6 + ext v0.7.5: Memory protocol skill (AI proactively logs via amp_write) + Mermaid flow-chart for --html graph
- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified
- remove internal planning docs from public repo

- one-install bootstrap — extension auto-installs CLI + setup wires all 4 AI tools (CLI 0.43.9 + ext 0.7.7)
- gitignore .ai-memory/ + rule files so memory survives branch switches (0.43.8)
- block internal planning docs from git
- v0.43.7 dist rebuild + remove lib/cloud + lib/commands/{cloud,dashboard,login} (moved to legacy/)
- bump 0.43.6 → 0.43.7 (phantom-publish workaround)
- v0.43.6 + ext v0.7.5: Memory protocol skill (AI proactively logs via amp_write) + Mermaid flow-chart for --html graph
- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified
- remove internal planning docs from public repo

- one-install bootstrap — extension auto-installs CLI + setup wires all 4 AI tools (CLI 0.43.9 + ext 0.7.7)
- gitignore .ai-memory/ + rule files so memory survives branch switches (0.43.8)
- trust pass on dogfood feedback — init --help, sync CONTEXT.md drift, status hint, scanner exclusions, gitignore transparency, stale npm scripts audit, auto-capture default off (CLI 0.43.10 + ext 0.7.8)
- block internal planning docs from git
- v0.43.7 dist rebuild + remove lib/cloud + lib/commands/{cloud,dashboard,login} (moved to legacy/)
- bump 0.43.6 → 0.43.7 (phantom-publish workaround)
- v0.43.6 + ext v0.7.5: Memory protocol skill (AI proactively logs via amp_write) + Mermaid flow-chart for --html graph
- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified
- remove internal planning docs from public repo

- one-install bootstrap — extension auto-installs CLI + setup wires all 4 AI tools (CLI 0.43.9 + ext 0.7.7)
- gitignore .ai-memory/ + rule files so memory survives branch switches (0.43.8)
- silent version-skew backfill on every CLI command + gray import bug in setup
- trust pass on dogfood feedback — init --help, sync CONTEXT.md drift, status hint, scanner exclusions, gitignore transparency, stale npm scripts audit, auto-capture default off (CLI 0.43.10 + ext 0.7.8)
- block internal planning docs from git
- v0.43.7 dist rebuild + remove lib/cloud + lib/commands/{cloud,dashboard,login} (moved to legacy/)
- bump 0.43.6 → 0.43.7 (phantom-publish workaround)
- v0.43.6 + ext v0.7.5: Memory protocol skill (AI proactively logs via amp_write) + Mermaid flow-chart for --html graph
- v0.43.6 + ext v0.7.5 focus pivot — strip cloud + dashboard + login (preserved in legacy/), remove init comma-prompt, cull sidebar to 6 sections, README/SECURITY simplified
- remove internal planning docs from public repo

## 0.42.1 — 2026-05-03

### Added
- **`infernoflow amp` subsystem** — first-class verbs for the AI Memory Protocol:
  - `infernoflow amp` (or `amp status`) — prints AMP conformance level, layout state (.ai-memory/ vs legacy inferno/), and entry breakdown by type.
  - `infernoflow amp migrate` — copies legacy `inferno/sessions.jsonl` into `.ai-memory/sessions.jsonl` with AMP-shape translation. Idempotent. Leaves the original untouched.
  - `infernoflow amp validate` — schema-checks every entry in `sessions.jsonl` against AMP v1.0 (type enum, msg ≤ 500 chars, ts as Unix-ms integer, ULID format, tool enum, confidence range). Surfaces parse errors and schema violations with line numbers.
  - `infernoflow amp version` — prints the AMP spec version (1.0).
- **README repositioned** — leads with "infernoflow is the reference CLI for AMP". New "AI Memory Protocol" section explaining `.ai-memory/` layout, wire format, and the migration path.
- **`amp` namespace added to `--help`** — joins contract / cloud / dev as the four subsystem dispatchers.

### Internal
- Verified end-to-end: legacy `inferno/sessions.jsonl` with `summary` / `agent` / `result` / non-AMP types → `infernoflow amp migrate` → AMP-shape entries on disk → `infernoflow amp validate` reports 3/3 conform → `infernoflow ask` finds them via the normalization layer.

## 0.42.0 — 2026-05-03

### Added
- **AMP-compliant on-disk format** — infernoflow now speaks the [AI Memory Protocol v1.0](docs/protocol/PROTOCOL.md) natively. New projects get `.ai-memory/sessions.jsonl` (the AMP canonical layout) instead of `inferno/sessions.jsonl`. Entries on disk use the AMP wire format: `msg` instead of `summary`, Unix-ms integer `ts`, ULID `id` on every entry, AMP type enum (gotcha/decision/attempt/note/detection/pattern), `meta` for tool-specific extras.
- **Lossless round-trip for infernoflow-specific fields** — `result`, `agent: "human"`, `auto: true`, and the extra entry types (`preference`, `theme`, `handoff`, `error`) are preserved via `meta.subtype` / `meta.result` / `meta.agent` / `confidence`. Read paths translate AMP shape back to infernoflow's familiar internal shape so the rest of the codebase doesn't need to change.
- **AMP injection markers** — auto-update of `CLAUDE.md`, `.cursorrules`, and `.github/copilot-instructions.md` now wraps the generated section with `<!-- AMP:START -->` / `<!-- AMP:END -->` so other AMP-compliant tools can edit-in-place without trampling each other.
- **Backward compat** — projects with the legacy `inferno/sessions.jsonl` keep working unchanged. Both layouts are read transparently; writes always target `.ai-memory/`.

### Internal
- `lib/amp/io.mjs` is the single source of truth for file paths, entry shape, ULID generation, and translation. ~270 lines, zero external dependencies. Plumbing for the upcoming `@amp/core` npm publish (Phase B) and `amp_*` MCP tool aliasing (Phase C).
- `infernoflow amp migrate` (coming in next release) will copy legacy `inferno/sessions.jsonl` → `.ai-memory/sessions.jsonl` with shape translation. Until then, projects can stay on the legacy layout indefinitely.

## 0.41.0 — 2026-05-03

### Changed
- **Command surface culled from 51 visible to 12.** `--help` now shows only the 5-command memory core (log/ask/switch/recap/status), 3 setup commands (init/watch/doctor), and 3 subsystem dispatchers (contract/cloud/dev). All 53 legacy command names remain callable as top-level aliases — backward compatible. K.I.S.S. first-impression for new users; full discoverability via `infernoflow commands`.
- **New namespace dispatchers** — `infernoflow contract scan` routes to the same handler as `infernoflow scan`. Same for `infernoflow dev publish`, etc. Run `infernoflow contract` or `infernoflow dev` with no verb to see the verbs in that namespace. The existing `cloud` dispatcher (with init/push/pull/status/dashboard subcommands) is untouched.
- **`infernoflow commands` regrouped** to advertise the new namespace structure: Memory / Watch / Setup at top level, then Contract / Cloud / Dev grouped with their verbs.

### Internal
- This is the first half of the move toward the AI Memory Protocol (AMP) — see docs/protocol/PROTOCOL.md. Phase A.2 (folder rename to `.ai-memory/`, AMP-compliant entry shape with ULIDs and `meta.subtype` for infernoflow extras) is up next.

## 0.40.6 — 2026-05-02

### Fixed
- **`infernoflow init` first-gotcha prompt is now bulletproof.** The original prompt accepted whatever you typed verbatim, so a confused user (Ron earlier today, after Ctrl+C'ing a stuck `--browser` login) could paste a multi-line shell command and end up with `node ../infernoflow-pkg/bin/infernoflow.mjs log "..."` saved as their first memory. The first interaction every new user has now:
  - **Detects shell-command-shaped input** (starts with node/npm/npx/git/cd/python/etc., or contains `&&`/`||`/`>`/`|` operators, or contains a Windows drive path) and re-prompts with a hint.
  - **Detects multi-line paste** and re-prompts asking for a single short sentence.
  - **Trims accidental leading prompt characters** (`> `, `$ `, `# `) — common when copy/pasting from terminal output.
  - **Treats input shorter than 3 chars as too short** (single keystrokes, accidental Enter).
  - **Handles Ctrl+C cleanly** — exits the prompt without leaving inferno/ in a half-state.
  - **Two-strike rule** — after two bad inputs we silently skip rather than block the install.
- Verified via 18-case unit test of the classifier covering all the failure modes.

## 0.40.5 — 2026-05-02

### Fixed
- **`infernoflow scaffold` ID consistency** — scaffold previously rejected `UserSearch` with "Invalid capability ID — use lowercase kebab-case", but every other contracts command (scan, adopt, freeze, contract.json itself) uses PascalCase IDs like `CreateItem`. Anyone seeing the existing capabilities and trying to scaffold a similar one was blocked. Now scaffold accepts kebab-case, snake_case, camelCase, PascalCase, or space-separated input and normalizes to the canonical PascalCase. Duplicate-detection matches either the canonical or the user-typed form.

## 0.40.4 — 2026-05-02

### Added
- **GitHub Action PR-comment v2** — the action now shows the matched file inline next to high-relevance gotchas, surfaces failed-attempts on the same surface as a "don't repeat" section, and adds an `infernoflow impact <cap>` tip when frozen capabilities are touched. Comment header now shows total session-memory size + gotcha/decision counts.
- **Idempotent comment marker** — the action embeds `<!-- infernoflow-action:pr-memory-check -->` so repeated runs reliably edit the same comment instead of risking duplicates from string-match drift.
- **`min-type: always`** — opt-in mode that posts the comment even when nothing relevant is in the diff (useful for docs/landing screenshots).

### Changed
- **`action/dist/index.js` rebuilt** from the new src. Workflow template now references `ronmiz/infernoflow@action-v2`.
- **Comment marker recovery** — v2 still recognises v1 comments (matches by title), so existing PRs migrate cleanly without leaving orphaned comments.
- **Action runtime cleanup** — replaced dead `upsertComment` workaround with proper PATCH support; HTTP helpers consolidated into a single `httpsRequest(method, ...)` with `httpsGet/Post/Patch` thin wrappers.

## 0.40.3 — 2026-05-02

### Added
- **`infernoflow watch` heuristic prompts (Plan Part 4 Level 2)** — the watcher now surfaces "log this?" tips when it spots patterns that usually indicate gotchas, on top of the existing debounced auto-suggest:
  - Same file edited 5/12/25 times in a session → "stuck on something?" with a gotcha-log hint
  - Dependency manifest changed (package.json, Cargo.toml, go.mod, requirements.txt, Pipfile, Gemfile, composer.json, lockfiles, etc. — 18 files total) → suggests logging the decision
  - Test file deleted (under `tests/`, `test/`, `__tests__/`, `spec/`, or matching `*.test.*` / `*.spec.*`) → suggests logging why
- **`--no-tips` flag** — disables the heuristic prompts while keeping the auto-suggest behaviour. `--silent` continues to disable all output.

### Changed
- **`watch` default directories** include `tests`, `test`, `__tests__`, `spec` so test-file removal is detected without manual `infernoflow watch tests` invocations.
- **Non-recursive project-root watcher** added under the hood so dependency-manifest changes are caught regardless of which subdirectory was passed to `watch`.
- **Per-file 250ms debounce** on event handling — fs.watch fires multiple events per save on most platforms; the watcher now collapses them so edit-count thresholds and dependency-tip prompts don't double-fire.

## 0.40.1 — 2026-05-02

### Fixed
- **`infernoflow login` default reverted to GitHub Device Flow** — 0.40.0 had the experimental Supabase browser-OAuth flow as the default, which hung waiting for the localhost callback when the user's Supabase project didn't have the redirect URLs in its allow-list. Default is now the proven Device Flow (identity + anon-key cloud writes); the browser-OAuth path is opt-in via `infernoflow login --browser`.

## 0.40.0 — 2026-05-02

### Added
- **Experimental Supabase JWT auth (`infernoflow login --browser`)** — opens your browser to Supabase's GitHub OAuth, captures the session via a one-shot localhost callback (port range 47655–47659), and stores the JWT + refresh token. After this, cloud writes are authenticated under your `auth.uid()` and the per-user RLS policy `auth.uid() = user_id` becomes enforceable. Opt-in until end-to-end verified against a real Supabase project.
- **Automatic token refresh** — `pushEntry` calls `refreshSessionIfNeeded()` before each write, hitting `/auth/v1/token?grant_type=refresh_token` within 5 minutes of expiry. Falls back silently to anon-key dev mode if refresh fails so local logging is never blocked.
- **Tagged credentials schema** — `mode: "supabase" | "device-flow"` with full backward-compatible reads of pre-v0.40 single-`access_token` files. New `getSupabaseAccessToken()` helper for synchronous JWT lookup with expiry awareness.
- **`doctor` full credential-state recognition** — distinct messages for not-logged-in, supabase-authenticated, identity-only device-flow, and legacy schema (with re-login nudge).

### Changed
- **Default `infernoflow login` is unchanged** — still GitHub Device Flow, still works exactly as it did in v0.38–0.39. The new browser-OAuth path is opt-in via `--browser` until the Supabase project setup (allow-list URLs, GitHub provider, schema apply) is confirmed working end-to-end.
- **`scripts/supabase-schema.sql`** — `user_id` now defaults to `auth.uid()` so authenticated writes (when you opt in) auto-populate it. Schema is fully idempotent. Both RLS policies retained: "Users own their entries" enforces the authenticated path; "Anon can insert (dev mode)" keeps the device-flow path working.
- **`whoami`** prints the auth mode (Supabase JWT vs identity-only) and JWT expiry when present.

### Required setup before `--browser` works
On your Supabase project, one-time:
1. Authentication → Providers → enable GitHub.
2. Authentication → URL Configuration → Redirect URLs: add `http://localhost:47655/callback` through `http://localhost:47659/callback`.
3. SQL Editor → paste and run `scripts/supabase-schema.sql` (idempotent).

Then: `infernoflow logout && infernoflow login --browser`. If anything misbehaves, plain `infernoflow login` still works.

## 0.39.0 — 2026-05-02

### Added
- **Memory-mode-aware `status`** — no longer prints "✘ contract.json not found" as if something is broken. In memory mode (the default since v0.37.0) it shows entries/gotchas/decisions/attempts/last-entry plus a next-step prompt. JSON mode equivalent.
- **`doctor` router-integrity check** — scans `bin/infernoflow.mjs` for every imported command module and verifies the file exists. Catches the "vapor commands" class of regression where the CLI advertises commands whose implementation was deleted.
- **`doctor` `.gitignore` sanity check** — flags missing `node_modules/` exclusion (the kind of thing that lets 5,200+ dependency files leak into git).
- **`doctor` correct cloud-credential detection** — reads `~/.infernoflow/credentials.json` (the real path), shows logged-in user, and warns when token has expired.
- **Honest cloud documentation** — `lib/cloud/supabase.mjs` header, `login` success message, and `scripts/supabase-schema.sql` now accurately describe the anonymous-token write model rather than implying authenticated RLS that isn't enforced.

### Changed
- **README repositioned** to lead with session memory (the actual product per `package.json` description and the strategic plan), with capability contracts as a secondary track. Added 5-command core table, badges, MCP-tools list expanded from 4 to the actual 9 tools registered by the server, cloud sync section with auth-model disclosure.
- **`doctor` memory-mode awareness** — scenarios/changelog/CONTEXT.md checks now short-circuit to "n/a in memory mode" instead of warning, since none of those exist by design in memory-mode projects.

### Fixed
- **`doctor` crashed on launch** with `Error: The requested module '../ai/providerRouter.mjs' does not provide an export named 'detectAvailableProviders'`. Added the missing function (env-var-based provider detection).
- **`uninstall` crashed** with `hooks.every is not a function` when `.cursor/hooks.json` used the newer object-keyed-by-event format instead of a flat array. Now normalises both shapes.

## 0.38.16 — 2026-05-02

### Fixed
- **Catastrophic recovery** — v0.38.9 was an accidental wipe commit that removed 5,349 files (1.1M lines) from git tracking. v0.38.15 was a partial recovery that still had `vscode-extension/node_modules/` tracked. v0.38.16 is the clean shipping release.
- **Restored 16 missing command modules** that had been deleted in `ba537ba` (Polar.sh checkout work) and never added back: `ai`, `ask`, `ci`, `cloud`, `demo`, `explain`, `feedback`, `monorepo`, `notify`, `scaffold`, `stats`, `test`, `theme`, `uninstall`, `upgrade`, `watch`. Plus `lib/telemetry.mjs` and `lib/theme/scanner.mjs`. Recovered from `v0.35.9` (commit `a5a648f`).
- **Removed 16 vapor command entries** from the CLI router that pointed at module files that have never existed (`agent`, `audit`, `export`, `health`, `link`, `onboard`, `pr-comment`, `report`, `scout`, `share`, `snapshot`, `synthesize`, `team-sync`, `version`, `vibe`, `adoptWizard`). Previously `infernoflow share` etc. crashed with "Cannot find module"; now `--help` lists 51 commands and every one resolves to an actual file.
- **Re-applied the v0.38.9 await fix** in `lib/commands/log.mjs` — `pushEntry` is now properly awaited so short-lived `log` invocations don't exit before the cloud push completes.
- **`log` and `ask` arg parsing** — both commands were including the command name itself in their text input (e.g. `Logged: log API returns ...`). No
