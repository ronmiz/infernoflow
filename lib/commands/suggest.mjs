import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { header, ok, fail, warn, info, done, section, nextSteps, bold, cyan, gray, yellow, green, red, errorAndExit } from "../ui/output.mjs";
import { personalisePrompt } from "../learning/adapt.mjs";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function readJson(filePath) {
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

export function buildPrompt({ description, contract, capabilities, scenarios }) {
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

export function validateSuggestion(suggestion) {
  const errors = [];
  if (!suggestion || typeof suggestion !== "object") {
    return ["AI response must be a JSON object."];
  }
  if (suggestion.summary != null && typeof suggestion.summary !== "string") {
    errors.push(`"summary" must be a string.`);
  }
  if (!Array.isArray(suggestion.newCapabilities)) {
    errors.push(`"newCapabilities" must be an array.`);
  }
  if (!Array.isArray(suggestion.removedCapabilities)) {
    errors.push(`"removedCapabilities" must be an array.`);
  }
  if (!Array.isArray(suggestion.updatedScenarios)) {
    errors.push(`"updatedScenarios" must be an array.`);
  }
  if (suggestion.changelogEntry != null && typeof suggestion.changelogEntry !== "string") {
    errors.push(`"changelogEntry" must be a string.`);
  }

  for (const c of suggestion.newCapabilities || []) {
    if (!c || typeof c !== "object") {
      errors.push(`Each item in "newCapabilities" must be an object.`);
      continue;
    }
    if (typeof c.id !== "string" || !/^[A-Z][A-Za-z0-9]*$/.test(c.id)) {
      errors.push(`newCapabilities[].id must be PascalCase (example: SendEmail).`);
    }
    if (typeof c.title !== "string" || !c.title.trim()) {
      errors.push(`newCapabilities[].title must be a non-empty string.`);
    }
  }

  for (const id of suggestion.removedCapabilities || []) {
    if (typeof id !== "string" || !id.trim()) {
      errors.push(`removedCapabilities[] must contain non-empty strings.`);
    }
  }

  for (const s of suggestion.updatedScenarios || []) {
    if (!s || typeof s !== "object") {
      errors.push(`Each item in "updatedScenarios" must be an object.`);
      continue;
    }
    if (typeof s.file !== "string" || !s.file.endsWith(".json")) {
      errors.push(`updatedScenarios[].file must be a .json filename.`);
    }
    if (typeof s.isNew !== "boolean") {
      errors.push(`updatedScenarios[].isNew must be boolean.`);
    }
    if (!Array.isArray(s.capabilitiesCovered) || !Array.isArray(s.stepsToAdd)) {
      errors.push(`updatedScenarios[].capabilitiesCovered and stepsToAdd must be arrays.`);
    }
  }

  return errors;
}

export function detectSuggestionConflicts(contract, suggestion) {
  const issues = [];
  const existing = new Set(contract.capabilities || []);
  const newIds = new Set((suggestion.newCapabilities || []).map((c) => c.id));
  const removed = new Set(suggestion.removedCapabilities || []);

  for (const id of newIds) {
    if (removed.has(id)) {
      issues.push(`Capability "${id}" appears in both newCapabilities and removedCapabilities.`);
    }
    if (existing.has(id)) {
      issues.push(`Capability "${id}" already exists in contract capabilities.`);
    }
  }

  for (const id of removed) {
    if (!existing.has(id)) {
      issues.push(`Capability "${id}" cannot be removed because it does not exist in contract.`);
    }
  }

  return issues;
}

export function applyChanges({ cwd, contract, capabilities, suggestion, version, quiet = false }) {
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
  const writes = [];
  const queueWrite = (filePath, content) => writes.push({ filePath, content });

  // ── contract.json ─────────────────────────────────────────────────────────
  if (newCaps.length > 0 || removedCaps.length > 0) {
    const updatedCaps = [
      ...contract.capabilities.filter(c => !removedCaps.includes(c)),
      ...newCaps.map(c => c.id)
    ];
    const nextVersion = Number(contract.policyVersion || 1) + 1;
    const contractUpdated = { ...contract, capabilities: updatedCaps, policyVersion: nextVersion };
    queueWrite(contractPath, JSON.stringify(contractUpdated, null, 2) + "\n");
    if (!quiet) ok(`contract.json updated → policyVersion: v${nextVersion}`);
    changed = true;
  }

  // ── capabilities.json ─────────────────────────────────────────────────────
  if (newCaps.length > 0 || removedCaps.length > 0) {
    const reg = capabilities ? { ...capabilities } : { schemaVersion: 1, capabilities: [] };
    reg.capabilities = (reg.capabilities || []).filter(c => !removedCaps.includes(c.id));
    for (const nc of newCaps) {
      if (!reg.capabilities.find(c => c.id === nc.id)) {
        reg.capabilities.push({ id: nc.id, title: nc.title, since: version });
      }
    }
    queueWrite(capsPath, JSON.stringify(reg, null, 2) + "\n");
    if (!quiet) ok(`capabilities.json updated`);
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
      queueWrite(filePath, JSON.stringify(scenario, null, 2) + "\n");
      if (!quiet) ok(`Created scenario: ${cyan(us.file)}`);
    } else {
      scenario = readJson(filePath);
      const existingCaps = new Set(scenario.capabilitiesCovered || []);
      (us.capabilitiesCovered || []).forEach(c => existingCaps.add(c));
      scenario.capabilitiesCovered = [...existingCaps];
      scenario.steps = [...(scenario.steps || []), ...(us.stepsToAdd || [])];
      queueWrite(filePath, JSON.stringify(scenario, null, 2) + "\n");
      if (!quiet) ok(`Updated scenario: ${cyan(us.file)}`);
    }
    changed = true;
  }

  // ── CHANGELOG.md ──────────────────────────────────────────────────────────
  if (changelogEntry && fs.existsSync(changelogPath)) {
    let txt = fs.readFileSync(changelogPath, "utf8");
    if (/##\s+Unreleased/i.test(txt)) {
      txt = txt.replace(/(##\s+Unreleased[^\n]*\n)/i, `$1\n${changelogEntry}\n`);
      queueWrite(changelogPath, txt);
      if (!quiet) ok(`CHANGELOG.md updated`);
      changed = true;
    }
  }

  const backups = new Map();
  try {
    for (const write of writes) {
      if (fs.existsSync(write.filePath)) {
        backups.set(write.filePath, fs.readFileSync(write.filePath, "utf8"));
      } else {
        backups.set(write.filePath, null);
      }
      const tmpPath = `${write.filePath}.tmp`;
      fs.writeFileSync(tmpPath, write.content);
      fs.renameSync(tmpPath, write.filePath);
    }
  } catch (err) {
    for (const [filePath, content] of backups.entries()) {
      if (content === null) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } else {
        fs.writeFileSync(filePath, content);
      }
    }
    throw new Error(`Failed applying changes. Rolled back. Details: ${err.message}`);
  }

  return changed;
}

export function parseSuggestionJson(rawInput) {
  const clean = String(rawInput || "").trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(clean);
}

export function loadSuggestContext(cwd) {
  const infernoDir = path.join(cwd, "inferno");
  const contractPath = path.join(infernoDir, "contract.json");
  const capsPath = path.join(infernoDir, "capabilities.json");
  const scenariosDir = path.join(infernoDir, "scenarios");

  const contract = readJson(contractPath);
  const capabilities = readJson(capsPath);
  const scenarios = [];
  if (fs.existsSync(scenariosDir)) {
    for (const f of fs.readdirSync(scenariosDir).filter((name) => name.endsWith(".json"))) {
      const s = readJson(path.join(scenariosDir, f));
      if (s) scenarios.push({ ...s, _file: f });
    }
  }

  let version = "0.1.0";
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    if (pkg?.version) version = pkg.version;
  }

  return { contract, capabilities, scenarios, version };
}

// ── JSON mode helpers ─────────────────────────────────────────────────────────

function jsonOut(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function jsonErr(code, message, hint) {
  jsonOut({ ok: false, error: code, message, hint });
  process.exit(1);
}

async function readStdin() {
  return new Promise(resolve => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { data += chunk; });
    process.stdin.on("end", () => resolve(data.trim()));
    // Timeout after 100ms if nothing arrives (not piped)
    setTimeout(() => resolve(""), 100);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function suggestCommand(args) {
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  const asJson   = args.includes("--json");
  const applyFlag = args.includes("--apply");

  // --response <json-string|@file>
  const respIdx = args.indexOf("--response");
  let responseRaw = respIdx !== -1 ? args[respIdx + 1] : null;

  if (!asJson) header("suggest");

  // ── Check inferno/ exists ─────────────────────────────────────────────────
  if (!fs.existsSync(infernoDir)) {
    if (asJson) jsonErr("inferno_not_found", "inferno/ not found", "Run: infernoflow init");
    errorAndExit("inferno/ not found", "Run: infernoflow init");
  }

  const contractPath = path.join(infernoDir, "contract.json");
  const capsPath = path.join(infernoDir, "capabilities.json");
  const scenariosDir = path.join(infernoDir, "scenarios");

  const contract = readJson(contractPath);
  if (!contract) {
    if (asJson) jsonErr("contract_not_found", "contract.json not found or invalid");
    errorAndExit("contract.json not found or invalid");
  }

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

  // ── Get description ───────────────────────────────────────────────────────
  const descArg = args.filter(a => !a.startsWith("-")).slice(1).join(" ");
  let description = descArg;

  if (!description && !asJson) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(gray("  Describe what changed in your code (e.g. 'added email notifications'):"));
    description = await ask(rl, `  ${cyan(">")} `);
    rl.close();
    console.log();
  }

  if (!description) {
    if (asJson) jsonErr("no_description", "No description provided", "Usage: infernoflow suggest \"what changed\" --json");
    errorAndExit("No description provided", "Usage: infernoflow suggest \"what changed\"");
  }

  // ── Build prompt (personalised to developer profile) ─────────────────────
  const rawPrompt = buildPrompt({ description, contract, capabilities, scenarios });
  const prompt = personalisePrompt(rawPrompt, infernoDir);

  // ── JSON mode: emit prompt + context, then optionally apply response ──────
  if (asJson) {
    // If no --response given, check stdin for piped JSON
    if (!responseRaw) {
      const piped = await readStdin();
      if (piped) responseRaw = piped;
    }

    // If still no response → just emit the prompt payload and exit
    if (!responseRaw) {
      jsonOut({
        ok: true,
        mode: "prompt",
        description,
        prompt,
        context: {
          policyId:     contract.policyId,
          policyVersion: contract.policyVersion,
          capabilities: contract.capabilities || [],
          scenarios:    scenarios.map(s => s._file),
          version,
        },
      });
      return;
    }

    // Response provided — parse, validate, optionally apply
    // Support @file syntax
    if (responseRaw.startsWith("@")) {
      const filePath = responseRaw.slice(1);
      try { responseRaw = fs.readFileSync(filePath, "utf8"); }
      catch { jsonErr("file_not_found", `Cannot read response file: ${filePath}`); }
    }

    let suggestion;
    try { suggestion = parseSuggestionJson(responseRaw); }
    catch (e) { jsonErr("parse_error", "Could not parse AI response as JSON", e.message); }

    const validationErrors = validateSuggestion(suggestion);
    if (validationErrors.length > 0) {
      jsonErr("validation_error", validationErrors[0], validationErrors.join("; "));
    }

    const conflictErrors = detectSuggestionConflicts(contract, suggestion);
    if (conflictErrors.length > 0) {
      jsonErr("conflict_error", conflictErrors[0], conflictErrors.join("; "));
    }

    const changes = {
      summary:      suggestion.summary || "",
      newCapabilities:   suggestion.newCapabilities   || [],
      removedCapabilities: suggestion.removedCapabilities || [],
      updatedScenarios: suggestion.updatedScenarios   || [],
      changelogEntry:   suggestion.changelogEntry     || "",
    };

    if (!applyFlag) {
      // Validate-only: return the parsed changes without writing
      jsonOut({ ok: true, mode: "validate", description, changes, applied: false });
      return;
    }

    // Apply changes
    try {
      applyChanges({ cwd, contract, capabilities, suggestion, version, quiet: true });
      jsonOut({ ok: true, mode: "apply", description, changes, applied: true });
    } catch (e) {
      jsonErr("apply_error", e.message);
    }
    return;
  }

  // ── Interactive mode (unchanged) ──────────────────────────────────────────
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

  let suggestion;
  try {
    suggestion = parseSuggestionJson(jsonInput);
  } catch {
    errorAndExit(
      "Could not parse the AI response as JSON",
      "Make sure you copied the full JSON response from the AI"
    );
  }

  const validationErrors = validateSuggestion(suggestion);
  if (validationErrors.length > 0) {
    errorAndExit(
      "AI response schema is invalid",
      validationErrors[0] + (validationErrors.length > 1 ? ` (+${validationErrors.length - 1} more)` : "")
    );
  }
  const conflictErrors = detectSuggestionConflicts(contract, suggestion);
  if (conflictErrors.length > 0) {
    errorAndExit(
      "AI response contains conflicting capability operations",
      conflictErrors[0] + (conflictErrors.length > 1 ? ` (+${conflictErrors.length - 1} more)` : "")
    );
  }

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

  const rl3 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await ask(rl3, `  Apply these changes? ${gray("(y/n)")} `);
  rl3.close();
  console.log();

  if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
    warn("Cancelled — no changes made.");
    console.log();
    process.exit(0);
  }

  section("Applying Changes");
  console.log();

  applyChanges({ cwd, contract, capabilities, suggestion, version });

  done("suggest complete!");

  nextSteps([
    cyan("infernoflow status") + "  — verify the updated contract",
    cyan("infernoflow check") + "   — validate everything",
  ]);
}
