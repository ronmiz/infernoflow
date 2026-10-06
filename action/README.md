# infernoflow GitHub Action

Posts a PR comment that lists **memory entries the PR adds** (they reach every teammate's AI after merge, so review them like code), plus the gotchas and decisions from your memory that are relevant to the files being changed.

## What it looks like

When a PR touches files related to things you've logged, the action posts:

```
🔥 infernoflow — PR Memory Check

12 files changed — here's what infernoflow remembers about these areas:

⚠️ Gotchas to watch out for
- API returns 202 not 200 — never await sync response (28 Apr)
- Upload requires multipart/form-data, not JSON (27 Apr)

✅ Decisions in effect
- Bootstrap over Tailwind to match admin panel
```

## Setup

1. Run `infernoflow init` in your project (creates `.ai-memory/`)
2. Log gotchas as you code: `infernoflow log "..." --type gotcha`
3. Commit `.ai-memory/` to your repo (infernoflow keeps local-only files gitignored)
4. Add this workflow file:

```yaml
# .github/workflows/infernoflow.yml
name: infernoflow PR Check
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  pull-requests: write
  contents: read
jobs:
  infernoflow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ronmiz/infernoflow/action@action-v3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `github-token` | `${{ github.token }}` | Token for posting PR comments |
| `sessions-file` | _(all of `.ai-memory/`)_ | Optional single JSONL file to read instead |
| `min-type` | `both` | What to surface: `gotcha`, `decision`, or `both` |
| `fail-on-frozen` | `false` | Exit with error if a frozen capability is touched |

## How relevance works

The action matches your logged entries to changed files by:
1. **Direct match** — gotcha text mentions the changed filename
2. **Topic match** — gotcha is about auth/upload/API/DB and PR changes auth/upload files

Only relevant entries are shown — no noise if nothing matches.

## Pull requests from forks

GitHub gives workflows triggered by `pull_request` from a fork a **read-only** token, so the comment can't be posted. The action then writes the same report to the job summary and fails the check when the PR changes memory, so it is not silently skipped. To comment on fork PRs, run the action from a `pull_request_target` workflow **without checking out the PR's code** (the action only needs the PR file list from the API; the relevance hints for existing memory then use the base branch).
