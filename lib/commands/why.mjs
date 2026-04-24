/**
 * infernoflow why
 *
 * Given a file path or function name — answer:
 *   • Which capability does this serve?
 *   • What is its stability level?
 *   • What scenarios cover it?
 *   • Who introduced it and when?
 *   • What does it call / what calls it?
 *
 * Pure correlation — no AI needed. Uses scan.json + graph.json + scenarios/ + git log.
 *
 * Usage:
 *   infernoflow why src/auth.ts
 *   infernoflow why loginUser
 *   infernoflow why src/auth.ts --function loginUser
 *   infernoflow why --json src/auth.ts
 */

import * as fs      from "node:fs";
import * as path    from "node:path";
import { execSync } from "node:child_process";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function runGit(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch { return ""; }
}

const LEVEL_ICON  = { frozen: "🧊", stable: "〰️ ", experimental: "🌊" };
const LEVEL_COLOR = { frozen: red, stable: yellow, experimental: green };

function stability(cap) {
  return cap?.stability || "experimental";
}

// ── matchers ─────────────────────────────────────────────────────────────────

/**
 * Given a target (file path or function name), find all matching
 * capabilities from scan.json.
 * Returns: [{ capId, capEntry, matchedVia, score }]
 */
function findCapabilities(target, scanCaps, allCaps, cwd) {
  const results = [];
  const isFile  = target.includes("/") || target.includes("\\") || target.includes(".");
  const relTarget = isFile ? path.relative(cwd, path.resolve(cwd, target)) : null;

  for (const entry of scanCaps) {
    const analysis = entry.codeAnalysis;
    if (!analysis) continue;

    const capFull = allCaps.find(c => c.id === entry.id) || {};

    if (isFile) {
      // Match by source file
      const fileMatch = (analysis.sourceFiles || []).some(f =>
        f === relTarget || f.endsWith(relTarget) || relTarget?.endsWith(f)
      );
      if (fileMatch) {
        results.push({ capId: entry.id, capEntry: entry, capFull, matchedVia: "file", score: 1.0 });
        continue;
      }
    }

    if (!isFile) {
      // Match by function name (exact or contains)
      const fnMatch = (analysis.functions || []).some(fn =>
        fn.toLowerCase() === target.toLowerCase() ||
        fn.toLowerCase().includes(target.toLowerCase()) ||
        target.toLowerCase().includes(fn.toLowerCase())
      );
      if (fnMatch) {
        results.push({ capId: entry.id, capEntry: entry, capFull, matchedVia: "function", score: 1.0 });
        continue;
      }
    }
  }

  return results;
}

// ── scenario finder ───────────────────────────────────────────────────────────

function findScenarios(capId, infernoDir) {
  const scenariosDir = path.join(infernoDir, "scenarios");
  if (!fs.existsSync(scenariosDir)) return [];

  const found = [];
  for (const f of fs.readdirSync(scenariosDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
      const covered = s.capabilitiesCovered || s.capabilities || [];
      if (covered.includes(capId) || covered.some(c =>
        c.toLowerCase() === capId.toLowerCase()
      )) {
        found.push({ file: f, scenario: s });
      }
    } catch {}
  }
  return found;
}

// ── git history ───────────────────────────────────────────────────────────────

function getGitHistory(filePath, cwd, limit = 5) {
  if (!filePath) return [];
  const rel = path.relative(cwd, path.resolve(cwd, filePath));
  const log = runGit(
    `git log --follow --format="%h|%aI|%ae|%s" -${limit} -- ${JSON.stringify(rel)}`,
    cwd
  );
  if (!log) return [];

  return log.split("\n").filter(Boolean).map(line => {
    const [hash, date, author, ...subjectParts] = line.split("|");
    return {
      hash:    hash?.trim(),
      date:    date?.trim() ? new Date(date.trim()).toLocaleDateString() : "",
      author:  author?.trim(),
      subject: subjectParts.join("|").trim(),
    };
  });
}

function getFirstCommit(filePath, cwd) {
  if (!filePath) return null;
  const rel = path.relative(cwd, path.resolve(cwd, filePath));
  const log = runGit(
    `git log --follow --format="%h|%aI|%ae|%s" -- ${JSON.stringify(rel)}`,
    cwd
  );
  if (!log) return null;
  const lines = log.split("\n").filter(Boolean);
  if (!lines.length) return null;
  const [hash, date, author, ...subjectParts] = lines[lines.length - 1].split("|");
  return {
    hash:    hash?.trim(),
    date:    date?.trim() ? new Date(date.trim()).toLocaleDateString() : "",
    author:  author?.trim(),
    subject: subjectParts.join("|").trim(),
  };
}

// ── printer ───────────────────────────────────────────────────────────────────

function printResult(result, scenarios, history, firstCommit, graph, allCaps, target) {
  const { capId, capEntry, capFull, matchedVia } = result;
  const level = stability(capFull);
  const icon  = LEVEL_ICON[level]  || "🌊";
  const color = LEVEL_COLOR[level] || green;

  console.log();
  console.log(bold(`  ${icon} ${color(capId)}`));
  if (capFull.name || capFull.title) {
    console.log(gray(`     ${capFull.name || capFull.title}`));
  }
  if (capFull.description) {
    console.log(gray(`     ${capFull.description}`));
  }
  console.log();

  // Matched via
  console.log(gray(`  matched via:   `) + matchedVia + gray(` → `) + cyan(target));

  // Stability
  console.log(gray(`  stability:     `) + color(level));

  // Source files
  const files = capEntry.codeAnalysis?.sourceFiles || [];
  if (files.length) {
    console.log(gray(`  source files:  `) + files.join(", "));
  }

  // Functions
  const fns = capEntry.codeAnalysis?.functions || [];
  if (fns.length) {
    console.log(gray(`  functions:     `) + fns.join(", "));
  }

  // External services
  const services = capEntry.codeAnalysis?.services || [];
  if (services.length) {
    console.log(gray(`  uses:          `) + cyan(services.join(", ")));
  }

  // Throws
  const throws = capEntry.codeAnalysis?.throws || [];
  if (throws.length) {
    console.log(gray(`  throws:        `) + yellow(throws.join(", ")));
  }

  // Dependencies from graph
  if (graph) {
    const deps      = graph.deps?.[capId]       || [];
    const dependents = graph.dependents?.[capId] || [];
    if (deps.length) {
      console.log(gray(`  calls:         `) + deps.map(d => {
        const dCap = allCaps.find(c => c.id === d);
        const dIcon = LEVEL_ICON[stability(dCap)] || "🌊";
        return `${dIcon} ${d}`;
      }).join("  "));
    }
    if (dependents.length) {
      console.log(gray(`  called by:     `) + dependents.map(d => {
        const dCap = allCaps.find(c => c.id === d);
        const dIcon = LEVEL_ICON[stability(dCap)] || "🌊";
        return `${dIcon} ${d}`;
      }).join("  "));
    }
  }

  console.log();

  // Scenarios
  if (scenarios.length > 0) {
    console.log(bold("  Scenarios that cover this capability:"));
    for (const { scenario } of scenarios) {
      const steps = scenario.steps?.length || 0;
      console.log(`    ${green("✔")} ${scenario.scenarioId || scenario.description || scenario.file}`);
      if (scenario.description) console.log(gray(`      ${scenario.description}`));
      if (steps) console.log(gray(`      ${steps} step(s)`));
    }
    console.log();
  } else {
    console.log(yellow("  ⚠  No scenarios found for this capability."));
    console.log(gray(`     Run: infernoflow suggest "add scenario for ${capId}"`));
    console.log();
  }

  // Git history
  if (firstCommit) {
    console.log(bold("  Origin:"));
    console.log(`    ${gray("first commit:")} ${firstCommit.hash} · ${firstCommit.date} · ${firstCommit.author}`);
    console.log(`    ${gray("subject:")}      ${firstCommit.subject}`);
    console.log();
  }

  if (history.length > 0) {
    console.log(bold("  Recent changes:"));
    for (const h of history.slice(0, 4)) {
      console.log(`    ${gray(h.hash)} ${gray(h.date.padEnd(12))} ${h.subject}`);
    }
    console.log();
  }

  // Frozen warning
  if (level === "frozen") {
    console.log(red("  🧊 This capability is FROZEN — do not modify without explicit instruction."));
    console.log();
  }
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function whyCommand(rawArgs) {
  const args     = (rawArgs || []).slice(1); // skip command name
  const jsonMode = args.includes("--json");
  const fnFlag   = args.indexOf("--function");
  const fnFilter = fnFlag !== -1 ? args[fnFlag + 1] : null;

  // Target: first non-flag argument (skip the value after --function if present)
  const target = args.find((a, i) => !a.startsWith("--") && (fnFlag === -1 || i !== fnFlag + 1));

  if (!target) {
    console.error(red("✗ Usage: infernoflow why <file-or-function> [--function <name>] [--json]"));
    console.error(gray("  Examples:"));
    console.error(gray("    infernoflow why src/auth.ts"));
    console.error(gray("    infernoflow why loginUser"));
    process.exit(1);
  }

  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  // Load scan.json
  const scan = loadJson(path.join(infernoDir, "scan.json"));
  if (!scan) {
    console.error(red("✗ inferno/scan.json not found — run `infernoflow scan` first."));
    process.exit(1);
  }

  // Load capabilities.json for stability + metadata
  let allCaps = [];
  const rawCaps = loadJson(path.join(infernoDir, "capabilities.json"));
  if (rawCaps) allCaps = Array.isArray(rawCaps) ? rawCaps : (rawCaps.capabilities || []);

  // Load graph.json
  const graph = loadJson(path.join(infernoDir, "graph.json"));

  // Find capabilities
  const scanCaps = scan.capabilities || [];
  let results    = findCapabilities(target, scanCaps, allCaps, cwd);

  // Apply --function filter
  if (fnFilter && results.length > 1) {
    results = results.filter(r =>
      (r.capEntry.codeAnalysis?.functions || []).some(fn =>
        fn.toLowerCase().includes(fnFilter.toLowerCase())
      )
    );
  }

  if (results.length === 0) {
    console.log();
    console.log(yellow(`  No capability found matching: ${bold(target)}`));
    console.log(gray("  Tip: run `infernoflow scan` to update code analysis, then try again."));
    console.log(gray("  Tip: use a function name or relative file path."));
    console.log();
    process.exit(0);
  }

  if (jsonMode) {
    const out = results.map(r => {
      const scenarios = findScenarios(r.capId, infernoDir);
      const files     = r.capEntry.codeAnalysis?.sourceFiles || [];
      const history   = getGitHistory(files[0], cwd);
      const first     = getFirstCommit(files[0], cwd);
      return {
        capId:       r.capId,
        name:        r.capFull.name || r.capFull.title,
        stability:   stability(r.capFull),
        matchedVia:  r.matchedVia,
        sourceFiles: files,
        functions:   r.capEntry.codeAnalysis?.functions || [],
        services:    r.capEntry.codeAnalysis?.services  || [],
        throws:      r.capEntry.codeAnalysis?.throws    || [],
        deps:        graph?.deps?.[r.capId]        || [],
        dependents:  graph?.dependents?.[r.capId]  || [],
        scenarios:   scenarios.map(s => s.scenario?.scenarioId || s.file),
        firstCommit: first,
        recentHistory: history,
      };
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(gray(`\n  infernoflow why  →  ${bold(target)}`));
  console.log(gray("  ──────────────────────────────────────────────────────────────"));

  for (const result of results) {
    const files     = result.capEntry.codeAnalysis?.sourceFiles || [];
    const scenarios = findScenarios(result.capId, infernoDir);
    const history   = getGitHistory(files[0], cwd);
    const first     = getFirstCommit(files[0], cwd);
    printResult(result, scenarios, history, first, graph, allCaps, target);
  }
}
