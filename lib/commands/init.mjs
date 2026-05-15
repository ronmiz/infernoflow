import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { header, ok, warn, done, nextSteps, bold, cyan, yellow, gray, green, red } from "../ui/output.mjs";
import {
  discoverProjectSignals,
  reviewCapabilitiesInteractive,
  writeAdoptionBaseline,
  buildAdoptionReport,
  summarizeCapabilities,
  buildSignalsReport,
} from "./adopt.mjs";
import { installCursorHooksArtifacts } from "../cursorHooksInstall.mjs";
import { ampPaths, ensureAmpDir, appendEntry as ampAppend, writeDefaultConfig } from "../amp/io.mjs";
import { installVsCodeCopilotHooksArtifacts } from "../vsCodeCopilotHooksInstall.mjs";
import { writeInitRuleFiles } from "../ruleFiles.mjs";
import { autoSetupMcp } from "./setup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getTemplatesRoot() {
  return path.resolve(__dirname, "../../templates");
}

function ask(rl, question, defaultVal = "") {
  return new Promise(resolve => {
    const hint = defaultVal ? gray(` (${defaultVal})`) : "";
    rl.question(`  ${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function getArgValue(args, ...flags) {
  for (const flag of flags) {
    const i = args.indexOf(flag);
    if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("-")) return args[i + 1];
  }
  return null;
}

function copyFile(src, dst, force, silent = false) {
  if (fs.existsSync(dst) && !force) {
    if (!silent) warn("Skipped (exists): " + path.relative(process.cwd(), dst));
    return false;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  if (!silent) ok("Created: " + cyan(path.relative(process.cwd(), dst)));
  return true;
}

function copyDirDeep(srcDir, dstDir, force) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) copyDirDeep(src, dst, force);
    else copyFile(src, dst, force);
  }
}

function upsertScripts(cwd, silent = false) {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts || {};
  let changed = false;
  const toAdd = {
    "inferno:check":  "infernoflow check",
    "inferno:status": "infernoflow status",
    "inferno:gate":   "infernoflow doc-gate",
    "inferno:impact": "infernoflow pr-impact --json",
    "inferno:sync":   "infernoflow sync --auto --json",
    "inferno:run":    "infernoflow run \"sync check\" --provider auto --json",
    "inferno:hooks":  "node scripts/inferno-install-hooks.mjs"
  };
  for (const [k, v] of Object.entries(toAdd)) {
    if (!pkg.scripts[k]) { pkg.scripts[k] = v; changed = true; }
  }
  if (changed) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    if (!silent) ok("Updated " + cyan("package.json") + " scripts");
  }
}

// ── Branch-switch fix: keep memory developer-local, not branch-attached ──────
// Adds an idempotent managed block to the project's .gitignore so:
//   - .ai-memory/        stays on disk across branch checkouts
//   - rule files         don't fight you when you switch context
//
// Without this, every `git checkout` swaps in another branch's gotchas (or wipes
// them entirely), and the AI reads stale context. Memory is per-developer state,
// not per-branch state — same idea as `.env.local`.
//
// Idempotent: re-running init will not duplicate the block. If the user has
// manually added one of these patterns above the block, we leave it alone.
const GITIGNORE_MARK_START = "# --- infernoflow (developer-local AI memory; do not commit) ---";
const GITIGNORE_MARK_END   = "# --- /infernoflow ---";
const GITIGNORE_PATTERNS = [
  ".ai-memory/",
  ".cursorrules",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
];

function ensureGitignoreEntries(cwd, { silent = false } = {}) {
  const gitignorePath = path.join(cwd, ".gitignore");
  let existing = "";
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, "utf8");
  }
  // Already managed → no-op
  if (existing.includes(GITIGNORE_MARK_START)) return false;

  const block = [
    "",
    GITIGNORE_MARK_START,
    "# Memory is per-developer, not per-branch. These files travel with you, not with git.",
    ...GITIGNORE_PATTERNS,
    GITIGNORE_MARK_END,
    "",
  ].join("\n");

  // Ensure newline at end of existing content before appending
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(gitignorePath, existing + sep + block, "utf8");
  if (!silent) {
    // Make the opinion visible — reviewers flagged that silently editing the
    // user's .gitignore to add CLAUDE.md / .cursorrules / etc. is a strong
    // philosophical claim ("memory is per-developer, not per-branch") that
    // some teams will disagree with. Print exactly what was added and how
    // to undo, so it's transparent rather than surprise.
    ok("Updated " + cyan(".gitignore") + gray(" — added entries:"));
    for (const p of GITIGNORE_PATTERNS) console.log(gray("    + ") + cyan(p));
    console.log(gray("    Memory + AI rule files are now per-developer (won't move with branches)."));
    console.log(gray("    To commit them instead: delete the `") + cyan("# --- infernoflow ---") + gray("` block in .gitignore."));
  }
  return true;
}

function detectProjectName(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.name) return pkg.name.replace(/[^a-z0-9_-]/gi, "_");
    } catch {}
  }
  return path.basename(cwd);
}

function writeContract(contractPath, policyId, capabilities) {
  const contract = {
    policyId,
    policyVersion: 1,
    capabilities,
    rules: {
      docsRequiredOnCapabilityChange: true,
      requireScenarioForEachCapability: true,
      requireChangelogOnCapabilityChange: true
    }
  };
  fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
}

function writeCapabilities(capsPath, capabilities) {
  const registry = {
    schemaVersion: 1,
    capabilities: capabilities.map(id => ({
      id,
      title: id.replace(/([A-Z])/g, " $1").trim(),
      since: "0.1.0"
    }))
  };
  fs.writeFileSync(capsPath, JSON.stringify(registry, null, 2) + "\n");
}

function writeScenario(scenariosDir, capabilities) {
  fs.mkdirSync(scenariosDir, { recursive: true });
  const scenario = {
    scenarioId: "happy_path",
    description: "Basic happy-path flow covering all capabilities",
    capabilitiesCovered: capabilities,
    steps: capabilities.map(c => ({
      action: c,
      expect: `${c} works as expected`
    }))
  };
  fs.writeFileSync(
    path.join(scenariosDir, "happy_path.json"),
    JSON.stringify(scenario, null, 2) + "\n"
  );
}

function writeChangelog(changelogPath, policyId) {
  const content = `# Changelog — ${policyId}

## Unreleased

- Initial capabilities defined

## 0.1.0 — Initial release

- Project initialized with infernoflow
`;
  fs.writeFileSync(changelogPath, content);
}

// ── Lite init — minimal footprint for small projects ─────────────────────────

async function initLite(cwd, force) {
  const { bold, cyan, gray, green, yellow, red } = await import("../ui/output.mjs");

  console.log("\n  " + bold("🔥 infernoflow init --lite"));
  console.log("  " + "─".repeat(50) + "\n");
  console.log(gray("  Lite mode: 3 files, no scripts, no workflows, no hooks."));
  console.log(gray("  Use `infernoflow upgrade` later to expand to the full setup.\n"));

  const infernoDir = path.join(cwd, "inferno");

  if (fs.existsSync(infernoDir) && !force) {
    console.log(yellow("  ⚠ inferno/ already exists. Use --force to overwrite.\n"));
    process.exit(0);
  }

  fs.mkdirSync(infernoDir, { recursive: true });

  const policyId = detectProjectName(cwd);

  // Prompt for a one-liner intent (skip if --yes)
  let intent = "";
  if (!process.argv.includes("--yes") && !process.argv.includes("-y") && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    intent = await new Promise(resolve => {
      rl.question(gray("  What does this project do? (one line, Enter to skip): "), ans => {
        rl.close();
        resolve(ans.trim());
      });
    });
  }

  // contract.json — minimal, no rules bloat
  const contract = {
    policyId,
    policyVersion: 1,
    lite: true,
    capabilities: [],
    intent: intent || undefined,
  };
  fs.writeFileSync(path.join(infernoDir, "contract.json"), JSON.stringify(contract, null, 2) + "\n");

  // capabilities.json — bare array (lite projects stay flat)
  fs.writeFileSync(path.join(infernoDir, "capabilities.json"), JSON.stringify([], null, 2) + "\n");

  // sessions.jsonl — empty, ready to receive log entries
  fs.writeFileSync(path.join(infernoDir, "sessions.jsonl"), "", "utf8");

  // .lite marker — lets `infernoflow upgrade` know the mode
  fs.writeFileSync(path.join(infernoDir, ".lite"), "1", "utf8");

  console.log(green("  ✔ Created inferno/contract.json"));
  console.log(green("  ✔ Created inferno/capabilities.json"));
  console.log(green("  ✔ Created inferno/sessions.jsonl"));
  console.log();
  console.log("  " + bold("Ready. Start using it:"));
  console.log("  " + cyan("infernoflow log") + gray(' "what you\'re building" --type note'));
  console.log("  " + cyan("infernoflow theme") + gray(" — scan your fonts + colors"));
  console.log("  " + cyan("infernoflow context") + gray(" — generate AI context to paste"));
  console.log("  " + cyan("infernoflow upgrade") + gray(" — expand to full setup when you need it"));
  console.log();
}


// ── Robust first-gotcha prompt ────────────────────────────────────────────────

const COMMAND_PREFIX_RE = /^(?:node|npm|npx|yarn|pnpm|bun|git|cd|mkdir|rm|ls|cat|echo|type|dir|copy|del|move|python|python3|pip|go|cargo|java|gradle|mvn|docker|kubectl|curl|wget|ssh|scp|chmod|chown|sudo|brew|apt|yum)\b/i;
const SHELL_OPERATOR_RE = /\s(?:&&|\|\||>>|>|<<|<|\|)\s/;
const PATH_LIKE_RE      = /(?:^|\s)[A-Za-z]:\\|\.\.[\\\/]|[\\\/]bin[\\\/]/;

function classifyGotcha(raw) {
  if (!raw) return { kind: "empty" };
  const trimmed = raw.replace(/^\s*[>$#]\s+/, "").trim(); // strip accidental leading prompt char
  if (!trimmed) return { kind: "empty" };
  if (/[\r\n]/.test(trimmed)) return { kind: "multiline", value: trimmed };
  if (COMMAND_PREFIX_RE.test(trimmed)) return { kind: "command", value: trimmed };
  if (SHELL_OPERATOR_RE.test(trimmed)) return { kind: "command", value: trimmed };
  if (PATH_LIKE_RE.test(trimmed))      return { kind: "command", value: trimmed };
  // Heuristic: very short input (1-2 chars) likely accidental
  if (trimmed.length < 3) return { kind: "tooShort", value: trimmed };
  return { kind: "ok", value: trimmed };
}

async function promptForFirstGotcha({ yes }) {
  if (yes || !process.stdin.isTTY) return "";

  const { gray, yellow, cyan } = await import("../ui/output.mjs");
  const PROMPT = "  " + gray("What should the next AI agent know about this project?\n  > ");

  const ask = (q) => new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let cancelled = false;
    rl.on("SIGINT",   () => { cancelled = true; rl.close(); resolve(null); });
    rl.on("close",    () => { if (cancelled) resolve(null); });
    rl.question(q, ans => { rl.close(); resolve(ans); });
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ask(attempt === 0 ? PROMPT : "  " + gray("> "));

    if (raw === null) {
      // Ctrl+C — leave the install alone, just don't log a gotcha
      console.log();
      return "";
    }

    const result = classifyGotcha(raw);

    if (result.kind === "ok")       return result.value;
    if (result.kind === "empty")    return ""; // user just pressed enter; skip silently

    if (result.kind === "command") {
      console.log("  " + yellow("⚠") + " That looks like a shell command, not a memory.");
      console.log("  " + gray("  Try a short note like: ") + cyan('"API returns 202 not 200 on async upload"'));
      continue;
    }
    if (result.kind === "multiline") {
      console.log("  " + yellow("⚠") + " Multi-line paste detected — log a single gotcha at a time.");
      console.log("  " + gray("  Try one short sentence:"));
      continue;
    }
    if (result.kind === "tooShort") {
      console.log("  " + yellow("⚠") + " Too short to be useful as a memory. Skip with Enter, or try again:");
      continue;
    }
  }

  // Two strikes — skip silently rather than block the install
  return "";
}

/** Default init: memory-only, AMP-compliant layout (.ai-memory/), 60 seconds */
async function initMemory(cwd, force, yes) {
  const { bold, cyan, gray, green, yellow } = await import("../ui/output.mjs");

  const ampDir       = path.join(cwd, ".ai-memory");
  const legacyDir    = path.join(cwd, "inferno");
  const sessionsFile = path.join(ampDir, "sessions.jsonl");

  // "Already set up" applies to either the new AMP layout or the legacy one
  const alreadyInit = fs.existsSync(ampDir) || fs.existsSync(legacyDir);
  if (alreadyInit && !force) {
    const which = fs.existsSync(ampDir) ? ".ai-memory/" : "inferno/ (legacy)";
    console.log("\n  " + bold("🔥 infernoflow") + gray(" — already set up\n"));
    console.log("  " + green("✔") + " " + which + " found\n");
    // Backfill the branch-switch gitignore block for users who initialized
    // before this guard existed. Idempotent — does nothing if already present.
    ensureGitignoreEntries(cwd);
    // Backfill rule files + MCP setup for projects initialized before these
    // existed. Both are idempotent — re-running is safe.
    writeInitRuleFiles(cwd);
    try { autoSetupMcp(cwd, { silent: true }); } catch {}
    console.log("  Quick commands:");
    console.log("  " + cyan("infernoflow log \"...\"") + gray("    — remember something"));
    console.log("  " + cyan("infernoflow switch") + gray("         — handoff to next AI"));
    console.log("  " + cyan("infernoflow recap") + gray("          — session summary\n"));
    if (!fs.existsSync(ampDir)) {
      console.log(gray("  Tip: run ") + cyan("infernoflow amp migrate") + gray(" to move legacy memory into .ai-memory/\n"));
    }
    console.log(gray("  For contracts & CI gates: infernoflow init --mode full\n"));
    return;
  }

  const projectName = detectProjectName(cwd);

  console.log("\n  " + bold("🔥 infernoflow") + gray(" — let's get you set up (30 seconds)\n"));
  console.log("  Detected: " + cyan(projectName) + "\n");

  // Create .ai-memory/ (AMP layout) — empty sessions + default amp.json
  ensureAmpDir(cwd);
  if (!fs.existsSync(sessionsFile)) {
    fs.writeFileSync(sessionsFile, "", "utf8");
  }
  writeDefaultConfig(cwd, { project: projectName, config: { autoCapture: true } });

  // Branch-switch fix — make memory developer-local, not branch-attached.
  ensureGitignoreEntries(cwd);

  // Rule-file stubs — give AI tools the Memory protocol skill on session 1.
  // Idempotent: if the user later installs the extension, its auto-sync will
  // refresh these with ranked memory using the same delimiter markers.
  const ruleResults = writeInitRuleFiles(cwd);
  for (const r of ruleResults) {
    if (r.created || r.updated) ok((r.created ? "Created: " : "Updated: ") + cyan(r.rel));
  }

  // MCP auto-setup — copy the server, register it with Claude Code, and
  // pre-approve the tools. Without this the Memory protocol skill block is
  // just text — there's no `amp_write` tool to call. This makes init enough
  // on its own; users don't need to also run `infernoflow setup`.
  try { autoSetupMcp(cwd); } catch (err) { warn("MCP auto-setup skipped: " + err.message); }

  // Ask for first gotcha (skip if --yes or not TTY).
  // Hardened against the easy-to-hit failure modes:
  //   - empty input → silently skip (no half-state)
  //   - multi-line paste → warn + re-prompt (caught Ron pasting a command line)
  //   - command-shaped input (starts with node/git/cd/npm/python, contains >/|/&&)
  //     → warn + re-prompt (don't store "node ./bin/x.mjs ..." as a gotcha)
  //   - Ctrl+C / EOF → exit the prompt cleanly, leave inferno/ in place
  //
  // Up to 2 retries before we give up and skip — never blocks the install.
  const gotcha = await promptForFirstGotcha({ yes });

  if (gotcha) {
    ampAppend(cwd, {
      ts: new Date().toISOString(),
      agent: "user",
      type: "gotcha",
      summary: gotcha,
      source: "init",
    });
    console.log("\n  " + green("✔") + " First gotcha logged!");
  }

  console.log("\n  " + green("✔") + " You're set up. Quick commands:\n");
  console.log("  " + cyan("infernoflow log \"...\"") + gray("    — remember something"));
  console.log("  " + cyan("infernoflow switch") + gray("         — generate handoff for next AI"));
  console.log("  " + cyan("infernoflow recap") + gray("          — session summary\n"));
  console.log(gray("  Tip: infernoflow switch --copy puts the handoff on your clipboard.\n"));
  console.log(gray("  Want contracts & CI gates? Run: infernoflow init --mode full\n"));
}

function printInitHelp() {
  // Plain, scriptable help — agents that pipe `init --help` into a shell are
  // the people who hit this bug first. Keep it short, list every flag, no
  // colors so it works in any terminal/log.
  const lines = [
    "infernoflow init — set up persistent AI memory in this project",
    "",
    "Usage:",
    "  infernoflow init                      Memory-first setup (default, 60 sec)",
    "  infernoflow init --lite               Minimal: 3 files, no scripts, no workflows",
    "  infernoflow init --mode full          Contracts + CI gates (advanced)",
    "  infernoflow init --adopt              Detect existing capabilities from code",
    "  infernoflow init --template <name>    Start from a project template",
    "",
    "Options:",
    "  -y, --yes                Non-interactive; accept all defaults",
    "  -f, --force              Overwrite existing inferno/ or .ai-memory/",
    "  --cursor-hooks           Also install Cursor IDE hooks (advanced)",
    "  --vscode-copilot-hooks   Also install VS Code Copilot hooks (advanced)",
    "  --lang <lang>            Override language detection (with --adopt)",
    "  --framework <name>       Override framework detection (with --adopt)",
    "  --project-type <type>    Override project-type detection (with --adopt)",
    "  -h, --help               Show this help",
    "",
    "Default flow writes .ai-memory/ + AI rule files + MCP server config, then asks",
    "for one first gotcha. Press Enter to skip — never blocks.",
  ];
  console.log(lines.join("\n"));
}

export async function initCommand(args) {
  // --help must short-circuit BEFORE we do any I/O or prompting. Earlier
  // versions of init had no help path at all: `init --help` would run an
  // interactive setup with `--help` ignored as an unknown flag. Agents that
  // pipe `init --help` into stdout got an interactive prompt instead of help.
  if (args.includes("--help") || args.includes("-h")) {
    printInitHelp();
    return;
  }

  const cwd = process.cwd();
  const force = args.includes("--force") || args.includes("-f");
  const yes = args.includes("--yes") || args.includes("-y");
  const adopt = args.includes("--adopt");

  // ── Memory-first default (no flags) — 60-second onboarding ───────────────
  const modeArg = args.find(a => a.startsWith("--mode="))?.split("=")[1]
    || (args.indexOf("--mode") !== -1 ? args[args.indexOf("--mode") + 1] : null);

  const isFullMode = modeArg === "full" || modeArg === "contract";
  const hasAdvancedFlag = adopt || args.includes("--template") || args.includes("--cursor-hooks")
    || args.includes("--vscode-copilot-hooks") || args.includes("--lite");

  if (!isFullMode && !hasAdvancedFlag) {
    await initMemory(cwd, force, yes);
    return;
  }

  // ── Lite mode — tiny project, single directory, 3 files only ──────────────
  if (args.includes("--lite")) {
    await initLite(cwd, force);
    return;
  }

  // ── Template shortcut ──────────────────────────────────────────────────────
  const templateIdx  = args.indexOf("--template");
  const templateName = templateIdx !== -1 ? args[templateIdx + 1] : null;

  if (templateName) {
    let tmplMod;
    try { tmplMod = await import("../templates/index.mjs"); } catch {}
    const tmpl = tmplMod?.getTemplate(templateName);
    if (!tmpl) {
      const available = tmplMod ? tmplMod.listTemplates().map(t => t.name).join(", ") : "rest-api, nextjs, cli, graphql, monorepo";
      warn(`Unknown template: ${templateName}. Available: ${available}`);
      process.exit(1);
    }

    const infernoDir = path.join(cwd, "inferno");
    const scenDir    = path.join(infernoDir, "scenarios");
    if (!fs.existsSync(infernoDir)) fs.mkdirSync(infernoDir, { recursive: true });
    if (!fs.existsSync(scenDir))    fs.mkdirSync(scenDir,    { recursive: true });

    const policyId = detectProjectName(cwd);
    const caps     = tmpl.capabilities;

    // Write contract.json
    fs.writeFileSync(path.join(infernoDir, "contract.json"), JSON.stringify({
      policyId, policyVersion: 1,
      capabilities: caps.map(c => c.id),
    }, null, 2) + "\n");

    // Write capabilities.json
    fs.writeFileSync(path.join(infernoDir, "capabilities.json"), JSON.stringify({
      capabilities: caps.map(c => ({
        id: c.id, description: c.description,
        since: new Date().toISOString().slice(0, 10), source: `template:${templateName}`,
      })),
    }, null, 2) + "\n");

    // Write one scenario per capability
    for (const cap of caps) {
      fs.writeFileSync(path.join(scenDir, `${cap.id}.json`), JSON.stringify({
        id: `${cap.id}-happy-path`, capability: cap.id,
        description: `Happy path for ${cap.description || cap.id}`,
        steps: [
          { action: "invoke", target: cap.id, input: {} },
          { action: "assert", field: "status", value: "success" },
        ],
        capabilitiesCovered: [cap.id],
      }, null, 2) + "\n");
    }

    // Write CHANGELOG.md
    writeChangelog(path.join(infernoDir, "CHANGELOG.md"), policyId);

    // Write CONTEXT.md hint
    fs.writeFileSync(path.join(infernoDir, "CONTEXT.md"),
      `# ${policyId} — infernoflow context\n\n> Template: ${templateName} — ${tmpl.description}\n\n## Hint\n${tmpl.contextHint}\n\n## Capabilities (${caps.length})\n${caps.map(c => `- \`${c.id}\`: ${c.description}`).join("\n")}\n`
    );

    if (tmpl.scripts) {
      info(`Suggested package.json scripts for this template:`);
      Object.entries(tmpl.scripts).forEach(([k, v]) => console.log(`  ${bold(k)}: ${gray(v)}`));
      console.log();
    }

    done(`Initialised from template ${bold(cyan(templateName))} — ${bold(String(caps.length))} capabilities`);
    console.log();
    info(`Run ${cyan("infernoflow vibe")} to start vibe coding mode`);
    console.log();
    return;
  }
  const cursorHooks = args.includes("--cursor-hooks");
  const vscodeCopilotHooks = args.includes("--vscode-copilot-hooks");
  const reportJson = args.includes("--report-json");
  const reportJsonOnly = args.includes("--report-json-only");
  const reportHumanOnly = args.includes("--report-human-only");
  const langOverride = getArgValue(args, "--lang");
  const frameworkOverride = getArgValue(args, "--framework");
  const projectTypeOverride = getArgValue(args, "--project-type");
  const silent = reportJsonOnly;

  if (reportJsonOnly && reportHumanOnly) {
    console.error("Error: --report-json-only and --report-human-only cannot be used together.");
    process.exit(1);
  }

  if (!silent) {
    header("init");
  }

  const infernoDir = path.join(cwd, "inferno");
  const workflowsDir = path.join(cwd, ".github", "workflows");
  if (fs.existsSync(infernoDir) && !force) {
    if (silent) {
      console.log(JSON.stringify({ ok: false, error: "inferno_exists", hint: "Use --force to overwrite" }, null, 2));
      process.exit(1);
    }
    warn("inferno/ already exists. Use --force to overwrite.");
    console.log();
    process.exit(0);
  }

  const detectedName = detectProjectName(cwd);
  const defaultCaps = "CreateTask, ReadTasks, UpdateTask, ToggleComplete, DeleteTask";

  let policyId = detectedName;
  let capabilities = defaultCaps.split(",").map(c => c.trim());

  if (adopt) {
    const profileOverrides = {
      language: langOverride || undefined,
      framework: frameworkOverride || undefined,
      projectType: projectTypeOverride || undefined,
    };
    let signals = discoverProjectSignals(cwd, profileOverrides);
    if (!yes && !reportJsonOnly) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const profile = signals.developmentProfile || {};
      const detected = profile.detected || {};
      console.log(gray("  Review inferred development stack (press Enter to accept detected values)\n"));
      const language = await ask(rl, "Language", profile.language || detected.language || "unknown");
      const framework = await ask(rl, "Framework", profile.framework || detected.framework || "unknown");
      const projectType = await ask(rl, "Project type", profile.projectType || detected.projectType || "unknown");
      rl.close();
      signals = discoverProjectSignals(cwd, { language, framework, projectType });
    }
    const inferred = signals.capabilities;
    const summarized = summarizeCapabilities(inferred);
    if (reportJsonOnly) {
      console.log(
        JSON.stringify(
          {
            mode: "adopt",
            policyId: detectedName,
            inferredCapabilities: summarized,
            components: signals.components,
            displayFields: signals.displayFields,
            externalLibraries: signals.externalLibraries,
            uiLayout: signals.uiLayout,
            styling: signals.styling,
            developmentProfile: signals.developmentProfile,
            apiCalls: signals.apiCalls,
          },
          null,
          2
        )
      );
    } else {
      console.log();
      console.log(gray(buildAdoptionReport(inferred)));
      console.log();
      console.log(gray(buildSignalsReport(signals)));
      console.log();
      if (reportJson && !reportHumanOnly) {
        console.log(
          JSON.stringify(
            {
              mode: "adopt",
              policyId: detectedName,
              inferredCapabilities: summarized,
              components: signals.components,
              displayFields: signals.displayFields,
              externalLibraries: signals.externalLibraries,
              uiLayout: signals.uiLayout,
              styling: signals.styling,
              developmentProfile: signals.developmentProfile,
              apiCalls: signals.apiCalls,
            },
            null,
            2
          )
        );
        console.log();
      }
    }
    const reviewed = await reviewCapabilitiesInteractive(inferred, yes);
    policyId = detectedName;
    capabilities = reviewed.map((c) => c.id);
  } else if (!yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(gray("  Press Enter to accept defaults\n"));
    policyId = await ask(rl, "Project / policy name", detectedName);
    const capsRaw = await ask(rl, "Capabilities (comma-separated)", defaultCaps);
    capabilities = capsRaw.split(",").map(c => c.trim()).filter(Boolean);
    rl.close();
    console.log();
  }

  // Write files
  fs.mkdirSync(infernoDir, { recursive: true });

  if (adopt) {
    const capDetails = capabilities.map((id) => ({
      id,
      title: id.replace(/([A-Z])/g, " $1").trim(),
    }));
    const signals = discoverProjectSignals(cwd, {
      language: langOverride || undefined,
      framework: frameworkOverride || undefined,
      projectType: projectTypeOverride || undefined,
    });
    writeAdoptionBaseline(infernoDir, policyId, capDetails, signals);
    if (!silent) {
      ok("Created: " + cyan("inferno/contract.json"));
      ok("Created: " + cyan("inferno/capabilities.json"));
      ok("Created: " + cyan("inferno/scenarios/adoption_baseline.json"));
      ok("Created: " + cyan("inferno/adoption_profile.json"));
      ok("Created: " + cyan("inferno/CHANGELOG.md"));
    }
  } else {
    writeContract(path.join(infernoDir, "contract.json"), policyId, capabilities);
    if (!silent) ok("Created: " + cyan("inferno/contract.json"));

    writeCapabilities(path.join(infernoDir, "capabilities.json"), capabilities);
    if (!silent) ok("Created: " + cyan("inferno/capabilities.json"));

    writeScenario(path.join(infernoDir, "scenarios"), capabilities);
    if (!silent) ok("Created: " + cyan("inferno/scenarios/happy_path.json"));

    writeChangelog(path.join(infernoDir, "CHANGELOG.md"), policyId);
    if (!silent) ok("Created: " + cyan("inferno/CHANGELOG.md"));
  }

  // Copy doc-gate script
  const templates = getTemplatesRoot();
  const srcScript = path.join(templates, "scripts", "inferno-doc-gate.mjs");
  const dstScript = path.join(cwd, "scripts", "inferno-doc-gate.mjs");
  copyFile(srcScript, dstScript, force, silent);
  const srcHookScript = path.join(templates, "scripts", "inferno-install-hooks.mjs");
  const dstHookScript = path.join(cwd, "scripts", "inferno-install-hooks.mjs");
  copyFile(srcHookScript, dstHookScript, force, silent);
  const srcWorkflow = path.join(templates, "ci", "github-inferno-check.yml");
  const dstWorkflow = path.join(workflowsDir, "infernoflow-check.yml");
  copyFile(srcWorkflow, dstWorkflow, force, silent);

  upsertScripts(cwd, silent);

  if (cursorHooks) {
    installCursorHooksArtifacts({
      cwd,
      templatesRoot: templates,
      force,
      silent,
      logOk: (msg) => {
        if (!silent) ok(msg);
      },
      logWarn: (msg) => {
        if (!silent) warn(msg);
      },
    });
  }
  if (vscodeCopilotHooks) {
    installVsCodeCopilotHooksArtifacts({
      cwd,
      templatesRoot: templates,
      force,
      silent,
      logOk: (msg) => {
        if (!silent) ok(msg);
      },
      logWarn: (msg) => {
        if (!silent) warn(msg);
      },
    });
  }

  if (adopt) {
    const statePath = path.join(infernoDir, "context-state.json");
    let state = {};
    try {
      state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {}
    const signals = discoverProjectSignals(cwd, {
      language: langOverride || undefined,
      framework: frameworkOverride || undefined,
      projectType: projectTypeOverride || undefined,
    });
    state.stack = signals.developmentProfile;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
    if (!silent) ok("Created: " + cyan("inferno/context-state.json"));
  }

  if (!silent) {
    done("infernoflow initialized!");

    // AI provider nudge — show once at init if nothing is configured
    const intPath = path.join(infernoDir, "integrations.json");
    const hasAiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ||
                     process.env.GOOGLE_AI_API_KEY || process.env.OPENROUTER_API_KEY ||
                     process.env.GEMINI_API_KEY;
    if (!hasAiKey && !fs.existsSync(intPath)) {
      console.log();
      console.log(`  ${yellow("💡")} ${bold("Tip:")} connect an AI provider for explain, why, review, and changelog AI.`);
      console.log(`     ${cyan("infernoflow ai setup")}  — takes 60 seconds`);
    }

    nextSteps([
      cyan("infernoflow status") + "  — see your contract at a glance",
      cyan("infernoflow check") + "   — validate everything",
      (adopt ? "Review inferred baseline in " : "Edit ") + yellow("inferno/capabilities.json") + (adopt ? " and refine IDs/titles" : " to describe each capability in detail"),
      "Add more " + yellow("inferno/scenarios/*.json") + " files for edge cases",
      "Add " + cyan("inferno:check") + " to your CI pipeline",
      ...(cursorHooks
        ? [
            "Restart Cursor — hooks write assistant text to " + yellow("inferno/CONTEXT.draft.md"),
            "Promote when ready: " + cyan("npm run inferno:promote-draft -- --append-notes"),
          ]
        : []),
      ...(vscodeCopilotHooks
        ? [
            "Restart VS Code — Copilot hooks append prompts + assistant (from transcript) to " +
              yellow("inferno/CONTEXT.draft.md"),
            "Promote when ready: " + cyan("npm run inferno:promote-draft -- --append-notes"),
          ]
        : []),
      ...(!cursorHooks && !vscodeCopilotHooks
        ? [
            "Optional: " +
              cyan("infernoflow install-cursor-hooks") +
              " or " +
              cyan("infernoflow install-vscode-copilot-hooks"),
          ]
        : []),
    ]);
  }
}
