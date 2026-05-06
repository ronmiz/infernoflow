/**
 * infernoflow graph
 *
 * Builds a capability dependency graph from scan.json.
 * Shows which capabilities call which — so changing one reveals its downstream impact.
 *
 * Usage:
 *   infernoflow graph                   Print full dependency tree
 *   infernoflow graph --cap auth-login  Show deps for one capability (up + down)
 *   infernoflow graph --json            Machine-readable graph.json to stdout
 *   infernoflow graph --check           Warn if frozen/stable caps have new dependents
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function getLevel(cap) {
  return cap?.stability || "experimental";
}

const LEVEL_ICON = { frozen: "🧊", stable: "〰️ ", experimental: "🌊" };
const LEVEL_COLOR = { frozen: red, stable: yellow, experimental: green };

// ── graph builder ─────────────────────────────────────────────────────────────

/**
 * Build edges: capA → capB if any function in capA calls a function in capB.
 *
 * Strategy:
 *   1. Build a function-name → capId index from scan data
 *   2. For each cap, check its calls[] against the index
 *   3. If a call matches a function in another cap → edge
 */
function buildGraph(scanCaps, allCaps) {
  // capId → { id, name, stability, functions[], calls[], services[], dbCalls[], httpCalls[] }
  const nodes = {};
  // capId → Set<capId>  (edges: this cap calls that cap)
  const edges = {};
  // capId → Set<capId>  (reverse: this cap is called by those caps)
  const reverse = {};

  // Build function → capId index
  const funcIndex = {}; // functionName → capId
  for (const entry of scanCaps) {
    const capFull = allCaps.find(c => c.id === entry.id) || {};
    nodes[entry.id] = {
      id:        entry.id,
      name:      entry.name || capFull.name || capFull.title || entry.id,
      stability: capFull.stability || "experimental",
      functions: entry.codeAnalysis?.functions  || [],
      calls:     entry.codeAnalysis?.calls      || [],
      services:  entry.codeAnalysis?.services   || [],
      dbCalls:   entry.codeAnalysis?.dbCalls    || [],
      httpCalls: entry.codeAnalysis?.httpCalls  || [],
    };
    edges[entry.id]   = new Set();
    reverse[entry.id] = new Set();

    for (const fn of (entry.codeAnalysis?.functions || [])) {
      const bare = fn.replace(/\(\)$/, "");
      funcIndex[bare] = entry.id;
      funcIndex[bare.toLowerCase()] = entry.id;
    }
  }

  // Build edges from calls[]
  for (const [capId, node] of Object.entries(nodes)) {
    for (const call of node.calls) {
      const bare   = call.replace(/\(\)$/, "");
      const target = funcIndex[bare] || funcIndex[bare.toLowerCase()];
      // Defensive: target must point to a known node, and both edge sets
      // must exist. Stale scan.json entries or duplicate capIds can otherwise
      // crash with "Cannot read properties of undefined (reading 'add')".
      if (target && target !== capId && edges[capId] && reverse[target]) {
        edges[capId].add(target);
        reverse[target].add(capId);
      }
    }
  }

  // Serialise Sets to arrays
  const serialisedEdges   = {};
  const serialisedReverse = {};
  for (const id of Object.keys(nodes)) {
    serialisedEdges[id]   = [...edges[id]];
    serialisedReverse[id] = [...reverse[id]];
  }

  return { nodes, edges: serialisedEdges, reverse: serialisedReverse };
}

// ── terminal reporters ────────────────────────────────────────────────────────

function printFullGraph(graph) {
  const { nodes, edges, reverse } = graph;
  const ids = Object.keys(nodes).sort();

  console.log();
  console.log(bold("  Capability Dependency Graph"));
  console.log(gray("  ────────────────────────────────────────────────────────────"));
  console.log();

  let hasDeps = false;
  for (const id of ids) {
    const node  = nodes[id];
    const deps  = edges[id]   || [];
    const callers = reverse[id] || [];
    const icon  = LEVEL_ICON[node.stability] || "🌊";
    const color = LEVEL_COLOR[node.stability] || green;

    if (deps.length === 0 && callers.length === 0) continue;
    hasDeps = true;

    console.log(`  ${icon} ${bold(color(id))}`);

    if (deps.length > 0) {
      console.log(gray("    calls →"));
      for (const dep of deps) {
        const depNode = nodes[dep];
        const depIcon = LEVEL_ICON[depNode?.stability] || "🌊";
        console.log(gray(`       ${depIcon} ${dep}`));
      }
    }
    if (callers.length > 0) {
      console.log(gray("    called by ←"));
      for (const caller of callers) {
        const callerIcon = LEVEL_ICON[nodes[caller]?.stability] || "🌊";
        console.log(gray(`       ${callerIcon} ${caller}`));
      }
    }
    console.log();
  }

  if (!hasDeps) {
    console.log(gray("  No inter-capability dependencies detected."));
    console.log(gray("  Run `infernoflow scan` first to populate call data."));
    console.log();
  }

  // Summary stats
  const totalEdges = Object.values(graph.edges).reduce((n, arr) => n + arr.length, 0);
  console.log(gray(`  ────────────────────────────────────────────────────────────`));
  console.log(gray(`  ${ids.length} capabilities · ${totalEdges} dependency edge(s)`));
  console.log();
}

function printCapGraph(capId, graph) {
  const { nodes, edges, reverse } = graph;
  const node = nodes[capId];
  if (!node) {
    console.error(red(`✗ Capability "${capId}" not found in graph.`));
    process.exit(1);
  }

  const icon  = LEVEL_ICON[node.stability] || "🌊";
  const color = LEVEL_COLOR[node.stability] || green;

  console.log();
  console.log(bold(`  ${icon} ${color(capId)}`) + gray(`  (${node.stability})`));
  if (node.services?.length) console.log(gray(`  external: `) + cyan(node.services.join(", ")));
  console.log();

  const deps    = edges[capId]   || [];
  const callers = reverse[capId] || [];

  if (deps.length > 0) {
    console.log(bold("  Calls (downstream dependencies):"));
    for (const dep of deps) {
      const d    = nodes[dep];
      const dColor = LEVEL_COLOR[d?.stability] || green;
      const dIcon  = LEVEL_ICON[d?.stability]  || "🌊";
      console.log(`    ${dIcon} ${dColor(dep)}` + gray(d?.services?.length ? `  [${d.services.join(", ")}]` : ""));
    }
    console.log();
  } else {
    console.log(gray("  No downstream dependencies."));
    console.log();
  }

  if (callers.length > 0) {
    console.log(bold("  Called by (upstream dependents):"));
    for (const caller of callers) {
      const c    = nodes[caller];
      const cColor = LEVEL_COLOR[c?.stability] || green;
      const cIcon  = LEVEL_ICON[c?.stability]  || "🌊";
      console.log(`    ${cIcon} ${cColor(caller)}`);
    }
    console.log();
  } else {
    console.log(gray("  No capabilities call this one."));
    console.log();
  }

  // Impact warning for frozen/stable
  if ((node.stability === "frozen" || node.stability === "stable") && callers.length > 0) {
    const color2 = node.stability === "frozen" ? red : yellow;
    console.log(color2(`  ⚠  This capability is ${node.stability}. Changing it may break:`));
    for (const caller of callers) console.log(color2(`     • ${caller}`));
    console.log();
  }
}

// ── breaking change checker ───────────────────────────────────────────────────

/**
 * Compare previous graph.json with new graph to detect:
 * - frozen/stable caps that have gained new callers (more dependents = higher risk)
 * - frozen caps that have new outgoing deps (their internals changed)
 */
function checkBreakingChanges(prevGraph, newGraph) {
  const warnings = [];
  if (!prevGraph || !newGraph) return warnings;

  for (const [capId, node] of Object.entries(newGraph.nodes)) {
    if (node.stability === "experimental") continue;

    const prevCallers = new Set(prevGraph.reverse?.[capId] || []);
    const newCallers  = new Set(newGraph.reverse[capId]    || []);
    const addedCallers = [...newCallers].filter(c => !prevCallers.has(c));

    if (addedCallers.length > 0) {
      warnings.push({
        type:    "new-dependents",
        capId,
        stability: node.stability,
        detail:  `${addedCallers.join(", ")} now depend on this`,
      });
    }

    if (node.stability === "frozen") {
      const prevDeps = new Set(prevGraph.edges?.[capId] || []);
      const newDeps  = new Set(newGraph.edges[capId]    || []);
      const addedDeps = [...newDeps].filter(d => !prevDeps.has(d));
      const removedDeps = [...prevDeps].filter(d => !newDeps.has(d));

      if (addedDeps.length > 0 || removedDeps.length > 0) {
        warnings.push({
          type:    "frozen-internals-changed",
          capId,
          stability: node.stability,
          detail:  [
            addedDeps.length   ? `added calls: ${addedDeps.join(", ")}`   : "",
            removedDeps.length ? `removed calls: ${removedDeps.join(", ")}` : "",
          ].filter(Boolean).join("; "),
        });
      }
    }
  }

  return warnings;
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function graphCommand(rawArgs) {
  const args      = (rawArgs || []).slice(1); // skip command name
  const jsonMode  = args.includes("--json");
  const checkMode = args.includes("--check");
  const capIdx    = args.indexOf("--cap");
  const capFilter = capIdx !== -1 ? args[capIdx + 1] : null;

  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const scanPath   = path.join(infernoDir, "scan.json");
  const graphPath  = path.join(infernoDir, "graph.json");
  const capsPath   = path.join(infernoDir, "capabilities.json");

  // Load scan data
  const scan = loadJson(scanPath);
  if (!scan) {
    console.error(red("✗ inferno/scan.json not found."));
    console.error(gray("   The graph is built from a deep AST scan of your codebase."));
    console.error(gray("   Run this first to generate it:"));
    console.error(cyan("\n   infernoflow scan\n"));
    process.exit(1);
  }
  if (!Array.isArray(scan.capabilities) || scan.capabilities.length === 0) {
    console.error(red("✗ inferno/scan.json has no capabilities."));
    console.error(gray("   Re-run `infernoflow scan` to refresh the data."));
    process.exit(1);
  }

  // Load capabilities (for stability info)
  let allCaps = [];
  const rawCaps = loadJson(capsPath);
  if (rawCaps) allCaps = Array.isArray(rawCaps) ? rawCaps : (rawCaps.capabilities || []);

  // Build graph
  const scanCaps = scan.capabilities || [];
  const graph    = buildGraph(scanCaps, allCaps);

  // Check for breaking changes vs saved graph
  const prevGraph = loadJson(graphPath);
  const breakingWarnings = checkMode || true ? checkBreakingChanges(prevGraph, graph) : [];

  // Save graph.json
  const graphData = {
    builtAt:      new Date().toISOString(),
    capabilities: Object.keys(graph.nodes).length,
    edges:        Object.values(graph.edges).reduce((n, arr) => n + arr.length, 0),
    nodes:        graph.nodes,
    deps:         graph.edges,
    dependents:   graph.reverse,
  };

  if (!jsonMode) {
    fs.writeFileSync(graphPath, JSON.stringify(graphData, null, 2));
  }

  // Output
  if (jsonMode) {
    console.log(JSON.stringify(graphData, null, 2));
    return;
  }

  if (capFilter) {
    printCapGraph(capFilter, graph);
  } else {
    printFullGraph(graph);
  }

  // Breaking change warnings
  if (breakingWarnings.length > 0) {
    console.log(yellow("  ⚠  Dependency changes detected:"));
    for (const w of breakingWarnings) {
      const icon = w.stability === "frozen" ? red("🧊") : yellow("〰️ ");
      console.log(`  ${icon} ${bold(w.capId)} — ${w.detail}`);
    }
    console.log();
    if (checkMode) process.exit(1);
  }

  if (!jsonMode) console.log(gray(`  Graph saved → inferno/graph.json`));
}

// ── exported utility for other commands ──────────────────────────────────────

export function loadGraph(infernoDir) {
  return loadJson(path.join(infernoDir, "graph.json"));
}
