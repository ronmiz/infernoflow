# 🔥 infernoflow

> The forge for liquid code — keep capabilities, contracts, and docs in sync with your codebase.

## What it does

infernoflow ensures that when your code changes, your **capability contracts** and **documentation** stay in sync. It prevents "semantic drift" — where code evolves but no one knows what the system can actually do.

```
inferno/
├── contract.json       ← what your system promises to do
├── capabilities.json   ← registry of each capability
├── scenarios/          ← test scenarios covering each capability
└── CHANGELOG.md        ← history of capability changes
```

## Install

```bash
npm install -g infernoflow
# or use without installing:
npx infernoflow init
```

## Quick Start

```bash
# 1. Scaffold in your project root:
npx infernoflow init

# 2. See your contract health:
infernoflow status

# 3. When you add a feature, let AI update the docs:
infernoflow suggest "added email notifications and user profiles"

# 4. Validate everything:
infernoflow check

# 5. In CI / pre-push hook:
infernoflow doc-gate
```

## Adopt Existing Project

Use this when your project already has code and you want InfernoFlow to bootstrap from current behavior.

```bash
# from existing project root
infernoflow init --adopt
```

Non-interactive adoption:

```bash
infernoflow init --adopt --yes
```

Override detected stack during adoption:

```bash
infernoflow init --adopt --lang ts --framework angular --project-type frontend
```

C# / ASP.NET example:

```bash
infernoflow init --adopt --lang cs --framework aspnet --project-type backend --report-human-only
```

JSON report for CI/logging:

```bash
infernoflow init --adopt --yes --report-json
```

JSON-only output (clean machine output, no text logs):

```bash
infernoflow init --adopt --yes --report-json-only
```

Human-only output (visual report only, no JSON block):

```bash
infernoflow init --adopt --yes --report-human-only
```

What adoption creates:
- `inferno/contract.json` (inferred capability baseline)
- `inferno/capabilities.json` (inferred registry)
- `inferno/scenarios/adoption_baseline.json` (coverage baseline)
- `inferno/adoption_profile.json` (detected components, display fields, external libraries, UI layout, styling hints)
- `inferno/adoption_profile.json` (detected components, display fields, external libraries, UI layout, styling hints, API call map)
- `inferno/context-state.json` (saved development profile: language/framework/project type)
- `inferno/CHANGELOG.md` (adoption entry)

Safety:
- Existing `inferno/` is not overwritten unless `--force` is provided.
- Adoption prints an inferred capability report with source-file hints and confidence.

## Recommended Workflow

```bash
# start a feature
infernoflow context --intent "add search to tasks" --working "frontend search UX"

# generate implementation prompt(s) for coding agent
infernoflow implement "add server-side task search endpoint" --mode both

# build code changes

# sync inferno contract with AI assistance
infernoflow suggest "added task search by title and due date"

# verify no drift
infernoflow status
infernoflow check
```

## Team SOP (Developer Workflow)

Use this checklist for every feature branch:

1) **Set intent**
```bash
infernoflow context --intent "what feature is being built" --working "current slice"
```

2) **Build code**
- Implement UI/API/tests as usual.

3) **Sync contract with `suggest`**
```bash
infernoflow suggest "plain-language description of what changed"
```
- Paste generated prompt into your AI.
- Paste AI JSON back into terminal.
- Approve with `y` only after preview looks correct.

4) **Validate before commit**
```bash
infernoflow status
infernoflow check
```

5) **CI-safe checks**
```bash
infernoflow status --json
infernoflow check --json
infernoflow doc-gate --json
```

6) **Definition of done**
- Capability changes are reflected in `inferno/contract.json`.
- New/changed capabilities exist in `inferno/capabilities.json`.
- Scenario coverage updated under `inferno/scenarios/`.
- `inferno/CHANGELOG.md` updated under `## Unreleased`.
- `infernoflow check` passes.

## Commands

| Command | Description |
|---|---|
| `infernoflow init` | Interactive scaffold — creates `inferno/` in your project |
| `infernoflow status` | At-a-glance health of your contract |
| `infernoflow suggest` | Generate an AI prompt, apply capability updates |
| `infernoflow implement` | Generate implementation prompts for coding agents |
| `infernoflow run` | One-command local-model flow with validation and rollback |
| `infernoflow pr-impact` | Analyze changed files and infer capability/doc drift |
| `infernoflow sync --auto` | Deterministic sync flow for agents (skeleton) |
| `infernoflow check` | Full validation: contract, capabilities, scenarios, changelog |
| `infernoflow doc-gate` | Fails if code changed but docs weren't updated |
| `infernoflow context` | Build/persist AI session context for this project |

### Options

```bash
infernoflow init --force       # overwrite existing files
infernoflow init --yes         # skip prompts, use defaults
infernoflow init --adopt       # infer baseline from existing project
infernoflow init --adopt --lang ts --framework react --project-type frontend
infernoflow init --adopt --report-human-only
infernoflow suggest "..."      # describe what changed
infernoflow implement "..." --mode both
infernoflow implement "..." --mode cursor
infernoflow implement "..." --mode generic
infernoflow implement "..." --mode both --copy
infernoflow run "add favorite badge to tasks"
infernoflow run "sync check" --dry-run
infernoflow run "sync check" --json
infernoflow pr-impact
infernoflow pr-impact --json
infernoflow sync --auto
infernoflow sync --auto --json
npm run inferno:hooks      # install local git hooks (after init)
infernoflow check --json       # machine-readable output for CI
infernoflow check --skip-doc-gate
infernoflow status --json      # machine-readable status summary
infernoflow doc-gate --json    # machine-readable doc-gate result
```

## `infernoflow suggest` — AI-powered updates

When you add a feature, just describe it in plain language. infernoflow generates a prompt you can paste into **any AI** (Claude, ChatGPT, Copilot, Cursor, etc.), then applies the suggested changes automatically.

```bash
infernoflow suggest "added payment processing and invoice generation"
```

**What happens:**
1. infernoflow reads your current contract state
2. Generates a structured prompt with full context
3. You paste it into your AI of choice
4. Paste the JSON response back
5. infernoflow previews the changes and asks for confirmation
6. On approval — updates `contract.json`, `capabilities.json`, `scenarios/`, and `CHANGELOG.md`

**Example output:**
```
Proposed Changes

  Summary: Added payment processing and invoice generation functionality.

  + New capabilities:
      ProcessPayment — Process Payment
      GenerateInvoice — Generate Invoice

  ~ Scenario updates:
      [update] happy_path.json

  📝 Changelog: - Add payment processing and invoice generation capabilities.

  Apply these changes? (y/n)
```

Works with any AI — Claude, ChatGPT, GitHub Copilot, Cursor, or your own setup.

## `infernoflow run` — zero copy/paste flow

Run one command and infernoflow will:
1. Detect drift (`pr-impact`)
2. Generate suggestion via local model
3. Apply inferno updates
4. Validate with `check`
5. Roll back automatically if validation fails

```bash
infernoflow run "add favorite badge to tasks and filter by favorite"
```

Machine mode:

```bash
infernoflow run "sync check" --json
```

Local model configuration (required):

```bash
# default provider: ollama
set INFERNO_LOCAL_PROVIDER=ollama
set INFERNO_LOCAL_ENDPOINT=http://127.0.0.1:11434/api/generate
set INFERNO_LOCAL_MODEL=llama3.1:8b
```

Optional OpenAI-compatible local server:

```bash
set INFERNO_LOCAL_PROVIDER=openai
set INFERNO_LOCAL_ENDPOINT=http://127.0.0.1:1234/v1/chat/completions
set INFERNO_LOCAL_MODEL=local-model
set INFERNO_LOCAL_API_KEY=local
```

## `infernoflow implement` — code-agent execution prompts

Generate coding prompts from your project context and inferno contract:

```bash
infernoflow implement "add pagination to tasks" --mode both
```

Modes:
- `--mode cursor`: Cursor-specific coding prompt
- `--mode generic`: generic prompt for any coding agent
- `--mode both`: print both sections (default)
- `--copy`: copy selected prompt output to clipboard

Recommended chain:
1) `infernoflow context --intent "..."`
2) `infernoflow implement "..."`
3) run the coding agent and apply code changes
4) `infernoflow suggest "..."`
5) `infernoflow check`

## Troubleshooting

- `Unknown command: suggest`:
  - Run `infernoflow --help` and confirm `suggest` appears.
  - If using `npx`, force a specific version: `npx infernoflow@latest --help`.
- `infernoflow: command not found`:
  - Use `npx infernoflow ...` or install globally: `npm install -g infernoflow`.
- `npm publish` fails with existing version:
  - Bump version first (`npm version patch|minor|major`) then publish.
- `status` or `check` fails due to missing inferno files:
  - Run `infernoflow init` at project root.
- Windows/Git Bash path confusion:
  - Prefer `node bin/infernoflow.mjs --help` from package root for local debugging.

## Why infernoflow?

**The problem:** AI-assisted development moves fast. Code changes daily. But what does the system *actually do*? What changed? What's covered?

**The metaphor:** A forge (כיבשן). Metal becomes liquid — flexible, shapeable. The forge is the controlled environment where that change happens safely, with molds (contracts) and tempering (validation).

**The principle:** Liquid where you want flexibility. Solid where you need safety.

## CI Integration

```yaml
# .github/workflows/ci.yml
- name: infernoflow run
  run: npx infernoflow run "sync check" --json
  env:
    INFERNO_LOCAL_PROVIDER: ollama
    INFERNO_LOCAL_ENDPOINT: http://127.0.0.1:11434/api/generate
    INFERNO_LOCAL_MODEL: llama3.1:8b
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
    HEAD_SHA: ${{ github.event.pull_request.head.sha }}
```

When you run `infernoflow init`, it now scaffolds:
- `scripts/inferno-install-hooks.mjs`
- `.github/workflows/infernoflow-check.yml`

Install local hooks once per clone:

```bash
npm run inferno:hooks
```

## Release Checklist

```bash
npm test
npm pack --dry-run
node bin/infernoflow.mjs --help
node bin/infernoflow.mjs check --help
```

Then bump version and publish.

## License

MIT
