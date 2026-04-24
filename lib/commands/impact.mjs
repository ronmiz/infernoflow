/**
 * infernoflow impact
 *
 * Before you touch a capability — see the blast radius.
 *
 * Given a capability ID, answers:
 *   • Which caps directly depend on this one?
 *   • Which caps transitively depend on it?
 *   • What scenarios would be affected?
 *   • What is the overall risk level? (low / medium / high / critical)
 *   • Are any frozen/stable caps in the blast zone?
 *
 * Pure graph traversal — no AI needed. Fast and deterministic.
 *
 * Usage:
 *   infernoflow impact auth-login
 *   infernoflow impact auth-login --depth 5
 *   infernoflow impact auth-login --json
 *   infernoflow impact auth-login --check     Exit 1 if risk is HIGH or CRITICAL
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

const LEVEL_ICON  = { frozen: "🧊", stable: "〰️ ", experimental: "🌊" };
const LEVEL_COLOR = { frozen: red, stable: yellow, experimental: green };

function stability(cap) {
  return cap?.stability || "experimental";
}

// ── blast radius (BFS on reverse graph) ──────────────────────────────────────

/**
 * Walk the reverse dependency graph (dependents) starting from capId.
 * Returns: { direct: Set<string>, transitive: Set<string> }
 */
function blastRadius(capId, dependents, maxDepth = 10) {
  const direct     = new Set(dependents[capId] || []);
  const transitive = new Set();
  const queue      = [...direct].map(id => ({ id, depth: 1 }));
  const visited    = new Set([capId, ...direct]);

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    for (const dep of (dependents[id] || [])) {
      if (!visited.has(dep)) {
        visited.add(dep);
        transitive.add(dep);
        queue.push({ id: dep, depth: depth + 1 });
      }
    }
  }

  return { direct, transitive };
}

// ── scenario finder ───────────────────────────────────────────────────────────

function loadScenarios(infernoDir) {
  const scenariosDir = path.join(infernoDir, "scenarios");
  if (!fs.existsSync(scenariosDir)) return [];

  const scenarios = [];
  for (const f of fs.readdirSync(scenariosDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
      scenarios.push(s);
    } catch {}
  }
  return scenarios;
}

function scenariosForCap(capId, scenarios) {
  return scenarios.filter(s => {
    const covered = s.capabilitiesCovered || s.capabilities || [];
    return covered.some(c => c.toLowerCase() === capId.toLowerCase());
  });
}

// ── risk calculator ───────────────────────────────────────────────────────────

/**
 * Risk levels:
 *   critical  — the target cap itself is frozen AND has dependents
 *   high      — a frozen cap is in the blast zone
 *   medium    — a stable cap is in the blast zone
 *   low       — all dependents are experimental
 */
function computeRisk(targetCap, allInBlast, allCaps) {
  const targetLevel = stability(targetCap);

  if (targetLevel === "frozen" && allInBlast.size > 0) {
    return "critical";
  }

  for (const id of allInBlast) {
    const cap = allCaps.find(c => c.id === id);
    if (stability(cap) === "frozen") return "high";
  }

  for (const id of allInBlast) {
    const cap = allCaps.find(c => c.id === id);
    if (stability(cap) === "stable") return "medium";
  }

  return "low";
}

const RISK_COLOR = {
  critical: red,
  high:     red,
  medium:   yellow,
  low:      green,
};

const RISK_ICON = {
  critical: "🔴",
  high:     "🔴",
  medium:   "🟡",
  low:      "🟢",
};

const RISK_ADVICE = {
  critical: "This capability is FROZEN — any change is high-risk. Requires explicit approval.",
  high:     "A frozen capability depends on this — test thoroughly before merging.",
  medium:   "A stable capability is in the blast zone — prefer additive changes only.",
  low:      "All dependents are experimental — safe to iterate freely.",
};

// ── printer ───────────────────────────────────────────────────────────────────

function printImpact({ capId, targetCap, direct, transitive, affectedScenarios, risk, allCaps, deps }) {
  const targetLevel = stability(targetCap);
  const targetIcon  = LEVEL_ICON[targetLevel] || "🌊";
  const targetColor = LEVEL_COLOR[targetLevel] || green;
  const riskColor   = RISK_COLOR[risk];
  const riskIcon    = RISK_ICON[risk];

  console.log();
  console.log(bold(`  ${targetIcon} ${targetColor(capId)}`));
  if (targetCap?.name || targetCap?.title) {
    console.log(gray(`     ${targetCap.name || targetCap.title}`));
  }
  console.log(gray(`     stability: `) + targetColor(targetLevel));
  console.log();

  // What this cap calls (downstream)
  if (deps.length > 0) {
    console.log(gray("  This cap calls:"));
    for (const dep of deps) {
      const d = allCaps.find(c => c.id === dep);
      const icon  = LEVEL_ICON[stability(d)]  || "🌊";
      const color = LEVEL_COLOR[stability(d)] || green;
      console.log(`    ${icon}  ${color(dep)}`);
    }
    console.log();
  }

  // Blast radius
  if (direct.size === 0) {
    console.log(gray("  No capabilities depend on this one."));
    console.log(gray("  ✔ Safe to change freely."));
    console.log();
  } else {
    console.log(bold("  Direct dependents (will be immediately affected):"));
    for (const id of direct) {
      const cap   = allCaps.find(c => c.id === id);
      const level = stability(cap);
      const icon  = LEVEL_ICON[level]  || "🌊";
      const color = LEVEL_COLOR[level] || green;
      console.log(`    ${icon}  ${color(id)}`);
    }
    console.log();

    if (transitive.size > 0) {
      console.log(bold("  Transitive dependents (indirectly affected):"));
      for (const id of transitive) {
        const cap   = allCaps.find(c => c.id === id);
        const level = stability(cap);
        const icon  = LEVEL_ICON[level]  || "🌊";
        const color = LEVEL_COLOR[level] || green;
        console.log(`    ${icon}  ${color(id)}`);
      }
      console.log();
    }
  }

  // Affected scenarios
  if (affectedScenarios.length > 0) {
    console.log(bold("  Scenarios at risk:"));
    for (const s of affectedScenarios) {
      console.log(`    ${yellow("⚠")}  ${s.scenarioId || s.description || "(unnamed)"}`);
      if (s.description) console.log(gray(`       ${s.description}`));
    }
    console.log();
  } else if (direct.size > 0) {
    console.log(gray("  No scenarios cover the affected capabilities."));
    console.log(gray("  Consider adding scenarios before making this change."));
    console.log();
  }

  // Risk banner
  console.log(`  ${riskIcon}  Risk level: ${bold(riskColor(risk.toUpperCase()))}`);
  console.log(`     ${gray(RISK_ADVICE[risk])}`);
  console.log();

  // Summary numbers
  const total = direct.size + transitive.size;
  if (total > 0) {
    console.log(gray(
      `  ── ${direct.size} direct · ${transitive.size} transitive · ${total} total affected · ${affectedScenarios.length} scenario(s) at risk`
    ));
    console.log();
  }
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function impactCommand(rawArgs) {
  const args      = (rawArgs || []).slice(1); // skip command name
  const jsonMode  = args.includes("--json");
  const checkMode = args.includes("--check");
  const depthIdx  = args.indexOf("--depth");
  const maxDepth  = depthIdx !== -1 ? parseInt(args[depthIdx + 1], 10) || 10 : 10;

  const capId = args.find((a, i) => !a.startsWith("--") && (depthIdx === -1 || i !== depthIdx + 1));

  if (!capId) {
    console.error(red("✗ Usage: infernoflow impact <capability-id> [--depth N] [--json] [--check]"));
    console.error(gray("  Example: infernoflow impact user-auth"));
    process.exit(1);
  }

  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  // Load graph
  const graph = loadJson(path.join(infernoDir, "graph.json"));
  if (!graph) {
    console.error(red("✗ inferno/graph.json not found — run `infernoflow graph` first."));
    process.exit(1);
  }

  // Load capabilities
  let allCaps = [];
  const rawCaps = loadJson(path.join(infernoDir, "capabilities.json"));
  if (rawCaps) allCaps = Array.isArray(rawCaps) ? rawCaps : (rawCaps.capabilities || []);

  // Validate cap exists
  const targetCap = allCaps.find(c => c.id === capId);
  if (!targetCap) {
    console.error(red(`✗ Capability "${capId}" not found in capabilities.json`));
    console.error(gray("  Run: infernoflow stability — to list all capability IDs"));
    process.exit(1);
  }

  // Blast radius
  const { direct, transitive } = blastRadius(capId, graph.dependents || {}, maxDepth);
  const allInBlast = new Set([...direct, ...transitive]);

  // Dependencies (what this cap calls)
  const deps = graph.deps?.[capId] || [];

  // Scenarios
  const scenarios     = loadScenarios(infernoDir);
  const targetScenarios = scenariosForCap(capId, scenarios);
  // Collect scenarios for all affected caps too
  const affectedScenarioSet = new Map();
  for (const s of targetScenarios) {
    affectedScenarioSet.set(s.scenarioId || s.description, s);
  }
  for (const id of allInBlast) {
    for (const s of scenariosForCap(id, scenarios)) {
      affectedScenarioSet.set(s.scenarioId || s.description, s);
    }
  }
  const affectedScenarios = [...affectedScenarioSet.values()];

  // Risk
  const risk = computeRisk(targetCap, allInBlast, allCaps);

  // JSON mode
  if (jsonMode) {
    const out = {
      capId,
      name:        targetCap.name || targetCap.title,
      stability:   stability(targetCap),
      risk,
      direct:      [...direct],
      transitive:  [...transitive],
      deps,
      affectedScenarios: affectedScenarios.map(s => s.scenarioId || s.description),
      summary: {
        directCount:     direct.size,
        transitiveCount: transitive.size,
        totalAffected:   allInBlast.size,
        scenariosAtRisk: affectedScenarios.length,
      },
    };
    console.log(JSON.stringify(out, null, 2));
    if (checkMode && (risk === "high" || risk === "critical")) process.exit(1);
    return;
  }

  console.log(gray(`\n  infernoflow impact  →  ${bold(capId)}`));
  console.log(gray("  ──────────────────────────────────────────────────────────────"));

  printImpact({ capId, targetCap, direct, transitive, affectedScenarios, risk, allCaps, deps });

  if (checkMode && (risk === "high" || risk === "critical")) {
    console.log(red("  ✗ --check failed: risk level is " + risk.toUpperCase()));
    process.exit(1);
  }
}
