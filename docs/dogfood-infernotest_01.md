# What infernoflow caught while building infernotest_01

> A field report. We built a multi-tenant kanban (`infernotest_01`) end-to-end with an AI agent — Fastify + Prisma + Zod on the backend, React + Vite + TS + Tailwind v4 on the frontend, SQLite in dev — and ran infernoflow live the whole time. Below are the captures that infernoflow surfaced in `.ai-memory/`. Each one is a thing that would otherwise have been re-discovered at midnight on a Friday.

The point of this document is not to list bugs. It's to show what *kind* of knowledge infernoflow keeps: the stuff a static read of the code cannot tell you.

---

## How we ran it

- One agent, multiple sessions across multiple days.
- The agent had access to the `amp_*` MCP tools (`amp_write` / `amp_read` / `amp_search` / `amp_handoff` / `amp_health`) and the four `infernoflow_*` tools.
- Every captured entry below is a real line from `.ai-memory/sessions.jsonl` — verbatim, with the surrounding scenario.
- No human transcription. The agent wrote these to disk itself, on its own initiative, while the work was happening.

---

## 1. Gotchas — the silent traps

These are the things the codebase will not warn you about. They cost time the first time and zero time after, *if* you remember them. infernoflow's job is the second half of that sentence.

### Vite proxy rewrites the Host header — server-built URLs point at the wrong port

> `vite.config.ts` — *"Vite proxy with `changeOrigin: true` rewrites the Host header on the way to the backend. Any server-side URL construction from `req.headers.host` produces a URL pointing at the BACKEND port (localhost:3000), not the user's browser origin (localhost:5173). Resulting links 404 in the browser. Fix pattern: build user-facing URLs CLIENT-SIDE using `window.location.origin`; have the backend return only the token (or a relative path) and let the SPA assemble the full URL."*

Showed up when invite emails (well, console-logged invite links) pointed at `:3000/invite/<token>` and 404'd in the browser. The first hour went into "is the route registered? is the regex right?" before the agent traced it to the proxy.

### Prisma 6 query engine DLL is locked while `tsx watch` is running

> `server/prisma/schema.prisma` — *"Prisma 6 `query_engine.dll.node` is locked while tsx watch is running; `prisma migrate dev` fails with EPERM on rename. Stop the dev server before `prisma migrate dev` / `prisma generate`. (Affects Windows; probably also when antivirus has the file open.)"*

Pure Windows pain. The error message (EPERM, rename) is misleading — it suggests permissions. The actual cause is the running watch process. infernoflow now reminds the next session before it tries.

### Invite-accept burned the token for already-members

> `server/src/routes/members.ts` — *"Invite accept must NOT burn the token when the caller is already a member of the workspace. Found in dogfood: Alice (existing admin) momentarily hit `/invite/<token>` while still authed; the original 'idempotent' path called acceptInvite which marked `acceptedAt=NOW` for the token. Result: a freshly-generated single-use link was silently consumed by an already-member click. Fix: return early with the existing membership BEFORE marking the invite consumed; only burn the token when actually creating a new Membership."*

A bug that needs two users in the same workspace to reproduce. The first time it bit us, the link looked broken to the actual invitee. infernoflow's capture made the fix surgical and the test obvious.

### `tsx watch` reloads mid-request — proxy returns 502

> `server/src/index.ts` — *"tsx watch reloads mid-request when you save a file with an in-flight fetch — the proxy surfaces 502 in the browser. Not a real failure. Retry once if you see a transient 502 during development; if it persists, the backend is actually down."*

Without this captured, every transient 502 looks like a regression. With it captured, the agent stops thrashing.

### `npm install` silently removes `npm link`

> `package.json` — *"npm install in a project with `npm link infernoflow` SILENTLY removes the symlink. Any `npm install <something>` wipes `node_modules/infernoflow` because npm reconciles to `package.json` which doesn't list infernoflow as a dep. After installing anything new, you have to re-run `npm link infernoflow` or the old MCP wrapper falls back to a registry-cached old version."*

This one had a downstream effect: subsequent `amp_write` calls were going through an *old* wrapper, dropping fields. The capture explained the symptom *and* the cause *and* the remediation. The infernoflow 0.44.0 rewrite (in-process AMP IO, no shell-out to a separate binary) makes this problem disappear.

### Editing the MCP server file does not hot-reload it

> `.cursor/inferno-mcp-server.mjs` — *"Editing `.cursor/inferno-mcp-server.mjs` does NOT hot-reload the running MCP server — Claude Code keeps the process in memory until next session start. After patching the MCP file, the fix is on disk but the old code keeps serving until the session restarts. Verify a reload by checking whether `amp_write` entries have a `file` field (new wrapper) vs. a `source` field (old wrapper)."*

This is the bug that became the 0.44.1 boot-stamp feature. infernoflow now writes `.ai-memory/.mcp-runtime.json` at MCP boot with the running version; `infernoflow doctor` and `infernoflow setup` compare it to the installed CLI version and tell the user when they need to restart.

### `infernoflow status` lied about entry counts

> `lib/commands/status.mjs` — *"`infernoflow status` had its own private `sessions.jsonl` reader… missed the branch-aware merged read. Result: `status` reports the legacy entry count, hiding everything written under the new branch-aware layout."*

A bug in infernoflow itself, caught by dogfooding infernoflow. We added a `reader-sweep.test.mjs` regression that pins every CLI consumer through the merged `readEntries()`, so this class of drift cannot silently happen again.

### Synthetic input bypasses React's flushing

> `src/pages/CardDetail.tsx` — *"CardDetail's commit-on-blur for description fails when textarea value is set via the React-aware value setter + synthetic input + synthetic blur fired in the same tick: React hasn't flushed the setDescription state update yet, so commitDescription reads the stale `""` value and the (next === oldValue) early-return skips the PATCH. Real-user flow is fine (humans pause between typing and tabbing away). Caught with synthetic Playwright-style input only."*

A subtle one. The bug only manifests under headless test conditions, never under a real user. The capture says *exactly* that, so the next agent doesn't spend an hour "fixing" something that isn't broken for humans.

### `@dnd-kit` drag not triggerable from synthetic PointerEvents

> `src/pages/BoardView.tsx` — *"`@dnd-kit` drag activation is NOT triggerable via synthetic PointerEvents dispatched from the headless preview… For end-to-end verification, exercise `api.moveCard` directly via the page's own bundle (`await import('/src/lib/api.ts')`) and reload to confirm persistence."*

Tells a future session: don't go down the rabbit hole of trying to script the drag — verify via the API path. Saves hours.

---

## 2. Patterns — the "we do it this way" that the code can't fully express

These are not bugs. They're conventions the agent codified as it built, so the next session doesn't have to re-derive them.

### Position spacing with a 1024 step

> `server/src/routes/columns.ts` — *"Position assignment for ordered children: next position = max(existing) + 1024. The 1024 step leaves room for ~10 inline inserts between any two siblings without renumbering."*

You can read the constant in the code, but the *why* (insert-between-without-renumber) only lives in the head of whoever made the call. Now it lives on disk.

### Cross-entity auth is one query that returns parent + caller's role

> `server/src/access.ts` — *"Cross-entity authorization helpers… run in a single DB query that pulls the parent entity AND the caller's membership row via Prisma nested-select on `memberships: { where: { userId } }`. Returns 404 (not 403) when not a member to avoid leaking entity existence. Handlers stay flat: `requireAuth → assertX → check canWrite(role) → mutate`."*

The 404-not-403 choice is a *policy*, not a bug. Without this capture, a future agent "cleaning up" the responses would happily change it to 403 and silently leak workspace existence to outsiders.

### Vertical-slice shape for new capabilities

> *"Zod schema in `server/src/schemas/<feature>.ts` → handler in `server/src/routes/<feature>.ts` (validate → assertMember → mutate-or-read → return) → frontend client method in `src/lib/api.ts` → UI component or inline form. Each slice is ~150 lines total."*

A scaffold for "how to add a new thing here." Reading existing code, you could *guess* this shape. Reading the captured pattern, you don't have to.

### Last-admin protection invariant

> `server/src/routes/members.ts` — *"Every workspace must always have ≥ 1 ADMIN. Enforced in BOTH PATCH role (demotion) and DELETE membership (removal incl. self-leave). `countAdminsExcept(workspaceId, targetMembershipId)` returns admin count if the target is excluded; if zero, return 409 LAST_ADMIN_PROTECTION."*

The invariant is the rule. The 409 code is the contract. If you refactor either route and miss the other, this capture catches it before the test does.

### Click vs drag separation via activation distance

> `src/pages/BoardView.tsx` — *"`@dnd-kit`'s `PointerSensor` with `activationConstraint:{distance:5}` only starts a drag when pointer-down moves >5px before pointer-up. So a tap (<5px) doesn't trigger drag — `onClick` still bubbles. SortableCard spreads dnd listeners AND an onClick handler on the same div; the click only fires when isDragging is false. No need for a separate drag handle."*

A pattern someone smarter than the agent figured out, captured so the next agent doesn't add a drag handle.

### Avatars and lazy-loaded assignee picker

> `src/components/Avatar.tsx` — *"Reusable Avatar renders deterministic initials + stable color from a name hash, so the same user is always the same color across views. AssigneePicker in CardDetail lazy-loads the workspace members list — only fires `api.listMembers` on first open of the dropdown, not on every card click. Avoids a fetch per card-click on boards with N cards."*

Performance subtlety. Reading `Avatar.tsx` shows the hash; reading `CardDetail.tsx` shows the lazy load. The *reason* both exist together — single visual identity + no per-click fetch — lives only in the capture.

---

## 3. Decisions — the road not taken

These matter most when a future session is tempted to "improve" something that was a deliberate trade-off.

### Opaque session tokens, not JWTs. bcryptjs, not bcrypt.

> `server/src/auth.ts` — *"Opaque session tokens in a Session table (not JWTs), httpOnly + sameSite=lax cookie, bcryptjs (pure JS, no native bindings). Picked opaque tokens so we can revoke per-session without ripping out infra (logout-all is just `deleteMany` on the Session table). Picked bcryptjs over bcrypt to avoid platform-specific binaries — this project gets used as dogfood across machines."*

The number of times an agent has tried to "modernize" session auth by switching to JWTs is non-trivial. This capture is the answer to "why aren't we using JWTs?": *because revocation*.

### SQLite for v0, schema portable later

> `server/prisma/schema.prisma` — *"Switched the kanban backend from Postgres to SQLite for v0 — chose zero-setup over production-realism so we could exercise infernoflow against a real app fast; Prisma schema is portable so swapping later is one config line."*

Without this, a future "let's just set up Postgres" PR looks reasonable. With this, the trade-off is on the table.

### No drag-reorder in slice 1

> `src/pages/BoardView.tsx` — *"No drag-reorder in this slice — the position field is set server-side at tail (`max+1024`). Adding `@dnd-kit` + the reorder endpoint is its own scenario, sequenced after enough cards/columns exist to make reorder a real concern."*

Captures both *what wasn't done* and *why deferring was the right call*. The 1024 spacing pattern (above) is the seed for when reorder lands.

### Comment authorization split: edit vs delete

> `server/src/routes/comments.ts` — *"Comment authorization model: edit is AUTHOR-ONLY (even an admin cannot put words in another user's mouth); delete is AUTHOR OR workspace ADMIN (admins moderate, members can only revoke their own). Three distinct 403 codes (NOT_COMMENT_AUTHOR for non-author edit, FORBIDDEN for moderation by non-admin, FORBIDDEN for viewer write) so UI can branch on cause."*

The asymmetry is intentional. A future "let's just check admin role on both" cleanup would quietly let admins edit other people's words. This capture says: don't.

### Assignee scoped to workspace membership

> `server/src/routes/cards.ts` — *"`assigneeId` is a User reference but validated as a Membership-scoped reference at write time. A non-member assignment returns 409 ASSIGNEE_NOT_MEMBER. Reason: an assignee who isn't in the workspace can't see their own task — that's a real bug class for the kanban (silent data with no visible owner)."*

The bug class — *silent data with no visible owner* — is the kind of thing you only learn by hitting it once. Now everyone who touches this code knows.

---

## 4. What this means

The bugs above were not exotic. They're the everyday texture of building software: framework quirks, platform quirks, authorization edges, headless-test traps. The thing about them is:

- **The code doesn't tell you.** You can re-read `vite.config.ts` for hours without seeing that `changeOrigin: true` will break invite links.
- **Git history barely tells you.** The commit that fixed the invite-token burn says "fix invite accept." The *reason* — that an already-member click was burning the token — lives in the discussion, not the diff.
- **The next session can't infer them.** A fresh agent reading the repo cold will not re-derive any of this without re-experiencing the failure.

So infernoflow's job, narrowly stated, is: **the next session boots warm.** It opens, reads the rule files (regenerated from `.ai-memory/`), and already knows that the Vite proxy will lie to it about the host, that Prisma will EPERM if tsx is watching, that the invite token must not burn for already-members.

That's the whole product. JSONL on disk, an MCP server, three rule files your IDE already reads.

---

## Want to read the raw entries?

Everything above is in [infernotest_01](https://github.com/ronmiz/infernotest_01) under `.ai-memory/sessions.jsonl` (and, for sessions captured after v0.44, the branch-routed files under `.ai-memory/branches/`). They are ordinary JSONL. Each line is a single AMP entry with `{ type, msg, ts, id, file?, line?, tags? }`. Read them with `infernoflow ask "<keyword>"` or just `cat` them.

The point of capturing isn't to publish a story. It's so the *next* session doesn't have to re-derive what the *last* session already learned. This document is a side effect.
