import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { header, ok, warn, done, nextSteps, cyan, yellow, gray } from "../ui/output.mjs";
import {
  discoverProjectSignals,
  reviewCapabilitiesInteractive,
  writeAdoptionBaseline,
  buildAdoptionReport,
  summarizeCapabilities,
  buildSignalsReport,
} from "./adopt.mjs";

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

export async function initCommand(args) {
  const cwd = process.cwd();
  const force = args.includes("--force") || args.includes("-f");
  const yes = args.includes("--yes") || args.includes("-y");
  const adopt = args.includes("--adopt");
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

    nextSteps([
      cyan("infernoflow status") + "  — see your contract at a glance",
      cyan("infernoflow check") + "   — validate everything",
      (adopt ? "Review inferred baseline in " : "Edit ") + yellow("inferno/capabilities.json") + (adopt ? " and refine IDs/titles" : " to describe each capability in detail"),
      "Add more " + yellow("inferno/scenarios/*.json") + " files for edge cases",
      "Add " + cyan("inferno:check") + " to your CI pipeline"
    ]);
  }
}
