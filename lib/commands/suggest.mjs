import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { header, ok, fail, warn, info, done, section, nextSteps, bold, cyan, gray, yellow, green, red, errorAndExit } from "../ui/output.mjs";

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return null; }
}

function ask(rl, question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

function toCapabilityId(str) {
  // "send email" → "SendEmail", "send-email" → "SendEmail"
  return str
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function buildPrompt({ description, contract, capabilities, scenarios }) {
  const capsIds = contract.capabilities || [];
  const capsDetail = (capabilities?.capabilities || [])
    .map(c => `  - ${c.id}: ${c.title || c.id}`)
    .join("\n");

  const scenarioFiles = scenarios.map(s => {
    const covered = (s.capabilitiesCovered || []).join(", ");
    const steps = (s.steps || []).map(st => `      {action: "${st.action}", expect: "${st.expect}"}`).join("\n");
    return `  File: ${s._file}\n  capabilitiesCovered: [${covered}]\n  steps:\n${steps}`;
  }).join("\n\n");

  return `You are a developer assistant for the infernoflow CLI tool.

Your job is to analyze a code change description and suggest updates to the infernoflow contract files.

## Current contract state

policyId: ${contract.policyId}
policyVersion: ${contract.policyVersion}
capabilities: [${capsIds.join(", ")}]

## Current capabilities registry
${capsDetail || "  (none)"}

## Current scenarios
${scenarioFiles || "  (none)"}

## Developer's description of what changed
"${description}"

## Your task

Respond with ONLY a valid JSON object (no markdown, no explanation) in this exact format:

{
  "summary": "one-line summary of what changed",
  "newCapabilities": [
    { "id": "CapabilityName", "title": "Human readable title", "reason": "why this is a new capability" }
  ],
  "removedCapabilities": ["CapabilityId"],
  "updatedScenarios": [
    {
      "file": "existing_scenario_filename.json or new_scenario_name.json",
      "isNew": false,
      "capabilitiesCovered": ["CapabilityId1", "CapabilityId2"],
      "stepsToAdd": [
        { "action": "CapabilityId", "expect": "what should happen" }
      ]
    }
  ],
  "changelogEntry": "- Short description of the change for CHANGELOG.md"
}

Rules:
- Only suggest capabilities that are genuinely new behaviors the system gains
- Capability IDs must be PascalCase (e.g. SendEmail, not send_email)
- If nothing changed capability-wise, return empty arrays
- changelogEntry should start with "- "
- Keep it minimal and accurate`;
}

function applyChanges({ cwd, contract, capabilities, scenarios, suggestion, version }) {
  const infernoDir = path.join(cwd, "inferno");
  const contractPath = path.join(infernoDir, "contract.json");
  const capsPath = path.join(infernoDir, "capabilities.json");
  const changelogPath = path.join(infernoDir, "CHANGELOG.md");
  const scenariosDir = path.join(infernoDir, "scenarios");

  const newCaps = suggestion.newCapabilities || [];
  const removedCaps = suggestion.removedCapabilities || [];
  const updatedScenarios = suggestion.updatedScenarios || [];
  const changelogEntry = suggestion.changelogEntry || "";

  let changed = false;

  // ── contract.json ─────────────────────────────────────────────────────────
  if (newCaps.length > 0 || removedCaps.length > 0) {
    const updatedCaps = [
      ...contract.capabilities.filter(c => !removedCaps.includes(c)),
      ...newCaps.map(c => c.id)
    ];
    contract.capabilities = updatedCaps;
    contract.policyVersion = (contract.policyVersion || 1) + 1;
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
    ok(`contract.json updated → policyVersion: v${contract.policyVersion}`);
    changed = true;
  }

  // ── capabilities.json ─────────────────────────────────────────────────────
  if (newCaps.length > 0 || removedCaps.length > 0) {
    const reg = capabilities || { schemaVersion: 1, capabilities: [] };
    reg.capabilities = reg.capabilities.filter(c => !removedCaps.includes(c.id));
    for (const nc of newCaps) {
      if (!reg.capabilities.find(c => c.id === nc.id)) {
        reg.capabilities.push({ id: nc.id, title: nc.title, since: version });
      }
    }
    fs.writeFileSync(capsPath, JSON.stringify(reg, null, 2) + "\n");
    ok(`capabilities.json updated`);
  }

  // ── scenarios ─────────────────────────────────────────────────────────────
  for (const us of updatedScenarios) {
    const filePath = path.join(scenariosDir, us.file);
    let scenario;

    if (us.isNew || !fs.existsSync(filePath)) {
      scenario = {
        scenarioId: us.file.replace(".json", ""),
        description: suggestion.summary || "",
        capabilitiesCovered: us.capabilitiesCovered || [],
        steps: us.stepsToAdd || []
      };
      fs.writeFileSync(filePath, JSON.stringify(scenario, null, 2) + "\n");
      ok(`Created scenario: ${cyan(us.file)}`);
    } else {
      scenario = readJson(filePath);
      const existingCaps = new Set(scenario.capabilitiesCovered || []);
      (us.capabilitiesCovered || []).forEach(c => existingCaps.add(c));
      scenario.capabilitiesCovered = [...existingCaps];
      scenario.steps = [...(scenario.steps || []), ...(us.stepsToAdd || [])];
      fs.writeFileSync(filePath, JSON.stringify(scenario, null, 2) + "\n");
      ok(`Updated scenario: ${cyan(us.file)}`);
    }
    changed = true;
  }

  // ── CHANGELOG.md ──────────────────────────────────────────────────────────
  if (changelogEntry && fs.existsSync(changelogPath)) {
    let txt = fs.readFileSync(changelogPath, "utf8");
    if (/##\s+Unreleased/i.test(txt)) {
      txt = txt.replace(/(##\s+Unreleased[^\n]*\n)/i, `$1\n${changelogEntry}\n`);
      fs.writeFileSync(changelogPath, txt);
      ok(`CHANGELOG.md updated`);
      changed = true;
    }
  }

  return changed;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function suggestCommand(args) {
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  header("suggest");

  // ── Check inferno/ exists ─────────────────────────────────────────────────
  if (!fs.existsSync(infernoDir)) {
    errorAndExit("inferno/ not found", "Run: infernoflow init");
  }

  const contractPath = path.join(infernoDir, "contract.json");
  const capsPath = path.join(infernoDir, "capabilities.json");
  const scenariosDir = path.join(infernoDir, "scenarios");

  const contract = readJson(contractPath);
  if (!contract) errorAndExit("contract.json not found or invalid");

  const capabilities = readJson(capsPath);

  // Load scenarios
  const scenarios = [];
  if (fs.existsSync(scenariosDir)) {
    for (const f of fs.readdirSync(scenariosDir).filter(f => f.endsWith(".json"))) {
      const s = readJson(path.join(scenariosDir, f));
      if (s) scenarios.push({ ...s, _file: f });
    }
  }

  // Get version from package.json
  let version = "0.1.0";
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    if (pkg?.version) version = pkg.version;
  }

  // ── Get description from args or prompt ───────────────────────────────────
  const descArg = args.filter(a => !a.startsWith("-")).slice(1).join(" ");
  let description = descArg;

  if (!description) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(gray("  Describe what changed in your code (e.g. 'added email notifications'):"));
    description = await ask(rl, `  ${cyan(">")} `);
    rl.close();
    console.log();
  }

  if (!description) {
    errorAndExit("No description provided", "Usage: infernoflow suggest \"what changed\"");
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  const prompt = buildPrompt({ description, contract, capabilities, scenarios });

  // ── Show prompt + instructions ────────────────────────────────────────────
  section("Generated Prompt");
  console.log();
  console.log(gray("─".repeat(50)));
  console.log(prompt);
  console.log(gray("─".repeat(50)));
  console.log();

  info("Copy the prompt above and paste it into:");
  console.log(`  ${cyan("•")} Claude  → https://claude.ai`);
  console.log(`  ${cyan("•")} ChatGPT → https://chatgpt.com`);
  console.log(`  ${cyan("•")} Copilot, Cursor, or any AI you use`);
  console.log();
  warn("The AI will respond with a JSON object.");
  console.log();

  // ── Get AI response ───────────────────────────────────────────────────────
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(gray("  Paste the AI's JSON response below, then press Enter twice:"));
  console.log();

  let jsonInput = "";
  let emptyLines = 0;

  await new Promise(resolve => {
    rl2.on("line", line => {
      if (line.trim() === "") {
        emptyLines++;
        if (emptyLines >= 2 && jsonInput.trim()) resolve();
      } else {
        emptyLines = 0;
        jsonInput += line + "\n";
      }
    });
    rl2.on("close", resolve);
  });

  rl2.close();

  // ── Parse response ────────────────────────────────────────────────────────
  let suggestion;
  try {
    const clean = jsonInput.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    suggestion = JSON.parse(clean);
  } catch {
    errorAndExit(
      "Could not parse the AI response as JSON",
      "Make sure you copied the full JSON response from the AI"
    );
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  section("Proposed Changes");
  console.log();

  if (suggestion.summary) {
    console.log(`  ${bold("Summary:")} ${suggestion.summary}`);
    console.log();
  }

  const newCaps = suggestion.newCapabilities || [];
  const removedCaps = suggestion.removedCapabilities || [];
  const updatedScenarios = suggestion.updatedScenarios || [];

  if (newCaps.length === 0 && removedCaps.length === 0 && updatedScenarios.length === 0) {
    ok("No capability changes detected — nothing to apply.");
    console.log();
    process.exit(0);
  }

  if (newCaps.length > 0) {
    console.log(`  ${green("+")} New capabilities:`);
    newCaps.forEach(c => console.log(`      ${green(c.id)} — ${gray(c.title)}`));
    console.log();
  }

  if (removedCaps.length > 0) {
    console.log(`  ${red("-")} Removed capabilities:`);
    removedCaps.forEach(c => console.log(`      ${red(c)}`));
    console.log();
  }

  if (updatedScenarios.length > 0) {
    console.log(`  ${cyan("~")} Scenario updates:`);
    updatedScenarios.forEach(s => {
      const tag = s.isNew ? green("[new]") : cyan("[update]");
      console.log(`      ${tag} ${s.file}`);
    });
    console.log();
  }

  if (suggestion.changelogEntry) {
    console.log(`  ${yellow("📝")} Changelog: ${gray(suggestion.changelogEntry)}`);
    console.log();
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  const rl3 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await ask(rl3, `  Apply these changes? ${gray("(y/n)")} `);
  rl3.close();
  console.log();

  if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
    warn("Cancelled — no changes made.");
    console.log();
    process.exit(0);
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  section("Applying Changes");
  console.log();

  applyChanges({ cwd, contract, capabilities, scenarios, suggestion, version });

  done("suggest complete!");

  nextSteps([
    cyan("infernoflow status") + "  — verify the updated contract",
    cyan("infernoflow check") + "   — validate everything",
  ]);
}
