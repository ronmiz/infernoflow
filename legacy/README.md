# legacy/ — preserved code, not shipped on npm

These files are NOT included in the published npm package (excluded via the `files` field in `package.json`). They live here because they represent real work removed during the v0.43.6 "ONE thing" focus pivot — kept for git history, potential revival as separate packages, or simple reference.

**To bring any of these back into the active CLI:**
1. Move file back to its original location (e.g., `legacy/commands/cloud.mjs` → `lib/commands/cloud.mjs`)
2. Re-add the route entry in `bin/infernoflow.mjs`
3. Re-add the description in the help block

The full pre-removal state is preserved as git tag `v0.43.5-pre-cleanup`.

---

## What's here

### `commands/cloud.mjs` (28 KB)
Supabase-based cloud sync — sub-commands: init, push, pull, status, dashboard, notify.
**Why removed:** auth model was anonymous-key writes with per-user `user_token` column — fine for solo dev experiments, not a real security boundary. Charging for it would require fixing auth first; without user demand, premature.
**Revival path:** v0.50 Pro tier candidate, only after free-tier adoption proves the market and proper OAuth/JWT is built.

### `commands/dashboard.mjs` (43 KB)
Local web dashboard on `http://localhost:7337` — contract health, capabilities table, audit findings, SSE live updates.
**Why removed:** secondary UI that duplicates the VS Code sidebar (which is better placed). Most users never ran a local web server. 43 KB of code with low usage.
**Revival path:** could become a separate `infernoflow-dashboard` npm package if there's demand — `npx infernoflow-dashboard` runs it without bloating the core CLI.

### `commands/login.mjs` (18 KB)
GitHub Device Flow authentication + `logout` + `whoami` sub-commands. Cloud-only — provides identity for cloud sync's `user_token`.
**Why removed:** without cloud sync, identity has no purpose. Memory is fully local; no account needed.
**Revival path:** comes back together with cloud sync.

---

## Total removed surface

- 89 KB of source code
- 5 user-facing commands (`cloud`, `dashboard`, `login`, `logout`, `whoami`)
- All cloud-related route lines from `bin/infernoflow.mjs`
- All cloud sections from README, SECURITY.md, and the website

**Result on the npm tarball:** ~500 KB → ~410 KB unpacked, fewer files, cleaner help output, no mention of features that aren't load-bearing.
