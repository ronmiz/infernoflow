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

## Commands

| Command | Description |
|---|---|
| `infernoflow init` | Interactive scaffold — creates `inferno/` in your project |
| `infernoflow status` | At-a-glance health of your contract |
| `infernoflow suggest` | Generate an AI prompt, apply capability updates |
| `infernoflow check` | Full validation: contract, capabilities, scenarios, changelog |
| `infernoflow doc-gate` | Fails if code changed but docs weren't updated |

### Options

```bash
infernoflow init --force       # overwrite existing files
infernoflow init --yes         # skip prompts, use defaults
infernoflow suggest "..."      # describe what changed
infernoflow check --json       # machine-readable output for CI
infernoflow check --skip-doc-gate
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

## Why infernoflow?

**The problem:** AI-assisted development moves fast. Code changes daily. But what does the system *actually do*? What changed? What's covered?

**The metaphor:** A forge (כיבשן). Metal becomes liquid — flexible, shapeable. The forge is the controlled environment where that change happens safely, with molds (contracts) and tempering (validation).

**The principle:** Liquid where you want flexibility. Solid where you need safety.

## CI Integration

```yaml
# .github/workflows/ci.yml
- name: infernoflow check
  run: npx infernoflow check --json
  env:
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
    HEAD_SHA: ${{ github.event.pull_request.head.sha }}
```

## License

MIT
