# Changelog — infernoflow

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
- **`log` and `ask` arg parsing** — both commands were including the command name itself in their text input (e.g. `Logged: log API returns ...`). Now skip `args[0]` when collecting positional tokens.
- **`init.mjs` missing imports** — `bold`, `green`, `red` were referenced but not imported, causing `ReferenceError: bold is not defined` at the end of `init --adopt --yes`.
- **`bin/infernoflow.mjs` package.json lookup** — assumed the installed `dist/bin/` layout, so `node bin/infernoflow.mjs` from source crashed. Now falls back to `../package.json` for development.

### Changed
- **`scripts/supabase-schema.sql`** rewritten to match production: `user_id` nullable, `user_token` text column added, dual policies (authenticated path preserved + explicit anon-insert policy reflecting current dev-mode auth), expanded indexes. Top-of-file doc explains the two write paths and how to switch from anon to authenticated mode later.
- **`.gitattributes`** added — normalizes line endings so the index stores LF and Windows working trees can use CRLF without polluting diffs.
- **`.gitignore`** rewritten — properly excludes `node_modules/` and `**/node_modules/` (was missing, leading to 5,200+ tracked dependency files), plus standard Node/editor/OS artifacts.

### Internal
- Smoke suite updated (`scripts/smoke.mjs`) to match the progressive-disclosure `--help` model. Now exercises init → log → ask → switch → recap end-to-end in a tempdir, asserts the gotcha-first HANDOFF format, and catches the args[0] regression that just bit `log` and `ask`.
- Added a `backup-broken-v0.38.9` git tag pointing at the wipe commit.


## 0.38.16 — 2026-05-02

### Fixed
- **Catastrophic recovery** — v0.38.9 was an accidental wipe commit that removed 5,349 files (1.1M lines) from git tracking. Soft-reset to v0.38.7 to restore the working tree to git, then re-applied the original "await cloud push" fix the v0.38.9 commit was supposed to make.
- **Restored 16 missing command modules** that had been deleted in `ba537ba` (Polar.sh checkout work) and never added back: `ai`, `ask`, `ci`, `cloud`, `demo`, `explain`, `feedback`, `monorepo`, `notify`, `scaffold`, `stats`, `test`, `theme`, `uninstall`, `upgrade`, `watch`. Plus `lib/telemetry.mjs` and `lib/theme/scanner.mjs`. Recovered from `v0.35.9` (commit `a5a648f`).
- **Removed 16 vapor command entries** from the CLI router that pointed at module files that have never existed (`agent`, `audit`, `export`, `health`, `link`, `onboard`, `pr-comment`, `report`, `scout`, `share`, `snapshot`, `synthesize`, `team-sync`, `version`, `vibe`, `adoptWizard`). Previously `infernoflow share` etc. crashed with "Cannot find module"; now `--help` lists 51 commands and every one resolves to an actual file.
- **`log` and `ask` arg parsing** — both commands were including the command name itself in their text input (e.g. `Logged: log API returns ...`). Now skip `args[0]` when collecting positional tokens.
- **`init.mjs` missing imports** — `bold`, `green`, `red` were referenced but not imported, causing `ReferenceError: bold is not defined` at the end of `init --adopt --yes`.
- **`bin/infernoflow.mjs` package.json lookup** — assumed the installed `dist/bin/` layout, so `node bin/infernoflow.mjs` from source crashed. Now falls back to `../package.json` for development.

### Changed
- **`scripts/supabase-schema.sql`** rewritten to match production: `user_id` nullable, `user_token` text column added, dual policies (authenticated path preserved + explicit anon-insert policy reflecting current dev-mode auth), expanded indexes. Top-of-file doc explains the two write paths and how to switch from anon to authenticated mode later.
- **`.gitattributes`** added — normalizes line endings so the index stores LF and Windows working trees can use CRLF without polluting diffs.
- **`.gitignore`** rewritten — properly excludes `node_modules/` (was missing, leading to 5,200+ tracked dependency files), plus standard Node/editor/OS artifacts.

### Internal
- Smoke suite updated (`scripts/smoke.mjs`) to match the progressive-disclosure `--help` model. Now exercises init → log → ask → switch → recap end-to-end in a tempdir, asserts the gotcha-first HANDOFF format, and catches the args[0] regression that just bit `log` and `ask`.
- Added a `backup-broken-v0.38.9` git tag pointing at the wipe commit, in case any of the deleted-then-restored content needs cross-referencing.

## 0.10.25 — 2026-04-22

### Added
- Release 0.10.25


## 0.10.24 — 2026-04-21

### Added
- Release 0.10.24


## 0.10.23 — 2026-04-21

### Added
- Release 0.10.23


## 0.10.22 — 2026-04-21

### Added
- Release 0.10.22


## 0.10.21 — 2026-04-21

### Added
- Release 0.10.21


## 0.10.20 — 2026-04-21

### Added
- Release 0.10.20


## 0.10.19 — 2026-04-21

## 0.10.12 — 2026-04-12

### Added
- `infernoflow install-cursor-hooks` — Cursor Agent hooks append assistant replies to `inferno/CON