import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { header, ok, warn, done, nextSteps, cyan, yellow, gray } from "../ui/output.mjs";

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

function copyFile(src, dst, force) {
  if (fs.existsSync(dst) && !force) {
    warn("Skipped (exists): " + path.relative(process.cwd(), dst));
    return false;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  ok("Created: " + cyan(path.relative(process.cwd(), dst)));
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

function upsertScripts(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts || {};
  let changed = false;
  const toAdd = {
    "inferno:check":  "infernoflow check",
    "inferno:status": "infernoflow status",
    "inferno:gate":   "infernoflow doc-gate"
  };
  for (const [k, v] of Object.entries(toAdd)) {
    if (!pkg.scripts[k]) { pkg.scripts[k] = v; changed = true; }
  }
  if (changed) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    ok("Updated " + cyan("package.json") + " scripts");
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

  header("init");

  const infernoDir = path.join(cwd, "inferno");
  if (fs.existsSync(infernoDir) && !force) {
    warn("inferno/ already exists. Use --force to overwrite.");
    console.log();
    process.exit(0);
  }

  const detectedName = detectProjectName(cwd);
  const defaultCaps = "CreateTask, ReadTasks, UpdateTask, ToggleComplete, DeleteTask";

  let policyId = detectedName;
  let capabilities = defaultCaps.split(",").map(c => c.trim());

  if (!yes) {
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

  writeContract(path.join(infernoDir, "contract.json"), policyId, capabilities);
  ok("Created: " + cyan("inferno/contract.json"));

  writeCapabilities(path.join(infernoDir, "capabilities.json"), capabilities);
  ok("Created: " + cyan("inferno/capabilities.json"));

  writeScenario(path.join(infernoDir, "scenarios"), capabilities);
  ok("Created: " + cyan("inferno/scenarios/happy_path.json"));

  writeChangelog(path.join(infernoDir, "CHANGELOG.md"), policyId);
  ok("Created: " + cyan("inferno/CHANGELOG.md"));

  // Copy doc-gate script
  const templates = getTemplatesRoot();
  const srcScript = path.join(templates, "scripts", "inferno-doc-gate.mjs");
  const dstScript = path.join(cwd, "scripts", "inferno-doc-gate.mjs");
  copyFile(srcScript, dstScript, force);

  upsertScripts(cwd);

  done("infernoflow initialized!");

  nextSteps([
    cyan("infernoflow status") + "  — see your contract at a glance",
    cyan("infernoflow check") + "   — validate everything",
    "Edit " + yellow("inferno/capabilities.json") + " to describe each capability in detail",
    "Add more " + yellow("inferno/scenarios/*.json") + " files for edge cases",
    "Add " + cyan("inferno:check") + " to your CI pipeline"
  ]);
}
