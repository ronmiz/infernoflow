/**
 * infernoflow upgrade
 *
 * Converts a lite infernoflow setup (3 files) into the full setup —
 * scenarios/, CHANGELOG.md, package.json scripts, and optionally hooks.
 *
 * Run this when a small project grows and needs the full capability contract,
 * coverage tracking, and changelog management.
 *
 * Usage:
 *   infernoflow upgrade              Interactive upgrade
 *   infernoflow upgrade --yes        Skip prompts, upgrade everything
 *   infernoflow upgrade --dry-run    Show what would be created
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

const INFERNO_DIR = "inferno";

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }

export async function upgradeCommand(args) {
  const cwd     = process.cwd();
  const dryRun  = args.includes("--dry-run");
  const yes     = args.includes("--yes") || args.includes("-y");

  console.log("\n  " + bold("🔥 infernoflow upgrade"));
  console.log("  " + "─".repeat(50) + "\n");

  const infernoDir = path.join(cwd, INFERNO_DIR);

  if (!fs.existsSync(infernoDir)) {
    console.error(red("  ✘ inferno/ not found — run: infernoflow init --lite first\n"));
    process.exit(1);
  }

  const liteMark    = path.join(infernoDir, ".lite");
  const isLite      = fs.existsSync(liteMark);
  const contract    = readJSON(path.join(infernoDir, "contract.json"));
  const policyId    = contract?.policyId || path.basename(cwd);
  const caps        = contract?.capabilities || [];

  if (!isLite) {
    console.log(yellow("  ⚠  This project is already on the full setup — nothing to upgrade.\n"));
    return;
  }

  console.log(gray(`  Project: ${policyId}`));
  console.log(gray(`  Capabilities: ${caps.length || 0}`));
  console.log(gray(`  Mode: lite → full\n`));

  const created = [];

  const write = (relPath, content) => {
    const full = path.join(cwd, relPath);
    if (fs.existsSync(full)) {
      console.log(gray(`  skipped (exists): ${relPath}`));
      return;
    }
    if (dryRun) {
      console.log(cyan(`  would create: ${relPath}`));
      return;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    console.log(green(`  ✔ Created: ${relPath}`));
    created.push(relPath);
  };

  // ── scenarios/ ──────────────────────────────────────────────────────────────
  if (caps.length) {
    const scenario = {
      scenarioId: "happy_path",
      description: "Basic happy-path covering all capabilities",
      capabilitiesCovered: caps,
      steps: caps.map(c => ({ action: c, expect: `${c} works as expected` })),
    };
    write(
      path.join(INFERNO_DIR, "scenarios", "happy_path.json"),
      JSON.stringify(scenario, null, 2) + "\n"
    );
  } else {
    if (!dryRun) fs.mkdirSync(path.join(infernoDir, "scenarios"), { recursive: true });
    console.log(gray("  created: inferno/scenarios/ (empty — add scenarios as you define capabilities)"));
  }

  // ── CHANGELOG.md ──────────────────────────────────────────────────────────
  write(
    path.join(INFERNO_DIR, "CHANGELOG.md"),
    `# Changelog — ${policyId}\n\n## Unreleased\n\n- Upgraded from lite setup\n\n## 0.1.0 — Initial release\n\n- Project initialized with infernoflow\n`
  );

  // ── Upgrade contract.json — add rules + remove lite flag ──────────────────
  if (!dryRun && contract) {
    contract.rules = {
      docsRequiredOnCapabilityChange: true,
      requireScenarioForEachCapability: false, // warning only, not error
      requireChangelogOnCapabilityChange: true,
    };
    delete contract.lite;
    fs.writeFileSync(path.join(infernoDir, "contract.json"), JSON.stringify(contract, null, 2) + "\n");
    console.log(green("  ✔ Updated: inferno/contract.json (added rules)"));
    created.push("inferno/contract.json");
  }

  // ── package.json scripts ───────────────────────────────────────────────────
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath) && !dryRun) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.scripts = pkg.scripts || {};
    let changed = false;
    const toAdd = {
      "inferno:check":  "infernoflow check",
      "inferno:context": "infernoflow context",
      "inferno:theme":  "infernoflow theme",
    };
    for (const [k, v] of Object.entries(toAdd)) {
      if (!pkg.scripts[k]) { pkg.scripts[k] = v; changed = true; }
    }
    if (changed) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      console.log(green("  ✔ Updated: package.json scripts (inferno:check, inferno:context, inferno:theme)"));
      created.push("package.json");
    }
  } else if (dryRun) {
    console.log(cyan("  would update: package.json scripts"));
  }

  // ── Remove .lite marker ────────────────────────────────────────────────────
  if (!dryRun && fs.existsSync(liteMark)) {
    fs.unlinkSync(liteMark);
    console.log(green("  ✔ Removed .lite marker — now on full setup"));
  }

  console.log();

  if (dryRun) {
    console.log(yellow("  ⚑ Dry run — nothing written. Remove --dry-run to apply.\n"));
    return;
  }

  if (!created.length) {
    console.log(gray("  Nothing new to create — already fully set up.\n"));
    return;
  }

  console.log("  " + bold("Upgrade complete!"));
  console.log("  " + cyan("→") + " Run " + cyan("infernoflow check") + " to validate the contract");
  console.log("  " + cyan("→") + " Run " + cyan("infernoflow vibe") + " to start auto-sync mode");
  console.log();
}
