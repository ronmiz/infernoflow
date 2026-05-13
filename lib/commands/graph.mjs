/**
 * infernoflow graph
 *
 * Builds a capability dependency graph from scan.json.
 * Shows which capabilities call which — so changing one reveals its downstream impact.
 *
 * Usage:
 *   infernoflow graph                   Print full dependency tree (ASCII)
 *   infernoflow graph --cap auth-login  Show deps for one capability (up + down)
 *   infernoflow graph --json            Machine-readable graph.json to stdout
 *   infernoflow graph --check           Warn if frozen/stable caps have new dependents
 *   infernoflow graph --mermaid         Print Mermaid syntax (renders in GitHub/VS Code/mermaid.live)
 *   infernoflow graph --html            Generate inferno/graph.html — interactive D3 visualization
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
  const args        = (rawArgs || []).slice(1); // skip command name
  const jsonMode    = args.includes("--json");
  const checkMode   = args.includes("--check");
  const mermaidMode = args.includes("--mermaid");
  const htmlMode    = args.includes("--html");
  const capIdx      = args.indexOf("--cap");
  const capFilter   = capIdx !== -1 ? args[capIdx + 1] : null;

  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const scanPath   = path.join(infernoDir, "scan.json");
  const graphPath  = path.join(infernoDir, "graph.json");
  const capsPath   = path.join(infernoDir, "capabilities.json");

  // Load scan data — auto-run scan if missing OR older than 5 minutes
  // so users don't need to remember the two-step "scan then graph" flow.
  const STALE_MS = 5 * 60 * 1000;
  let scan       = loadJson(scanPath);
  const needsScan = !scan
    || !Array.isArray(scan.capabilities)
    || scan.capabilities.length === 0
    || (fs.existsSync(scanPath) && Date.now() - fs.statSync(scanPath).mtimeMs > STALE_MS);

  if (needsScan) {
    console.log(gray("  ⟳ Running infernoflow scan first (scan.json missing or stale)…"));
    try {
      const { scanCommand } = await import("./scan.mjs");
      await scanCommand(["scan"]);  // pass dummy first arg, scanCommand slices(1)
      scan = loadJson(scanPath);
    } catch (err) {
      console.error(red(`✗ Could not run scan automatically: ${err.message}`));
      console.error(gray("  Run `infernoflow scan` manually and try again."));
      process.exit(1);
    }
  }
  if (!scan || !Array.isArray(scan.capabilities) || scan.capabilities.length === 0) {
    console.error(red("✗ inferno/scan.json still empty after scan."));
    console.error(gray("   Make sure your contract has at least one capability and your code matches."));
    process.exit(1);
  }

  // Load capabilities (for stability info)
  let allCaps = [];
  const rawCaps = loadJson(capsPath);
  if (rawCaps) allCaps = Array.isArray(rawCaps) ? rawCaps : (rawCaps.capabilities || []);

  // Build graph
  const scanCaps = scan.capabilities || [];
  const graph    = buildGraph(scanCaps, allCaps);

  // ── Component layer: file-based React/Vue/Svelte components ─────────────
  const components = Array.isArray(scan.components) ? scan.components : [];
  // Build a file → capId index so we can wire components to caps by shared file
  const fileToCaps = {};
  for (const cap of scanCaps) {
    const files = (cap.codeAnalysis?.files || []).map(f => f.replace(/\\/g, "/"));
    for (const f of files) {
      if (!fileToCaps[f]) fileToCaps[f] = new Set();
      fileToCaps[f].add(cap.id);
    }
  }

  // Detect entry-point components — flagged for visual emphasis. Multiple
  // common React/Vue/Next conventions. The first match wins.
  const ENTRY_FILE_PATTERNS = [
    /(?:^|\/)src\/App\.(jsx|tsx|js|ts|vue|svelte)$/i,
    /(?:^|\/)src\/main\.(jsx|tsx|js|ts)$/i,
    /(?:^|\/)src\/index\.(jsx|tsx|js|ts)$/i,
    /(?:^|\/)pages\/_app\.(jsx|tsx|js|ts)$/i,
    /(?:^|\/)app\/layout\.(jsx|tsx|js|ts)$/i,
    /(?:^|\/)src\/App\.(jsx|tsx)$/i,
  ];
  const entryComponentNames = new Set();
  for (const c of components) {
    if (ENTRY_FILE_PATTERNS.some(re => re.test(c.file))) {
      entryComponentNames.add(c.name);
    }
  }

  let componentsWired = 0;
  for (const c of components) {
    const compId = `comp:${c.name}`;
    graph.nodes[compId] = {
      id:        compId,
      name:      c.name,
      stability: entryComponentNames.has(c.name) ? "entry" : "component",
      kind:      "component",
      isEntry:   entryComponentNames.has(c.name),
      file:      c.file,
      functions: [],
      calls:     [],
    };
    graph.edges[compId]   = graph.edges[compId]   || new Set();
    graph.reverse[compId] = graph.reverse[compId] || new Set();

    // Wire component → all caps that share its file
    const caps = fileToCaps[c.file] ? [...fileToCaps[c.file]] : [];
    for (const capId of caps) {
      graph.edges[compId].add(capId);
      if (!graph.reverse[capId]) graph.reverse[capId] = new Set();
      graph.reverse[capId].add(compId);
      componentsWired++;
    }
  }

  // ── Component → Component composition edges ──────────────────────────────
  // For each component, look at its `renders[]` list and add a render-edge to
  // every child component name we found. This is what makes the graph read
  // like the actual JSX tree: App → TaskComposer + TaskList → TaskRow, etc.
  let renderEdges = 0;
  for (const c of components) {
    const parentId = `comp:${c.name}`;
    for (const childName of c.renders || []) {
      const childId = `comp:${childName}`;
      if (!graph.nodes[childId]) continue;       // child not detected as a component
      if (parentId === childId) continue;        // skip self
      graph.edges[parentId].add(childId);
      if (!graph.reverse[childId]) graph.reverse[childId] = new Set();
      graph.reverse[childId].add(parentId);
      renderEdges++;
    }
  }

  // ── UI layer: buttons, inputs, forms, links as a separate node tier ──────
  // UI element → component (its file's component) → capability
  const uiElements = Array.isArray(scan.uiElements) ? scan.uiElements : [];
  // file → component name (first match wins)
  const fileToComponent = {};
  for (const c of components) {
    if (!fileToComponent[c.file]) fileToComponent[c.file] = c.name;
  }
  // Build handler → capId index
  const handlerToCap = {};
  for (const cap of scanCaps) {
    const fns = cap.codeAnalysis?.functions || [];
    for (const fn of fns) {
      const bare = fn.replace(/\(\)$/, "");
      handlerToCap[bare] = cap.id;
      handlerToCap[bare.toLowerCase()] = cap.id;
    }
  }

  let uiWired = 0;
  for (const el of uiElements) {
    const uiId = `ui:${el.tag}:${el.handler}:${el.file.replace(/[^a-z0-9]/gi, "_")}`;
    graph.nodes[uiId] = {
      id:        uiId,
      name:      el.label || el.handler,
      stability: "ui",
      kind:      "ui",
      tag:       el.tag,
      handler:   el.handler,
      file:      el.file,
      functions: [],
      calls:     [],
    };
    graph.edges[uiId]   = graph.edges[uiId]   || new Set();
    graph.reverse[uiId] = graph.reverse[uiId] || new Set();

    // Prefer wiring through component → capability if we have a component for this file
    const compName = fileToComponent[el.file];
    if (compName) {
      const compId = `comp:${compName}`;
      if (graph.nodes[compId]) {
        graph.edges[uiId].add(compId);
        if (!graph.reverse[compId]) graph.reverse[compId] = new Set();
        graph.reverse[compId].add(uiId);
        uiWired++;
        continue;
      }
    }
    // Fallback: wire UI → capability directly via handler
    const target = handlerToCap[el.handler] || handlerToCap[el.handler?.toLowerCase()];
    if (target) {
      graph.edges[uiId].add(target);
      if (!graph.reverse[target]) graph.reverse[target] = new Set();
      graph.reverse[target].add(uiId);
      uiWired++;
    }
  }

  if (!jsonMode && !mermaidMode && !htmlMode) {
    if (componentsWired > 0) console.log(gray(`  🧩 Wired ${components.length} component${components.length === 1 ? "" : "s"} to capabilities.`));
    if (renderEdges > 0)     console.log(gray(`  🌳 Found ${renderEdges} component render relationship${renderEdges === 1 ? "" : "s"} (parent → child).`));
    if (uiWired > 0)         console.log(gray(`  ⚡ Wired ${uiWired} UI element${uiWired === 1 ? "" : "s"}.`));
    if (entryComponentNames.size > 0) console.log(gray(`  🚪 Entry: ${[...entryComponentNames].join(", ")}`));
  }

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

  if (mermaidMode) {
    console.log(renderMermaid(graph));
    return;
  }

  if (htmlMode) {
    const htmlPath = path.join(infernoDir, "graph.html");
    fs.writeFileSync(htmlPath, renderHtml(graph));
    console.log(green("✔ Interactive graph saved → inferno/graph.html"));
    console.log(gray(`  Open it: file://${htmlPath.replace(/\\/g, "/")}`));
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

// ── visual renderers ─────────────────────────────────────────────────────────

/**
 * Render the graph as Mermaid syntax. Pipe to a file or paste into:
 *  - GitHub markdown (renders inline)
 *  - VS Code markdown preview (with Mermaid extension)
 *  - https://mermaid.live for instant browser rendering
 */
function renderMermaid(graph) {
  const lines = [];
  lines.push("```mermaid");
  lines.push("graph LR");

  // Class definitions for each tier
  lines.push("  classDef frozen       fill:#fee,stroke:#c44,color:#900;");
  lines.push("  classDef stable       fill:#fffbe6,stroke:#cc9,color:#840;");
  lines.push("  classDef experimental fill:#eef,stroke:#88c,color:#226;");
  lines.push("  classDef component    fill:#fff3e0,stroke:#ff9800,color:#bf6d00;");
  lines.push("  classDef entry        fill:#fce4ec,stroke:#e91e63,color:#880e4f,stroke-width:3px;");
  lines.push("  classDef ui           fill:#e8f5e9,stroke:#4caf50,color:#2e7d32,stroke-dasharray:4 2;");

  // Nodes
  for (const id of Object.keys(graph.nodes)) {
    const safe = mermaidSafeId(id);
    const node = graph.nodes[id];
    if (node.kind === "ui") {
      const emoji = uiEmoji(node.tag);
      const label = `${emoji} ${node.name || node.handler}<br/><small>&lt;${node.tag}&gt;</small>`;
      lines.push(`  ${safe}(["${label}"]):::ui`);
    } else if (node.kind === "component") {
      // Component node — hexagon shape via {{ }}. Entry component gets a
      // 🚪 prefix and a different class so it pops in the diagram.
      if (node.isEntry) {
        lines.push(`  ${safe}{{"🚪 ${node.name} (entry)"}}:::entry`);
      } else {
        lines.push(`  ${safe}{{"🧩 ${node.name}"}}:::component`);
      }
    } else {
      const fnCount = node.functions?.length || 0;
      const label = `${node.name || id}<br/><small>${fnCount} fn${fnCount === 1 ? "" : "s"}</small>`;
      lines.push(`  ${safe}["${label}"]:::${node.stability || "experimental"}`);
    }
  }

  // Edges
  for (const [from, targets] of Object.entries(graph.edges)) {
    const arr = targets instanceof Set ? [...targets] : (Array.isArray(targets) ? targets : []);
    for (const to of arr) {
      lines.push(`  ${mermaidSafeId(from)} --> ${mermaidSafeId(to)}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/** Mermaid IDs can't contain dots, hyphens, etc. — sanitize. */
function mermaidSafeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Emoji prefix for UI tags so the diagram is scannable at a glance. */
function uiEmoji(tag) {
  switch (tag) {
    case "button": return "🔘";
    case "input":  return "⌨️ ";
    case "form":   return "📝";
    case "link":   return "🔗";
    case "select": return "▾";
    default:       return "🧩";
  }
}

/**
 * Render an interactive HTML page using Mermaid.js for proper hierarchical
 * flow-chart layout. Each tier (entry → component → capability → UI) reads
 * left-to-right with orthogonal lines and no node overlap — vs. the old
 * force-directed D3 layout that floated nodes randomly. v0.43.6 redesign.
 */
function renderHtml(graph) {
  // Build Mermaid graph definition (sans the ``` fence wrappers used by --mermaid)
  const lines = [];
  lines.push("graph LR");
  lines.push("  classDef frozen       fill:#3a1a1a,stroke:#d43f3a,color:#ff8a80,stroke-width:2px;");
  lines.push("  classDef stable       fill:#3a2a1a,stroke:#f0ad4e,color:#ffd180,stroke-width:2px;");
  lines.push("  classDef experimental fill:#1a2a3a,stroke:#5bc0de,color:#9fd6ed,stroke-width:2px;");
  lines.push("  classDef component    fill:#2a1f0a,stroke:#ff9800,color:#ffcc80,stroke-width:2px;");
  lines.push("  classDef entry        fill:#3a0a1f,stroke:#e91e63,color:#ff80ab,stroke-width:3px;");
  lines.push("  classDef ui           fill:#1a2e1a,stroke:#4caf50,color:#a5d6a7,stroke-width:2px,stroke-dasharray: 4 2;");

  for (const id of Object.keys(graph.nodes)) {
    const safe = mermaidSafeId(id);
    const node = graph.nodes[id];
    if (node.kind === "ui") {
      const emoji = uiEmoji(node.tag);
      const label = `${emoji} ${node.name || node.handler}`;
      lines.push(`  ${safe}(["${label}"]):::ui`);
    } else if (node.kind === "component") {
      if (node.isEntry) {
        lines.push(`  ${safe}{{"🚪 ${node.name}"}}:::entry`);
      } else {
        lines.push(`  ${safe}{{"🧩 ${node.name}"}}:::component`);
      }
    } else {
      const fnCount = node.functions?.length || 0;
      const label = `${node.name || id}<br/><small>${fnCount} fn${fnCount === 1 ? "" : "s"}</small>`;
      lines.push(`  ${safe}["${label}"]:::${node.stability || "experimental"}`);
    }
  }

  for (const [from, targets] of Object.entries(graph.edges)) {
    const arr = targets instanceof Set ? [...targets] : (Array.isArray(targets) ? targets : []);
    for (const to of arr) {
      lines.push(`  ${mermaidSafeId(from)} --> ${mermaidSafeId(to)}`);
    }
  }

  const mermaidSrc = lines.join("\n");
  const nodeCount = Object.keys(graph.nodes).length;
  const edgeCount = Object.values(graph.edges).reduce((n, set) => n + (set instanceof Set ? set.size : (Array.isArray(set) ? set.length : 0)), 0);

  // svg-pan-zoom for true zoom + pan on the rendered SVG (Mermaid produces SVG)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>infernoflow — code map</title>
<style>
  html, body { margin: 0; padding: 0; background: #1e1e1e; color: #ccc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; height: 100%; overflow: hidden; }
  header { padding: 12px 24px; background: #2a2a2a; border-bottom: 1px solid #3a3a3a; }
  header h1 { margin: 0; font-size: 16px; font-weight: 600; }
  header .meta { font-size: 12px; color: #999; margin-top: 4px; }
  header .meta span { margin-right: 16px; }
  header .legend { margin-top: 8px; font-size: 11px; }
  header .legend .chip { display: inline-block; padding: 2px 8px; border-radius: 4px; margin-right: 8px; font-size: 11px; border: 1px solid; }
  header .legend .entry        { color: #ff80ab; border-color: #e91e63; background: #3a0a1f; }
  header .legend .component    { color: #ffcc80; border-color: #ff9800; background: #2a1f0a; }
  header .legend .capability   { color: #9fd6ed; border-color: #5bc0de; background: #1a2a3a; }
  header .legend .ui           { color: #a5d6a7; border-color: #4caf50; background: #1a2e1a; border-style: dashed; }
  #map-wrap { width: 100vw; height: calc(100vh - 88px); overflow: auto; cursor: grab; }
  #map-wrap:active { cursor: grabbing; }
  #map { padding: 24px; display: inline-block; min-width: 100%; }
  .mermaid { background: transparent; }
  .mermaid svg { max-width: none !important; height: auto !important; }
  .empty { padding: 40px 24px; color: #888; font-size: 14px; }
</style>
</head>
<body>
<header>
  <h1>🔥 infernoflow — code map</h1>
  <div class="meta">
    <span>Generated: \${new Date().toLocaleString()}</span>
    <span>\${nodeCount} nodes · \${edgeCount} edges</span>
  </div>
  <div class="legend">
    <span class="chip entry">🚪 entry</span>
    <span class="chip component">🧩 component</span>
    <span class="chip capability">capability</span>
    <span class="chip ui">UI element</span>
    <span style="color:#666;">scroll to pan · pinch / Ctrl-scroll to zoom · click-drag empty area</span>
  </div>
</header>
<div id="map-wrap">
  <div id="map">
    \${nodeCount === 0
      ? '<div class="empty">No nodes to render — run <code>infernoflow scan</code> first.</div>'
      : '<pre class="mermaid">' + \`${mermaidSrc.replace(/`/g, "\`")}\` + '</pre>'
    }
  </div>
</div>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({
    startOnLoad: true,
    theme: "dark",
    securityLevel: "loose",
    flowchart: { useMaxWidth: false, htmlLabels: true, curve: "linear", padding: 20, nodeSpacing: 60, rankSpacing: 80 },
  });

  // Drag-to-pan on the wrapper (zoom is native via wheel/pinch + browser zoom)
  const wrap = document.getElementById("map-wrap");
  let dragging = false, startX = 0, startY = 0, scrollX = 0, scrollY = 0;
  wrap.addEventListener("mousedown", e => {
    if (e.target.closest("a, button")) return;
    dragging = true; startX = e.pageX; startY = e.pageY; scrollX = wrap.scrollLeft; scrollY = wrap.scrollTop;
    e.preventDefault();
  });
  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    wrap.scrollLeft = scrollX - (e.pageX - startX);
    wrap.scrollTop  = scrollY - (e.pageY - startY);
  });
  window.addEventListener("mouseup", () => { dragging = false; });
</script>
</body>
</html>`;
}

// ── exported utility for other commands ──────────────────────────────────────

export function loadGraph(infernoDir) {
  return loadJson(path.join(infernoDir, "graph.json"));
}
