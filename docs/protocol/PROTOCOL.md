# AI Memory Protocol (AMP) — Specification v1.0

> **Status:** Draft  
> **Author:** infernoflow  
> **Date:** May 2026  
> **License:** MIT

---

## Abstract

The AI Memory Protocol (AMP) defines an open, portable format for storing and sharing developer session memory across AI coding tools. Any tool — Copilot, Cursor, Claude, Windsurf, or future AI agents — can read and write AMP files to provide persistent, cross-session context.

AMP is to AI coding assistants what `.gitignore` is to version control: a simple, universal standard that every tool understands.

---

## 1. Design Principles

| Principle | Rationale |
|-----------|-----------|
| **File-based** | No database, no server. Lives in the repo alongside code. |
| **Append-only** | New entries are appended. No overwrites. History is preserved. |
| **JSONL format** | One JSON object per line. Easy to parse, stream, merge, and diff. |
| **Git-friendly** | Merge conflicts are trivial (each line is independent). |
| **Zero dependencies** | Any language can read/write AMP with stdlib JSON parsing. |
| **Tool-agnostic** | No vendor lock-in. Works with any AI coding tool. |
| **Progressive** | Start with one file. Add optional metadata as needed. |

---

## 2. File Structure

### Minimum Viable AMP (1 file)

```
.ai-memory/
└── sessions.jsonl       # Required — the memory itself
```

### Full AMP Structure (optional extras)

```
.ai-memory/
├── sessions.jsonl       # Required — all memory entries
├── amp.json             # Optional — project metadata & config
├── handoff.md           # Optional — generated handoff for AI agents
└── agents/              # Optional — saved workflow agents
    └── {name}.json
```

---

## 3. Core Schema: Memory Entry

Each line in `sessions.jsonl` is a single JSON object conforming to this schema:

```jsonc
{
  // Required fields
  "type": "gotcha",              // Entry type (see §3.1)
  "msg": "API requires auth header even for public endpoints",
  "ts": 1714444800000,           // Unix timestamp (milliseconds)

  // Optional fields
  "id": "amp_01HXYZ...",         // Unique ID (ULID recommended)
  "file": "src/api.js",          // Relative file path
  "line": 42,                    // Line number (1-indexed)
  "function": "fetchItems",      // Function/method name
  "tags": ["auth", "api"],       // Freeform tags for grouping
  "source": "vscode-extension",  // What created this entry
  "tool": "copilot",             // Which AI tool was active
  "session": "2026-05-03",       // Session identifier
  "confidence": 0.9,             // How certain (0-1, for auto-captured entries)
  "related": ["amp_01HABC..."],  // Links to related entries
  "meta": {}                     // Arbitrary metadata (extensible)
}
```

### 3.1 Entry Types

| Type | Meaning | AI Behavior |
|------|---------|-------------|
| `gotcha` | Known landmine / pitfall | AI must avoid this trap |
| `decision` | Architectural choice made | AI must follow this, not revisit |
| `attempt` | Something tried that failed | AI must NOT retry this approach |
| `note` | General context | AI should be aware of this |
| `detection` | Auto-captured observation | AI treats as low-confidence context |
| `pattern` | Recurring workflow pattern | AI can suggest automation |

#### Reserved for Future

| Type | Purpose |
|------|---------|
| `preference` | Developer coding style preferences |
| `constraint` | Hard constraints (e.g., "no external APIs") |
| `dependency` | Why a dependency was added/removed |
| `migration` | Breaking change context |

### 3.2 Entry ID Format

IDs are optional but recommended for cross-referencing. Format: `amp_` + ULID (26 chars).

```
amp_01HXYZ4K8V3P2Q5W7N9R0T6M1A
```

ULIDs are preferred over UUIDs because they are:
- Sortable by time
- URL-safe
- 26 characters (compact)

---

## 4. Project Metadata: `amp.json`

Optional. Declares project info for tools that read AMP.

```jsonc
{
  "amp": "1.0",                  // Protocol version
  "project": "my-app",          // Project identifier
  "stack": {
    "language": "typescript",
    "framework": "react",
    "runtime": "node"
  },
  "config": {
    "autoCapture": true,         // Whether passive capture is enabled
    "maxEntries": 1000,          // Max entries before rotation
    "rotationStrategy": "archive", // "archive" | "prune-old" | "none"
    "inject": ["claude", "copilot", "cursor"]  // Which tools to inject into
  }
}
```

---

## 5. Handoff Document: `handoff.md`

Generated from `sessions.jsonl`. This is the artifact that gets **pasted into AI chats** or **auto-injected** into AI context files.

### 5.1 Generation Rules

1. Gotchas listed first (highest priority for AI)
2. Failed attempts second (prevent repetition)
3. Decisions third (follow these)
4. Notes last (background context)
5. Most recent entries take priority over older ones
6. Max 20 entries in a single handoff (configurable)

### 5.2 Output Format

```markdown
# 🔥 AI Memory Handoff

> Project: my-app | Entries: 12 | Health: B (65/100)

## ⚠️ GOTCHAS — Read First
1. **API requires auth header even for public endpoints** (`src/api.js:42`)
2. **Bootstrap modal z-index conflicts with toast notifications**

## ❌ FAILED — Don't Repeat
1. ~~Tried using fetch instead of axios — CORS issues with the proxy~~
2. ~~Attempted to lazy-load the search component — breaks SSR~~

## ✓ DECISIONS — Follow These
1. Use axios for all HTTP calls (consistency)
2. All new components use functional style + hooks

## 📝 Context
- Search currently filters client-side (no backend endpoint yet)
```

---

## 6. Injection Targets

AMP tools SHOULD auto-inject handoff content into platform-specific files:

| Platform | Target File | Method |
|----------|-------------|--------|
| GitHub Copilot | `.github/copilot-instructions.md` | Append section |
| Cursor | `.cursorrules` | Append section |
| Claude (CLAUDE.md) | `CLAUDE.md` | Append section |
| Windsurf | `.windsurfrules` | Append section |
| Generic MCP | Via MCP tool response | Return handoff text |

### 6.1 Injection Format

Injected content MUST be wrapped in markers for clean updates:

```markdown
<!-- AMP:START -->
## AI Memory (auto-generated — do not edit)

[handoff content here]

<!-- AMP:END -->
```

Tools MUST replace content between markers on each injection (not append duplicates).

---

## 7. Tool Integration

### 7.1 Reading AMP (for AI tools)

Any AI tool can read AMP by:

1. Check if `.ai-memory/sessions.jsonl` exists in workspace root
2. Parse JSONL (one JSON object per line)
3. Filter by type, recency, or file relevance
4. Present to AI as context

### 7.2 Writing AMP (for capture tools)

Any tool can write AMP by:

1. Construct a valid entry object (see §3)
2. Append as a single JSON line to `.ai-memory/sessions.jsonl`
3. Ensure file ends with `\n`

### 7.3 MCP Tool Interface

AMP-compliant MCP servers SHOULD expose these tools:

| Tool | Purpose | Input |
|------|---------|-------|
| `amp_read` | Get relevant entries for current context | `{ file?, type?, query?, limit? }` |
| `amp_write` | Log a new entry | `{ type, msg, file?, line?, tags? }` |
| `amp_handoff` | Generate handoff document | `{ format?: "markdown" \| "json" }` |
| `amp_search` | Search entries by keyword | `{ query, type? }` |
| `amp_health` | Get session health score | `{}` |

---

## 8. Health Scoring

AMP defines a standard health score (0–100) based on entry diversity:

| Component | Max Points | Formula |
|-----------|-----------|---------|
| Gotchas | 40 | `min(gotchas × 20, 40)` |
| Decisions | 30 | `min(decisions × 15, 30)` |
| Attempts | 20 | `min(attempts × 15, 20)` |
| Notes | 10 | `min(notes × 5, 10)` |

### Grades

| Score | Grade | Meaning |
|-------|-------|---------|
| 80–100 | A | Excellent session memory |
| 60–79 | B | Good coverage |
| 40–59 | C | Partial — missing some types |
| 20–39 | D | Minimal memory logged |
| 0–19 | F | Essentially no memory |

---

## 9. Rotation & Archival

When `sessions.jsonl` exceeds `config.maxEntries`:

### Strategy: `archive`
- Move oldest entries to `.ai-memory/archive/YYYY-MM.jsonl`
- Keep most recent entries in main file
- Handoff generator only reads main file

### Strategy: `prune-old`
- Remove entries older than 90 days
- Keep all gotchas regardless of age (they're always relevant)

### Strategy: `none`
- File grows unbounded (user manages manually)

---

## 10. Merge Behavior (Git)

AMP is designed for conflict-free merging:

- Each line is an independent entry
- Git's default line-based merge handles concurrent appends
- If both branches append entries, both are kept (correct behavior)
- Duplicate entries (same `id`) should be deduplicated by readers

### Recommended `.gitattributes`

```
.ai-memory/sessions.jsonl merge=union
```

This tells Git to keep all lines from both sides on merge conflicts.

---

## 11. Privacy & Security

### 11.1 What MUST NOT Be Stored

- Passwords, tokens, API keys, secrets
- PII (personally identifiable information)
- File contents (only paths and line numbers)
- Credentials or environment-specific values

### 11.2 `.gitignore` Considerations

By default, `.ai-memory/` SHOULD be committed to the repo (it's useful context for the team). However, projects with sensitive context may choose to gitignore it:

```gitignore
# Uncomment if memory contains sensitive project context
# .ai-memory/
```

### 11.3 Entry Sanitization

Tools writing AMP entries SHOULD:
- Strip absolute file paths (use relative only)
- Reject entries containing patterns matching secrets (`sk-`, `ghp_`, `-----BEGIN`)
- Warn if entry `msg` exceeds 500 characters

---

## 12. Versioning

The protocol version follows SemVer:
- **Major:** Breaking schema changes (new required fields, type renames)
- **Minor:** New optional fields, new entry types, new features
- **Patch:** Clarifications, typo fixes

Current version: `1.0`

Tools MUST check `amp.json → amp` field (if present) and handle unknown fields gracefully (ignore, don't error).

---

## 13. Conformance Levels

| Level | Requirements |
|-------|-------------|
| **AMP Reader** | Can parse `sessions.jsonl`, filter by type, present to AI |
| **AMP Writer** | Can append valid entries to `sessions.jsonl` |
| **AMP Full** | Reader + Writer + handoff generation + injection into platform files |
| **AMP MCP** | Full + exposes MCP tools per §7.3 |

---

## 14. Example: Complete Workflow

```
1. Developer installs AMP-compatible tool (infernoflow, or any compliant tool)
2. Tool creates .ai-memory/sessions.jsonl (empty)
3. Developer works with AI, hits a gotcha
4. Tool logs: {"type":"gotcha","msg":"CORS blocks localhost:3000→API","ts":1714444800000,"file":"src/api.js"}
5. Developer switches to a different AI tool (e.g., Cursor → Copilot)
6. New tool reads .ai-memory/sessions.jsonl
7. AI immediately knows about the CORS issue
8. No context lost. No repeated mistakes.
```

---

## Appendix A: Comparison with Existing Formats

| Format | Scope | Dynamic? | Cross-tool? | Typed Entries? |
|--------|-------|----------|-------------|----------------|
| `.cursorrules` | Cursor only | No (static) | No | No |
| `copilot-instructions.md` | Copilot only | No (static) | No | No |
| Claude project knowledge | Claude only | No (manual) | No | No |
| **AMP (this spec)** | All tools | Yes (appends) | Yes | Yes |

---

## Appendix B: Migration from Existing Formats

### From infernoflow `inferno/sessions.jsonl`

```bash
# Direct rename — format is already AMP-compatible
mkdir .ai-memory
cp inferno/sessions.jsonl .ai-memory/sessions.jsonl
```

### From `.cursorrules`

```bash
amp import --from .cursorrules
# Creates a single "note" entry with the rules content
```

### From `copilot-instructions.md`

```bash
amp import --from .github/copilot-instructions.md
# Parses sections into typed entries
```

---

*End of specification.*
