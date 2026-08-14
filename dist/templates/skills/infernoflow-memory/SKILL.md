---
name: infernoflow-memory
description: >-
  Persistent cross-session memory for this project via the infernoflow CLI. Use
  whenever you discover a gotcha, make a non-obvious decision, hit a dead end, or
  learn a lasting user preference — capture it with `infernoflow log` so the next
  session starts warm instead of cold. Also use to drop a `infernoflow bookmark`
  at natural stopping points or whenever the user says "bookmark this" / "save
  this point", and to load prior memory at the start of work. Triggers: gotcha,
  "that was surprising", "turns out", dead end, "doesn't work", decision, "let's
  go with", "because", preference, "I prefer", bookmark, checkpoint, resume,
  "where were we", start of a work session in a repo that has an infernoflow memory store (.ai-memory/).
---

# infernoflow memory

This project uses **infernoflow** — a local, git-tracked memory layer that stores
what you can't infer from the code: the gotchas you hit, the decisions you made
*and why*, the dead ends you already tried, and the user's durable preferences.
Memory lives in `inferno/sessions.jsonl` and is auto-injected into the rule files
this IDE already reads. Your job is to keep that memory alive so the next session
(yours or a teammate's) starts warm.

Capture is **balanced**: log the things that genuinely save future time, and skip
the noise. When unsure, prefer logging a real gotcha over staying silent — but
never log routine steps or anything obvious from reading the code.

## Start warm

At the start of substantive work in a project that has an infernoflow memory store
(`.ai-memory/`), load
prior memory before diving in:

```
infernoflow recap
```

If you're looking for something specific ("did we decide on the auth approach?"),
ask memory directly:

```
infernoflow ask "auth approach"
```

Do this once per session, not repeatedly.

## Capture as you work

Run `infernoflow log` the moment one of these happens — capture it right away,
while the detail is fresh, not at the end:

**Gotcha** — something behaved contrary to a reasonable expectation and cost time:
```
infernoflow log "API expects multipart/form-data, rejects application/json" --type gotcha
```

**Decision with a because** — a non-obvious choice a future reader would question:
```
infernoflow log "axios over fetch — needed upload progress events" --type decision --result worked
```

**Dead end** — something you tried that did NOT work, so nobody repeats it:
```
infernoflow log "tried streaming upload, server rejected chunked transfer" --type gotcha --result failed
```

**Preference** — a durable thing the user wants, stated or clearly implied:
```
infernoflow log "user prefers inline error handling over try/catch wrappers" --type preference
```

Keep each message to one specific sentence. Always include the *because* for a
decision. In non-interactive/automation contexts add `--quiet`.

### Do log
- A gotcha that would waste time again (config quirk, undocumented API behavior, env-specific bug).
- A decision whose reasoning isn't visible in the diff.
- A dead end / abandoned approach.
- A user preference that should hold across sessions.

### Do NOT log
- Routine steps or anything obvious from reading the code.
- Secrets, tokens, credentials, or personal data.
- Duplicates — if it's already in memory (`infernoflow ask`), don't repeat it.
- Vague notes ("fixed a bug") with no reusable signal.

## Bookmark at stopping points

A bookmark is a named resume point. On Claude Code it auto-harvests the recent
transcript into the bookmark's context — deterministic, no AI calls.

Drop one:
- **Always** when the user says "bookmark this", "save this point", "checkpoint", or similar.
- At a **natural milestone** ("auth flow works end to end").
- **Before a risky change** ("before the state-management refactor") as a safety net.

```
infernoflow bookmark "auth flow works end to end"
infernoflow bookmark "before the SP refactor" --note "current approach: context provider per feature"
```

Recall / list / remove:
```
infernoflow bookmark list
infernoflow bookmark show "auth flow"
infernoflow bookmark rm "auth flow"
```

When the user returns and asks "where were we?", run `infernoflow bookmark list`
(or `infernoflow recap`) and continue from the most relevant marker.

## Notes
- All commands are local and safe; memory is a plain JSONL file under `inferno/`.
- If a project has no infernoflow memory store (`.ai-memory/`), this skill does not
  apply — memory is opt-in per repo (`infernoflow init` creates it).
- One log per distinct insight; batching many into one line loses searchability.
