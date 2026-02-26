import * as fs from "node:fs";
import * as path from "node:path";
import { header, ok, fail, warn, info, section, bold, cyan, yellow, gray, green, red, white } from "../ui/output.mjs";

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function getCoverage(scenariosDir, caps) {
  const covered = new Set();
  if (fs.existsSync(scenariosDir)) {
    for (const f of fs.readdirSync(scenariosDir).filter(f => f.endsWith(".json"))) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
        (s.capabilitiesCovered || []).forEach(c => covered.add(c));
      } catch {}
    }
  }
  return { covered: caps.filter(c => covered.has(c)), uncovered: caps.filter(c => !covered.has(c)) };
}

export async function statusCommand() {
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  header("status");

  if (!fs.existsSync(infernoDir)) {
    fail("inferno/ not found", `Run: infernoflow init`);
    console.log();
    process.exit(1);
  }

  const contractPath = path.join(infernoDir, "contract.json");
  if (!fs.existsSync(contractPath)) {
    fail("contract.json not found");
    console.log();
    process.exit(1);
  }

  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const caps = contract.capabilities || [];
  const stat = fs.statSync(contractPath);
  const scenariosDir = path.join(infernoDir, "scenarios");
  const changelogPath = path.join(infernoDir, "CHANGELOG.md");
  const capsPath = path.join(infernoDir, "capabilities.json");

  // ── Project ─────────────────────────────────────────────────────
  section("Project");
  console.log(`  ${gray("policy")}       ${bold(contract.policyId || "—")}`);
  console.log(`  ${gray("version")}      ${bold("v" + (contract.policyVersion || "?"))}`);
  console.log(`  ${gray("last change")}  ${gray(timeAgo(stat.mtimeMs))}`);

  // ── Capabilities ─────────────────────────────────────────────────
  section(`Capabilities  ${gray("(" + caps.length + ")")}`);

  let capsRegistry = {};
  if (fs.existsSync(capsPath)) {
    try {
      const reg = JSON.parse(fs.readFileSync(capsPath, "utf8"));
      (reg.capabilities || []).forEach(c => { capsRegistry[c.id] = c; });
    } catch {}
  }

  const { covered, uncovered } = getCoverage(scenariosDir, caps);

  caps.forEach(cap => {
    const reg = capsRegistry[cap];
    const hasCoverage = covered.includes(cap);
    const icon = hasCoverage ? green("✔") : red("✘");
    const title = reg?.title ? gray(` — ${reg.title}`) : "";
    const since = reg?.since ? gray(` [${reg.since}]`) : "";
    console.log(`  ${icon} ${white(cap)}${title}${since}`);
  });

  if (uncovered.length > 0) {
    console.log(`\n  ${yellow("⚠")}  ${uncovered.length} capability(ies) lack scenario coverage`);
  } else {
    console.log(`\n  ${green("✔")}  All capabilities have scenario coverage`);
  }

  // ── Scenarios ─────────────────────────────────────────────────────
  section("Scenarios");
  if (fs.existsSync(scenariosDir)) {
    const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith(".json"));
    if (files.length === 0) {
      warn("No scenario files — add .json files to inferno/scenarios/");
    } else {
      files.forEach(f => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
          const steps = s.steps?.length || 0;
          const capCount = (s.capabilitiesCovered || []).length;
          console.log(`  ${green("✔")} ${cyan(f)} ${gray(`— ${steps} steps, ${capCount} caps covered`)}`);
        } catch {
          console.log(`  ${red("✘")} ${cyan(f)} ${gray("— invalid JSON")}`);
        }
      });
    }
  } else {
    warn("scenarios/ directory not found");
  }

  // ── Changelog ─────────────────────────────────────────────────────
  section("Changelog");
  if (fs.existsSync(changelogPath)) {
    const txt = fs.readFileSync(changelogPath, "utf8");
    if (/##\s+Unreleased/i.test(txt)) {
      ok("Has ## Unreleased section");
    } else {
      fail("Missing ## Unreleased section");
    }
    const sections = txt.split("\n").filter(l => /^##\s/.test(l)).slice(0, 3);
    sections.forEach(l => console.log(`  ${gray(l)}`));
  } else {
    fail("inferno/CHANGELOG.md not found");
  }

  // ── Health ────────────────────────────────────────────────────────
  console.log();
  const hasChangelog = fs.existsSync(changelogPath) && /##\s+Unreleased/i.test(fs.readFileSync(changelogPath, "utf8"));
  const allGood = uncovered.length === 0 && hasChangelog;
  if (allGood) {
    console.log(`  ${green("●")} ${bold(green("ready"))} ${gray("— run infernoflow check for full validation")}`);
  } else {
    console.log(`  ${yellow("●")} ${bold(yellow("needs attention"))} ${gray("— run infernoflow check for details")}`);
  }
  console.log();
}
