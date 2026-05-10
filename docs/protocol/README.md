# infernoflow-amp

> The **AI Memory Protocol (AMP)** — open, vendor-neutral spec for cross-tool AI session memory.
> Any AMP-compatible tool (CLI, IDE extension, AI agent) can read and write `.ai-memory/sessions.jsonl`.

[![npm version](https://img.shields.io/npm/v/infernoflow-amp.svg?color=orange)](https://www.npmjs.com/package/infernoflow-amp)
[![spec v1.0](https://img.shields.io/badge/AMP-v1.0-orange)](./PROTOCOL.md)

## What this is

This package contains:

- The full **[AMP v1.0 specification](./PROTOCOL.md)** (~400 lines).
- A **zero-dependency TypeScript reference implementation** — read, write, generate handoffs, inject into platform context files, validate entries against the schema.
- **JSON Schemas** for entries (`schemas/entry.schema.json`) and project metadata (`schemas/amp.schema.json`).

## Install

```bash
npm install infernoflow-amp
```

## Quick use

```ts
import { AMP } from 'infernoflow-amp';

const amp = new AMP(process.cwd());
amp.init();
amp.gotcha("API requires auth header even for public endpoints", "src/api.ts", 42);
amp.decision("Use axios for all HTTP — consistency");
amp.attempt("Tried fetch — CORS issues with the dev proxy");

const handoff = amp.handoff();   // markdown, ready to paste into any AI chat
amp.inject(process.cwd());       // auto-update CLAUDE.md / .cursorrules / copilot-instructions.md
```

## Why a protocol, not just a library

Every AI coding tool (Copilot, Cursor, Claude, Windsurf, the next one) ships its own context format — `.cursorrules`, `copilot-instructions.md`, project knowledge uploads. None of them share. AMP is the file-based, JSONL-friendly, append-only common ground:

- One file (`sessions.jsonl`), one entry per line, one schema.
- No database, no server, no vendor lock-in.
- Git-friendly merges (each line independent).
- Zero deps to read or write — anything that parses JSON can speak it.

The first AMP-Full implementation is [**infernoflow**](https://www.npmjs.com/package/infernoflow), the CLI + MCP server + VS Code extension that ships with this protocol. We expect more.

## Conformance levels

| Level | Requirements |
|---|---|
| **AMP Reader** | Can parse `sessions.jsonl`, filter by type, present to AI |
| **AMP Writer** | Can append valid entries to `sessions.jsonl` |
| **AMP Full** | Reader + Writer + handoff generation + injection into platform files |
| **AMP MCP** | Full + exposes the standard MCP tools (`amp_read`, `amp_write`, `amp_handoff`, `amp_search`, `amp_health`) |

See [PROTOCOL.md §13](./PROTOCOL.md#13-conformance-levels) for the formal definitions.

## Spec versioning

Current version: **1.0**. SemVer applies — major bumps are breaking schema changes, minor bumps add optional fields or entry types, patches are clarifications.

## License

MIT.
