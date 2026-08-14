<!-- infernoflow:start -->
<!-- Auto-managed by infernoflow. Don't edit between these markers. -->
## Project memory (infernoflow)

### Memory protocol

Use the `amp_write` and `amp_bookmark` MCP tools **proactively** (without being asked): log a one-sentence entry when the user hits frustration (`!!` / "not working" / "retry" → `attempt`), a `decision` is made, or you learn a non-obvious `gotcha`; drop a bookmark on "bookmark this". Don't log what's re-derivable from the code. The full trigger list and field shapes are in the tool descriptions — if the `amp_*` tools aren't visible, load them first (Claude Code: `ToolSearch` with query `infernoflow`).

### Recent commits
- `8de07ab` _2026-07-31_ 0.44.14
- `5f2511f` _2026-07-31_ fix: field-findings (git hooks, config wipe-guard, Claude Desktop wiring, capture hook, help, TTY color, dates, log --clear, doctor)
- `4ce7590` _2026-07-19_ marketing: rough cut v7 — Veo Ingredients hand shot (old man on-screen!) + our readable screens composited with occluder preservation
- `1b79dc9` _2026-07-19_ marketing: rough cut v6 — true per-frame corner pinning via edge-line fitting + intersection
- `84e5239` _2026-07-19_ marketing: rough cut v5 — optical-flow bezel tracking (camera move compensated), expanded quad clipped by luminance mask

### Recent memory
- 🔥 · **note**: cowork demo — infernoflow used in chat, v0.44.11 live
- 🔥 ⚠ **gotcha** (`docs/env-notes.md`): Cowork sandbox needs npm prefix workaround for global installs — mkdir ~/.npm-global && npm config set prefix. Otherwise EACCES on /usr/lib. Doesn't affect end-user installs, only relevant when demoin…
- 🔥 ✓ **decision**: v0.44.11 published to npm successfully — 44-version gap closed, dogfooded via Cowork chat installing global CLI in Linux sandbox and running it on the mounted repo path. Public launch is now unblocked…
- 🔥 ⚠ **gotcha**: Two managed blocks in CLAUDE.md: <!-- infernoflow:start --> (new, refreshed on log) and <!-- AMP:START --> (older, from 'infernoflow context' or similar). Consolidate to one block in 0.44 to avoid dri…

<!-- infernoflow:end -->
