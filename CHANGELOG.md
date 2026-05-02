# Changelog — infernoflow

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