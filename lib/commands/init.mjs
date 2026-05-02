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
import { installVsCodeCopilotHooksArtifacts } from "../vsCodeCopilotHooksInstall.mjs";

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

/** Default init: memory-only, asks for first gotcha, 60 seconds */
async function initMemory(cwd, force, yes) {
  const { bold, cyan, gray, green, yellow } = await import("../ui/output.mjs");

  const infernoDir = path.join(cwd, "inferno");
  const sessionsFile = path.join(infernoDir, "sessions.jsonl");
  const configFile   = path.join(infernoDir, "config.json");

  if (fs.existsSync(infernoDir) && !force) {
    // Already initialized — just confirm and show commands
    console.log("\n  " + bold("🔥 infernoflow") + gray(" — already set up\n"));
    console.log("  " + green("✔") + " inferno/ found\n");
    console.log("  Quick commands:");
    console.log("  " + cyan("infernoflow log \"...\"") + gray("    — remember something"));
    console.log("  " + cyan("infernoflow switch") + gray("         — handoff to next AI"));
    console.log("  " + cyan("infernoflow recap") + gray("          — session summary\n"));
    console.log(gray("  For contracts & CI gates: infernoflow init --mode full\n"));
    return;
  }

  const projectName = detectProjectName(cwd);

  console.log("\n  " + bold("🔥 infernoflow") + gray(" — let's get you set up (30 seconds)\n"));
  console.log("  Detected: " + cyan(projectName) + "\n");

  // Create inferno/ directory
  fs.mkdirSync(infernoDir, { recursive: true });

  // Write minimal config
  fs.writeFileSync(configFile, JSON.stringify({
    project: projectName,
    version: "1",
    mode: "memory",
    created: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");

  // Create empty sessions.jsonl
  if (!fs.existsSync(sessionsFile)) {
    fs.writeFileSync(sessionsFile, "", "utf8");
  }

  // Ask for first gotcha (skip if --yes or not TTY)
  let gotcha = "";
  if (!yes && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    gotcha = await new Promise(resolve => {
      rl.question(
        "  " + gray("What should the next AI agent know about this project?\n  > "),
        ans => { rl.close(); resolve(ans.trim()); }
      );
    });
  }

  if (gotcha) {
    const entry = {
      ts: new Date().toISOString(),
      agent: "user",
      type: "gotcha",
      summary: gotcha,
      source: "init",
    };
    fs.appendFileSync(sessionsFile, JSON.stringify(entry) + "\n", "utf8");
    console.log("\n  " + green("✔") + " First gotcha logged!");
  }

  console.log("\n  " + green("✔") + " You're set up. Quick commands:\n");
  console.log("  " + cyan("infernoflow log \"...\"") + gray("    — remember something"));
  console.log("  " + cyan("infernoflow switch") + gray("         — generate handoff for next AI"));
  console.log("  " + cyan("infernoflow recap") + gray("          — session summary\n"));
  console.log(gray("  Tip: infernoflow switch --copy puts the handoff on your clipboard.\n"));
  console.log(gray("  Want contracts & CI gates? Run: infernoflow init --mode full\n"));
}

export async function initCommand(args) {
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
