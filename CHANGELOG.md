# Changelog — infernoflow

## 0.10.21 — 2026-04-21

### Added
- Release 0.10.21


## 0.10.20 — 2026-04-21

### Added
- Release 0.10.20


## 0.10.19 — 2026-04-21

## 0.10.12 — 2026-04-12

### Added
- `infernoflow install-cursor-hooks` — Cursor Agent hooks append assistant replies to `inferno/CONTEXT.draft.md`; `infernoflow init --cursor-hooks`.
- `infernoflow install-vscode-copilot-hooks` — VS Code + GitHub Copilot agent hooks (Preview) via `.github/hooks/`; `infernoflow init --vscode-copilot-hooks`.
- Shared draft tooling: `scripts/inferno-promote-draft.mjs`, `.gitignore` entry for `inferno/CONTEXT.draft.md`.
- `lib/draftToolingInstall.mjs` — shared installer logic for promote script and gitignore.

### Changed
- CLI help widens command column for long names (e.g. `install-vscode-copilot-hooks`).

## 0.1.0 — 2026-02-26

### Added
- `infernoflow init` — interactive scaffold with prompts
- `infernoflow check` — full validation with clear error messages  
- `infernoflow status` — at-a-glance dashboard
- `infernoflow doc-gate` — CI hook for keeping docs in sync
- Zero npm dependencies — works with Node.js 18+ out of the box
- `--json` flag on check for CI pipelines
- Auto-detect project name from package.json
- Auto-add npm scripts to package.json on init
