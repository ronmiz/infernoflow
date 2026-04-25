#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bold, gray, cyan, red } from "../lib/ui/output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// When installed globally: __dirname = .../infernoflow/dist/bin
// Root package.json lives two levels up at .../infernoflow/package.json
// npm always includes the root package.json, so this path is always reliable.
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
const VERSION = pkg.version || "0.0.0";
const COMMAND_DESCRIPTIONS = {
  publish: "Bump version, update changelog, build, npm publish, git commit + push in one shot",
  diff: "Show what capabilities changed since the last git tag (or any ref)",
  changelog: "Draft a changelog entry from commits since the last tag",
  setup: "One command to get fully operational — detects IDE, inits, installs hooks + MCP",
  init: "Scaffold inferno/ in your project (or adopt existing project)",
  "install-cursor-hooks": "Install Cursor hooks: draft agent replies to inferno/CONTEXT.draft.md",
  "install-vscode-copilot-hooks":
    "Install VS Code + Copilot agent hooks (Preview): draft to inferno/CONTEXT.draft.md",
  check: "Validate contract, capabilities, scenarios, changelog",
  status: "Show contract health at a glance",
  "pr-impact": "Summarize PR impact on capabilities and docs",
  sync: "Run deterministic inferno sync flow",
  run: "One-command detect/propose/apply/validate flow",
  "doc-gate": "Fail if code changed but docs were not updated",
  suggest: "Generate AI prompt + apply capability updates",
  implement: "Generate code-agent implementation prompt(s)",
  context: "Generate AI-ready context for new sessions",
  "generate-skills": "Generate personalised Cursor rules + skill files from your developer profile",
  synthesize: "Auto-detect workflow patterns and synthesize reusable skills + agents",
  agent: "Manage and run auto-synthesized agents (list | run | show | delete)",
  version: "Smart semver bump recommendation based on capability changes (--apply to write)",
  "pr-comment": "Post capability drift analysis as a GitHub PR comment (works in CI automatically)",
  dashboard: "Launch local web dashboard on localhost:7337 — live contract health, capabilities, agents",
  "team-sync": "Sync capability contract across a team via a shared git branch (push | pull | status | init)",
  onboard: "Interactive onboarding wizard for new developers — explains infernoflow in 5 minutes",
  cloud:   "Sync capability contracts via infernoflow cloud (init | push | pull | status | dashboard)",
  share:   "Generate a public read-only HTML snapshot of your capability contract",
  watch:   "Watch source files and run suggest automatically on save",
  ci:      "CI-native check: GitHub Actions annotations, GitLab code quality, exit codes",
  notify:  "Post capability drift summary to Slack or Discord",
  report:  "Generate a weekly/monthly HTML or Markdown report of capability activity",
  monorepo: "Manage infernoflow across monorepo packages (init | list | status | diff | sync)",
  link:    "Link capabilities to Jira, Linear, or GitHub Issues tickets",
  audit:   "Classify capabilities by sensitivity (auth, payment, PII, admin) and generate security surface map",
  scout:   "Scan source files for undocumented capabilities not yet in the contract",
  export:  "Export contract to OpenAPI, Backstage catalog-info.yaml, CSV, or Markdown",
  snapshot: "Save/diff/restore named snapshots of the capability contract",
  health:  "Compute a 0–100 health score across coverage, docs, freshness, completeness, drift",
  vibe:    "Vibe coding mode — watches files, auto-syncs contract, regenerates context on every save",
  adopt:   "Interactive wizard to adopt infernoflow in an existing project (detect → review → wire up)",
  doctor:  "Diagnose your infernoflow setup — checks Node, git, contract, AI providers, MCP, hooks",
  coverage: "Map test files to capabilities — show which caps have test coverage and which don't",
  review:  "AI-powered capability impact review for staged or recent git changes",
  scan:       "Deep AST scan — reads actual function bodies, extracts calls, DB ops, external services",
  graph:      "Build capability dependency graph — shows which caps call which, detects breaking changes",
  stability:  "Show solid/liquid stability level for every capability (frozen/stable/experimental)",
  freeze:     "Mark a capability as frozen (solid) — AI will not modify it without explicit instruction",
  thaw:       "Reset a capability to experimental (liquid) — free to evolve",
  why:        "Given a file or function name — show which capability it serves, scenarios, stability, and git history",
  impact:     "Blast radius analysis — see every cap, scenario, and risk level affected before you change anything",
  scaffold:   "Generate a new capability — source skeleton, contract registration, and placeholder scenario in one command",
  explain:    "AI narrative about a capability — what it does, why it exists, what's risky, and what to test",
  test:       "Run registered scenarios for a capability — auto-generates a smoke harness if no test runner is configured",
  ai:         "Manage AI providers — setup, status, test connection (subcommands: setup | status | test | clear)",
  demo:       "Interactive walkthrough — scaffolds a sample project and runs the full capability chain end-to-end",
};

const COMMAND_HANDLERS = {
  publish: async (args) => (await import("../lib/commands/publish.mjs")).publishCommand(args),
  diff: async (args) => (await import("../lib/commands/diff.mjs")).diffCommand(args),
  changelog: async (args) => (await import("../lib/commands/changelog.mjs")).changelogCommand(args),
  setup: async (args) => (await import("../lib/commands/setup.mjs")).setupCommand(args),
  init: async (args) => (await import("../lib/commands/init.mjs")).initCommand(args),
  "install-cursor-hooks": async (args) =>
    (await import("../lib/commands/installCursorHooks.mjs")).installCursorHooksCommand(args),
  "install-vscode-copilot-hooks": async (args) =>
    (await import("../lib/commands/installVsCodeCopilotHooks.mjs")).installVsCodeCopilotHooksCommand(args),
  check: async (args) => (await import("../lib/commands/check.mjs")).checkCommand(args),
  status: async (args) => (await import("../lib/commands/status.mjs")).statusCommand(args),
  "pr-impact": async (args) => (await import("../lib/commands/prImpact.mjs")).prImpactCommand(args),
  sync: async (args) => (await import("../lib/commands/syncAuto.mjs")).syncCommand(args),
  run: async (args) => (await import("../lib/commands/run.mjs")).runCommand(args),
  suggest: async (args) => (await import("../lib/commands/suggest.mjs")).suggestCommand(args),
  implement: async (args) => (await import("../lib/commands/implement.mjs")).implementCommand(args),
  context: async (args) => (await import("../lib/commands/context.mjs")).contextCommand(args),
  "doc-gate": async (args) => (await import("../lib/commands/docGate.mjs")).docGateCommand(args),
  "generate-skills": async (args) => (await import("../lib/commands/generateSkills.mjs")).generateSkillsCommand(args),
  synthesize: async (args) => (await import("../lib/commands/synthesize.mjs")).synthesizeCommand(args),
  agent: async (args) => (await import("../lib/commands/agent.mjs")).agentCommand(args),
  version: async (args) => (await import("../lib/commands/version.mjs")).versionCommand(args),
  "pr-comment": async (args) => (await import("../lib/commands/prComment.mjs")).prCommentCommand(args),
  dashboard: async (args) => (await import("../lib/commands/dashboard.mjs")).dashboardCommand(args),
  "team-sync": async (args) => (await import("../lib/commands/teamSync.mjs")).teamSyncCommand(args),
  onboard: async (args) => (await import("../lib/commands/onboard.mjs")).onboardCommand(args),
  cloud:   async (args) => (await import("../lib/commands/cloud.mjs")).cloudCommand(args),
  share:   async (args) => (await import("../lib/commands/share.mjs")).shareCommand(args),
  watch:   async (args) => (await import("../lib/commands/watch.mjs")).watchCommand(args),
  ci:      async (args) => (await import("../lib/commands/ci.mjs")).ciCommand(args),
  notify:  async (args) => (await import("../lib/commands/notify.mjs")).notifyCommand(args),
  report:  async (args) => (await import("../lib/commands/report.mjs")).reportCommand(args),
  monorepo: async (args) => (await import("../lib/commands/monorepo.mjs")).monorepoCommand(args),
  link:    async (args) => (await import("../lib/commands/link.mjs")).linkCommand(args),
  audit:    async (args) => (await import("../lib/commands/audit.mjs")).auditCommand(args),
  scout:    async (args) => (await import("../lib/commands/scout.mjs")).scoutCommand(args),
  export:   async (args) => (await import("../lib/commands/export.mjs")).exportCommand(args),
  snapshot: async (args) => (await import("../lib/commands/snapshot.mjs")).snapshotCommand(args),
  health:   async (args) => (await import("../lib/commands/health.mjs")).healthCommand(args),
  vibe:     async (args) => (await import("../lib/commands/vibe.mjs")).vibeCommand(args),
  adopt:    async (args) => (await import("../lib/commands/adoptWizard.mjs")).adoptWizardCommand(args),
  doctor:   async (args) => (await import("../lib/commands/doctor.mjs")).doctorCommand(args),
  coverage: async (args) => (await import("../lib/commands/coverage.mjs")).coverageCommand(args),
  review:   async (args) => (await import("../lib/commands/review.mjs")).reviewCommand(args),
  scan:      async (args) => (await import("../lib/commands/scan.mjs")).scanCommand(args),
  graph:     async (args) => (await import("../lib/commands/graph.mjs")).graphCommand(args),
  stability: async (args) => (await import("../lib/commands/stability.mjs")).stabilityCommand(args),
  freeze:    async (args) => (await import("../lib/commands/stability.mjs")).freezeCommand(args),
  thaw:      async (args) => (await import("../lib/commands/stability.mjs")).thawCommand(args),
  why:       async (args) => (await import("../lib/commands/why.mjs")).whyCommand(args),
  impact:    async (args) => (await import("../lib/commands/impact.mjs")).impactCommand(args),
  scaffold:  async (args) => (await import("../lib/commands/scaffold.mjs")).scaffoldCommand(args),
  explain:   async (args) => (await import("../lib/commands/explain.mjs")).explainCommand(args),
  test:      async (args) => (await import("../lib/commands/test.mjs")).testCommand(args),
  ai:        async (args) => (await import("../lib/commands/ai.mjs")).aiCommand(args),
  demo:      async (args) => (await import("../lib/commands/demo.mjs")).demoCommand(args),
};

function formatCommandsHelp() {
  const names = Object.keys(COMMAND_DESCRIPTIONS);
  const w = Math.max(...names.map((n) => n.length), 8) + 1;
  return Object.entries(COMMAND_DESCRIPTIONS)
    .map(([name, desc]) => `    ${name.padEnd(w, " ")}${desc}`)
    .join("\n");
}

const HELP = `
  ${bold("🔥 infernoflow")} ${gray("v" + VERSION)}
  ${gray("The forge for liquid code — keep every AI session in sync")}

  ${bold("Usage:")}
    infernoflow <command> [options]

  ${bold("Commands:")}
${formatCommandsHelp()}

  ${bold("diff options:")}
    --ref <tag|commit>        Compare against a specific ref (default: last git tag)
    --summary                 One-liner count only
    --json                    Machine-readable output

  ${bold("changelog options:")}
    update                    Draft ## Unreleased from commits (default sub-command)
    show                      Print the current ## Unreleased block
    list                      List commits since last tag
    ai                        Generate human-readable changelog with AI (Anthropic or Ollama)
    --ref <tag|commit>        Use a specific ref instead of last tag
    --version <x.y.z>         Version label for the AI-generated entry
    --dry-run                 Print what would be written without modifying file
    --append                  Append to existing ## Unreleased instead of replacing
    --json                    Machine-readable output

  ${bold("publish options:")}
    --bump patch|minor|major  Version bump type (default: patch)
    --skip-build              Skip the build step
    --skip-tests              Skip smoke tests
    --skip-push               Commit but don't git push
    --tag                     Also create a git tag vX.Y.Z
    --dry-run                 Print all steps without executing
    --yes, -y                 Non-interactive (skip confirmation prompt)

  ${bold("setup options:")}
    --yes, -y           Skip prompts (non-interactive)
    --force, -f         Overwrite existing hook files

  ${bold("init options:")}
    --cursor-hooks           Also install Cursor hooks (draft → inferno/CONTEXT.draft.md)
    --vscode-copilot-hooks   Also install VS Code + Copilot hooks (.github/hooks — Preview)
    --adopt             Infer capabilities from an existing codebase
    --lang <name>       Override detected language (e.g. ts, js, py)
    --framework <name>  Override detected framework (e.g. react, angular, express)
    --project-type <t>  Override project type (frontend|backend|fullstack|cli|library)
    --report-json       Print inferred adoption report as JSON
    --report-json-only  Print JSON report only (no human-readable logs)
    --report-human-only Print only human-readable adoption report (no JSON block)
    --yes, -y           Skip prompts and accept inferred/default values
    --force, -f         Overwrite existing inferno/ files

  ${bold("install-cursor-hooks options:")}
    --force, -f         Overwrite .cursor/hooks.json and hook scripts if they exist

  ${bold("install-vscode-copilot-hooks options:")}
    --force, -f         Overwrite .github/hooks/infernoflow-drafts.json and scripts if they exist

  ${bold("context options:")}
    --intent  "..."     What you plan to build next
    --working "..."     What you are building right now
    --decision "..."    Record a decision or note
    --show              Print context without writing file
    --copy, -c          Copy context to clipboard instantly
    --reset             Clear all stored state
    --watch             Poll git diff every 30s and auto-update CONTEXT.md (living context)
    --interval <secs>   Watch poll interval in seconds (default: 30)
    --auto-commit       Watch mode: commit CONTEXT.md to git on every change
    --auto-push         Watch mode: commit + push CONTEXT.md on every change

  ${bold("generate-skills options:")}
    --cursor            Also install rules to .cursor/rules/infernoflow.md
    --force, -f         Overwrite existing generated skill files

  ${bold("implement options:")}
    --mode <type>       cursor | generic | both (default: both)
    --copy, -c          Copy generated prompt(s) to clipboard

  ${bold("run options:")}
    --dry-run           Execute full flow without writing files
    --json              Emit machine-readable events and result payload
    --no-rollback       Keep changes even if validation fails
    --provider <type>   auto | agent | local | prompt (default: auto)
    --ide <name>        auto | cursor | vscode | windsurf (default: auto)

  ${bold("Typical workflow:")}
    ${gray('1. infernoflow context --intent "what I want to build"')}
    ${gray("2. [paste inferno/CONTEXT.md into Claude / Cursor / Copilot]")}
    ${gray("3. [build the feature]")}
    ${gray('4. infernoflow suggest "what I built"')}
    ${gray("5. infernoflow check")}

  ${bold("suggest options:")}
    --json                    Non-interactive: emit prompt as JSON, no readline prompts
    --response <json|@file>   Provide AI response directly (use with --json)
    --apply                   Apply the response changes when using --json --response

  ${bold("version options:")}
    --ref <tag|commit>    Compare against a specific ref (default: last git tag)
    --apply               Write recommended version bump to package.json
    --json                Machine-readable output

  ${bold("pr-comment options:")}
    --pr <number>         PR number to comment on (auto-detected in GitHub Actions)
    --repo <owner/repo>   GitHub repository (auto-detected in GitHub Actions)
    --token <ghp_...>     GitHub token (auto-detected from GITHUB_TOKEN env var)
    --ref <ref>           Base ref to diff against (auto-detected from GITHUB_BASE_REF)
    --dry-run             Print the comment without posting it
    --json                Machine-readable output

  ${bold("cloud sub-commands:")}
    init                      Generate a project token and configure cloud sync
    push                      Upload local capability contract to cloud
    pull                      Download latest contract from cloud (conflict detection)
    status                    Compare local vs cloud (hashes, capability counts)
    dashboard                 Print hosted dashboard URL and open in browser

  ${bold("cloud options:")}
    --token <tok>             Override token (or set INFERNOFLOW_TOKEN env var)
    --endpoint <url>          Override default endpoint (https://cloud.infernoflow.dev)
    --force, -f               Overwrite on init; overwrite local on conflicted pull
    --dry-run                 Print what would happen without sending
    --json                    Machine-readable output

  ${bold("share options:")}
    --upload                  Upload to dpaste.com and print a public URL
    --open                    Open the snapshot in your browser immediately
    --copy                    Copy HTML to clipboard
    --out <path>              Custom output path (default: inferno/share.html)
    --json                    Machine-readable: { ok, file, url }

  ${bold("watch options:")}
    [dirs...]                 Directories to watch (default: src/, lib/, app/)
    --interval <secs>         Debounce interval in seconds (default: 3)
    --dry-run                 Print what would run without executing
    --silent                  No output (for git hook use)

  ${bold("notify options:")}
    --slack <url>             Slack incoming webhook URL
    --discord <url>           Discord webhook URL
    --on-change               Only notify if capabilities actually changed
    --dry-run                 Print message without sending
    --json                    Machine-readable result

  ${bold("report options:")}
    --format html|md          Output format (default: html)
    --since <period>          7d, 30d, 90d, or YYYY-MM-DD (default: 30d)
    --out <path>              Output file path (default: inferno/report.html)
    --open                    Open HTML report in browser after generating
    --json                    Machine-readable summary

  ${bold("ci options:")}
    --platform <name>         github | gitlab | bitbucket | generic (auto-detected)
    --fail-on <level>         error | warning (default: error)
    --json                    Machine-readable result + exit code

  ${bold("monorepo sub-commands:")}
    init                      Run infernoflow init --adopt in every package
    list                      List detected packages with their capability counts
    status                    Show contract health across all packages
    diff                      Show capability changes across packages (--package to filter)
    sync                      Aggregate all contracts into inferno-monorepo.json

  ${bold("monorepo options:")}
    --package <name>          Filter to a specific package
    --json                    Machine-readable output

  ${bold("link sub-commands:")}
    (default)                 Link a capability to a ticket
    list                      Show all capability→ticket links
    status                    Show linked and unlinked capabilities
    remove                    Remove a link by capability ID

  ${bold("link options:")}
    --capability <id>         Capability to link
    --jira <TICKET>           Jira ticket ID (e.g. PROJ-123)
    --linear <ID>             Linear issue ID
    --github <NUM>            GitHub issue number
    --json                    Machine-readable output

  ${bold("audit options:")}
    --format text|json|html   Output format (default: text)
    --out <path>              Save to file (default: prints to stdout)
    --fail-on high|medium     Exit 1 if unreviewed caps at given severity exist
    --json                    Machine-readable output

  ${bold("vibe options:")}
    --dir <dirs>              Comma-separated directories to watch (default: auto-detected)
    --no-suggest              Disable automatic contract sync on file save
    --no-context              Disable CONTEXT.md regeneration
    --interval <secs>         Debounce seconds between saves (default: 4)
    --port <n>                Also run a mini status dashboard on localhost:<n>
    --silent                  Suppress all terminal output (pure background mode)

  ${bold("adopt options:")}
    --dir <dirs>              Source directories to scan (default: src,lib,app,api,routes,controllers)
    --yes, -y                 Auto-approve all candidates (non-interactive)
    --json                    Machine-readable output, implies --yes

  ${bold("init --template options:")}
    --template rest-api       REST API (Express/Fastify/Hono) starter
    --template nextjs         Next.js fullstack app starter
    --template cli            CLI tool (Node.js/Python) starter
    --template graphql        GraphQL API (Apollo/Pothos) starter
    --template monorepo       Monorepo workspace starter

  ${bold("scout options:")}
    --dir <dirs>              Comma-separated directories to scan (default: src,lib,app,api,routes)
    --apply                   Write discovered capabilities to the contract file
    --min-confidence <0-1>    Minimum confidence threshold (default: 0.6)
    --json                    Machine-readable output

  ${bold("export options:")}
    --format openapi|backstage|csv|markdown|json   Output format (required)
    --out <path>              Output file path (default: project root, auto-named)
    --json                    Machine-readable summary

  ${bold("snapshot sub-commands:")}
    save <name>               Save current contract as a named snapshot
    list                      List all snapshots
    show <name>               Print a snapshot's capabilities
    diff <name1> [<name2>]    Diff two snapshots (omit name2 to diff against current)
    restore <name>            Overwrite contract with snapshot contents
    delete <name>             Delete a snapshot

  ${bold("snapshot options:")}
    --json                    Machine-readable output

  ${bold("health options:")}
    --fail-below <score>      Exit 1 if health score is below this threshold (CI gate)
    --watch                   Re-run every 30s (live terminal view)
    --interval <secs>         Watch interval in seconds (default: 30)
    --json                    Machine-readable score + breakdown

  ${bold("doctor options:")}
    --fix                     Auto-fix common issues (installs hooks, runs init, etc.)
    --json                    Machine-readable list of pass/warn/fail results

  ${bold("coverage options:")}
    --dir <path>              Extra directory to scan for test files (repeatable)
    --threshold <0-1>         Minimum fuzzy-match score to count a test (default: 0.25)
    --fail-below <pct>        Exit 1 if coverage percentage is below this value (CI gate)
    --json                    Machine-readable coverage breakdown

  ${bold("scan options:")}
    --dir <path>              Extra directory to scan (repeatable)
    --capability <id>         Scan and enrich a single capability only
    --dry-run                 Print results without writing files
    --json                    Machine-readable scan output

  ${bold("graph options:")}
    --cap <id>                Show dependency view for a single capability
    --check                   Exit 1 if breaking dependency changes detected (CI gate)
    --json                    Machine-readable graph output

  ${bold("stability / freeze / thaw options:")}
    infernoflow stability     List all capabilities with their stability level
    infernoflow freeze <id>   Mark capability as frozen (AI won't touch it)
    infernoflow freeze <id> --stable   Mark as stable (careful, not forbidden)
    infernoflow thaw <id>     Reset to experimental (liquid — free to change)
    --json                    Machine-readable stability list

  ${bold("review options:")}
    --unstaged                Review all working-tree changes (not just staged)
    --last                    Review last commit (git diff HEAD~1)
    --dry-run                 Print the AI prompt only — no API call made
    --json                    Machine-readable output (affectedCaps, summary, provider)

  ${bold("why options:")}
    infernoflow why <file>               Show capability for a source file
    infernoflow why <functionName>       Show capability for a function name
    --function <name>                    Filter to a specific function when multiple caps match
    --json                               Machine-readable output

  ${bold("impact options:")}
    infernoflow impact <cap-id>          Show blast radius for a capability
    --depth <n>                          Max transitive depth to traverse (default: 10)
    --check                              Exit 1 if risk level is HIGH or CRITICAL (CI gate)
    --json                               Machine-readable output

  ${bold("scaffold options:")}
    infernoflow scaffold <cap-id>        Generate a new capability skeleton
    --dir <path>                         Output directory for the source file (default: auto-detected)
    --lang ts|js|py|go                   Language override (default: auto-detected from project)
    --description "..."                  Capability description to embed in the file
    --dry-run                            Preview what would be generated without writing files
    --json                               Machine-readable output including generated code

  ${bold("explain options:")}
    infernoflow explain <cap-id>         AI narrative: what it does, risk, what to test
    --dry-run                            Print the AI prompt only — no API call made
    --json                               Machine-readable output (narrative, stability, scenarios)

  ${bold("test options:")}
    infernoflow test                     Run all caps that have registered scenarios
    infernoflow test <cap-id>            Run scenarios for a specific capability
    infernoflow test --all               Run every capability (including those without scenarios)
    --generate                           Print generated ad-hoc test file without running
    --bail                               Stop on first failure
    --verbose, -v                        Show runner output for each scenario
    --json                               Machine-readable output (passed/failed/skipped counts)

  ${bold("ai options:")}
    infernoflow ai setup                 Interactive wizard — pick provider, enter API key, verify
    infernoflow ai status                Show all providers and which are configured
    infernoflow ai test [provider]       Send a test prompt and verify the connection
    infernoflow ai clear <provider>      Remove a provider's config from integrations.json
    Supported providers: anthropic  openai  gemini  openrouter  ollama

  ${bold("demo options:")}
    infernoflow demo                     Full interactive walkthrough (sample e-commerce project)
    infernoflow demo --fast              Skip pauses — good for CI or screen recording
    infernoflow demo --no-cleanup        Keep the temp demo project after the run

  ${bold("Machine output:")}
    ${gray("status --json")}
    ${gray("check --json")}
    ${gray("doc-gate --json")}
    ${gray("pr-impact --json")}
    ${gray("sync --auto --json")}
    ${gray('run "task" --json')}
    ${gray('suggest "what changed" --json')}
    ${gray('suggest "what changed" --json --response \'{"newCapabilities":[...]}\' --apply')}
    ${gray("version --json")}
    ${gray("version --apply")}
`;

// ── Silent behavior observation ───────────────────────────────────────────
import * as fs from "node:fs";
import * as path from "node:path";
try {
  const infernoDir = path.join(process.cwd(), "inferno");
  if (fs.existsSync(infernoDir)) {
    const { observeCommandStart } = await import("../lib/learning/observe.mjs");
    const cmdForObserve = process.argv[2];
    if (cmdForObserve && !cmdForObserve.startsWith("-")) {
      observeCommandStart(infernoDir, cmdForObserve);
    }
  }
} catch {}

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(HELP);
  process.exit(0);
}
if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
  process.exit(0);
}

const commands = Object.keys(COMMAND_HANDLERS);

if (!commands.includes(cmd)) {
  console.error(red(`\nUnknown command: ${cmd}`));
  console.error(gray("Run: infernoflow --help\n"));
  process.exit(1);
}

const args = [cmd, ...rest];
COMMAND_HANDLERS[cmd](args).catch((err) => {
  console.error(red("\nError: ") + err.message);
  process.exit(1);
});
