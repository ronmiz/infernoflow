# Fresh-install verification — 2026-07-10

Ran a clean end-to-end user flow in the Cowork Linux sandbox (equivalent to a fresh machine — no prior npm-global, no prior `.ai-memory/`, no prior IDE config).

## Steps executed

```bash
mkdir /tmp/fresh-user-test/my-project && cd $_
git init
npm install -g infernoflow    # first-run install
infernoflow --version         # → 0.44.11 ✓
infernoflow init --yes        # 60-second setup
infernoflow log "test entry from fresh install" --type gotcha
infernoflow status
```

## Result — PASS ✓

**All 8 setup steps completed silently:**

1. `.cursorrules` created
2. `CLAUDE.md` created
3. `.github/copilot-instructions.md` created
4. `.cursor/inferno-mcp-server.mjs` copied
5. MCP server registered in `~/.claude.json`
6. MCP server registered in `.vscode/mcp.json` (Copilot Chat)
7. MCP server registered in `.cursor/mcp.json`
8. `infernoflow` tools pre-approved in `.claude/settings.json`

**Init prints the expected next-steps block** (`status`, `log`, `switch`, `recap` + clipboard tip).

**Files created (14 total)** — all in expected locations:

```
CLAUDE.md
.cursorrules
.cursor/mcp.json
.cursor/inferno-mcp-server.mjs
.github/copilot-instructions.md
.vscode/mcp.json
.claude/settings.json
.gitattributes
.gitignore
.ai-memory/.last-cli-version
.ai-memory/sessions.jsonl
.ai-memory/amp.json
.ai-memory/branches/master.jsonl
```

**First `log` writes cleanly to `sessions.jsonl`:**

```json
{"type":"note","msg":"infernoflow init complete — memory loop is live. Run `infernoflow status` to verify.","ts":1783692087447,"id":"amp_01KX65AM4R0QW62289ECW7R3XJ","source":"init","meta":{"agent":"infernoflow"}}
{"type":"gotcha","msg":"test entry from fresh install","ts":1783692087483,"id":"amp_01KX65AM5VS2JR9EM3C3C7STF3","meta":{"agent":"human"}}
```

**`status` output** is coherent (2 entries, 1 gotcha, "ready" state).

## Verdict

**Fresh-user flow is clean.** No errors, no warnings, no missing dependencies, no confusing output. First-time user experience is what the README promises.

**One tiny note for docs:** the `Registered MCP server in ~/.claude.json` line appears even on machines that don't have Claude Code installed. Not a bug — the config just sits there and gets picked up if/when Claude Code lands on the machine later. Might be worth a one-line clarification in the FAQ so users don't wonder "wait, but I don't have Claude installed."

Safe to launch.
