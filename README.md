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
# In your project root:
npx infernoflow init

# See your contract health:
infernoflow status

# Validate everything:
infernoflow check

# In CI / pre-push hook:
infernoflow doc-gate
```

## Commands

| Command | Description |
|---|---|
| `infernoflow init` | Interactive scaffold — creates `inferno/` in your project |
| `infernoflow status` | At-a-glance health of your contract |
| `infernoflow check` | Full validation: contract, capabilities, scenarios, changelog |
| `infernoflow doc-gate` | Fails if code changed but docs weren't updated |

### Options

```bash
infernoflow init --force    # overwrite existing files
infernoflow init --yes      # skip prompts, use defaults
infernoflow check --json    # machine-readable output for CI
infernoflow check --skip-doc-gate
```

## Example: Todo App

After `infernoflow init` in a React Todo project:

```
inferno/
├── contract.json
│   {
│     "policyId": "todo-app",
│     "policyVersion": 1,
│     "capabilities": ["CreateTask", "ReadTasks", "UpdateTask", "ToggleComplete", "DeleteTask"]
│   }
├── capabilities.json
│   { capabilities: [{ id: "CreateTask", title: "Create a task", since: "0.1.0" }, ...] }
├── scenarios/
│   └── happy_path.json   ← covers all 5 capabilities
└── CHANGELOG.md
```

Then in CI:

```yaml
- run: npm run inferno:check
```

## Why infernoflow?

**The problem:** AI-assisted development moves fast. Code changes daily. But what does the system *actually do*? What changed? What's covered?

**The metaphor:** A forge (כיבשן). Metal becomes liquid — flexible, shapeable. The forge is the controlled environment where that change happens safely, with molds (contracts) and tempering (tests).

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
