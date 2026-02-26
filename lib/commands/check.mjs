import * as fs from "node:fs";
import * as path from "node:path";
import { header, ok, fail, warn, info, section, done, errorAndExit, cyan, bold, red, green, yellow, gray } from "../ui/output.mjs";
import { docGateCommand } from "./docGate.mjs";

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (err) {
    errorAndExit(
      `Cannot parse ${path.basename(filePath)}`,
      `Check JSON syntax in: ${filePath}`
    );
  }
}

function getScenarioFiles(scenariosDir) {
  if (!fs.existsSync(scenariosDir)) return [];
  return fs.readdirSync(scenariosDir)
    .filter(f => f.endsWith(".json"))
    .map(f => path.join(scenariosDir, f));
}

function getCovered(scenarioFiles) {
  const covered = new Set();
  for (const f of scenarioFiles) {
    try {
      const s = JSON.parse(fs.readFileSync(f, "utf8"));
      (s.capabilitiesCovered || []).forEach(c => covered.add(c));
    } catch {}
  }
  return covered;
}

export async function checkCommand(args) {
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const skipDocGate = args.includes("--skip-doc-gate");
  const jsonOut = args.includes("--json");

  if (!jsonOut) header("check");

  const errors = [];
  const warnings = [];

  // ── inferno/ exists ─────────────────────────────────────────────
  if (!fs.existsSync(infernoDir)) {
    if (jsonOut) { console.log(JSON.stringify({ ok: false, errors: ["inferno/ not found"] })); process.exit(1); }
    errorAndExit("inferno/ not found", `Run: infernoflow init`);
  }

  // ── contract.json ───────────────────────────────────────────────
  const contractPath = path.join(infernoDir, "contract.json");
  const capsPath = path.join(infernoDir, "capabilities.json");
  const scenariosDir = path.join(infernoDir, "scenarios");
  const changelogPath = path.join(infernoDir, "CHANGELOG.md");

  if (!jsonOut) section("Contract");
  if (!fs.existsSync(contractPath)) {
    fail("contract.json not found", "Run: infernoflow init");
    errors.push("contract.json missing");
  } else {
    const contract = readJson(contractPath);
    const caps = contract.capabilities || [];

    if (!contract.policyId) { fail("policyId missing"); errors.push("policyId missing"); }
    else if (!jsonOut) ok(`policyId: ${bold(contract.policyId)}`);

    if (!Number.isInteger(contract.policyVersion)) { fail("policyVersion must be an integer"); errors.push("policyVersion invalid"); }
    else if (!jsonOut) ok(`policyVersion: ${bold("v" + contract.policyVersion)}`);

    if (caps.length === 0) { fail("capabilities array is empty"); errors.push("no capabilities"); }
    else if (!jsonOut) ok(`${caps.length} capabilities declared`);

    // ── capabilities.json ────────────────────────────────────────
    if (!jsonOut) section("Capabilities Registry");
    if (!fs.existsSync(capsPath)) {
      fail("capabilities.json not found"); errors.push("capabilities.json missing");
    } else {
      const registry = readJson(capsPath);
      const registryIds = new Set((registry.capabilities || []).map(c => c?.id).filter(Boolean));

      const missingInRegistry = caps.filter(c => !registryIds.has(c));
      if (missingInRegistry.length > 0) {
        missingInRegistry.forEach(c => {
          if (!jsonOut) fail(`"${c}" in contract but missing from capabilities.json`, `Add it to inferno/capabilities.json`);
          errors.push(`"${c}" not registered`);
        });
      } else if (!jsonOut) {
        ok(`All ${registryIds.size} capabilities registered`);
      }

      // ── scenarios ───────────────────────────────────────────────
      if (!jsonOut) section("Scenarios");
      const scenarioFiles = getScenarioFiles(scenariosDir);
      if (scenarioFiles.length === 0) {
        warn("No scenarios found"); warnings.push("no scenarios");
      } else {
        const covered = getCovered(scenarioFiles);
        const requireCoverage = contract?.rules?.requireScenarioForEachCapability !== false;
        const uncovered = caps.filter(c => !covered.has(c));

        if (!jsonOut) ok(`${scenarioFiles.length} scenario file(s) found`);

        if (uncovered.length > 0 && requireCoverage) {
          uncovered.forEach(c => {
            if (!jsonOut) fail(`"${c}" has no scenario coverage`, `Add to capabilitiesCovered in a scenario file`);
            errors.push(`"${c}" uncovered`);
          });
        } else if (!jsonOut) {
          ok(`All capabilities covered by scenarios`);
        }
      }
    }
  }

  // ── CHANGELOG ────────────────────────────────────────────────────
  if (!jsonOut) section("Changelog");
  if (!fs.existsSync(changelogPath)) {
    fail("inferno/CHANGELOG.md not found"); errors.push("CHANGELOG missing");
  } else {
    const txt = fs.readFileSync(changelogPath, "utf8");
    if (!/##\s+Unreleased/i.test(txt)) {
      fail("Missing '## Unreleased' section", "Add it to inferno/CHANGELOG.md");
      errors.push("CHANGELOG missing Unreleased");
    } else if (!jsonOut) {
      ok("CHANGELOG.md has ## Unreleased section");
    }
  }

  // ── doc-gate ─────────────────────────────────────────────────────
  if (!skipDocGate) {
    if (!jsonOut) section("Doc Gate");
    await docGateCommand({ silent: jsonOut, captureExit: true }).catch(() => {
      errors.push("doc-gate failed");
    });
  }

  // ── Summary ──────────────────────────────────────────────────────
  if (jsonOut) {
    console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings }, null, 2));
    if (errors.length > 0) process.exit(1);
    return;
  }

  console.log();
  if (errors.length > 0) {
    console.log("  " + red(`✘ check failed — ${errors.length} error(s)\n`));
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log("  " + yellow(`⚠  check passed with ${warnings.length} warning(s)\n`));
  } else {
    done("check passed — everything is in sync");
  }
}
