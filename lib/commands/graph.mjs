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
  // Use Map (not plain object) to avoid collisions with inherited properties like toString, constructor, etc.
  const funcIndex = new Map(); // functionName → capId
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
      funcIndex.set(bare, entry.id);
      funcIndex.set(bare.toLowerCase(), entry.id);
    }
  }

  // Build edges from calls[]
  for (const [capId, node] of Object.entries(nodes)) {
    for (const call of node.calls) {
      const bare   = call.replace(/\(\)$/, "");
      const target = funcIndex.get(bare) || funcIndex.get(bare.toLowerCase());
      if (target && target !== capId) {
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

// ── HTML graph generator ──────────────────────────────────────────────────────

export function buildGraphHtml(graphData) {
  const nodes     = graphData.nodes || {};
  const edges     = graphData.deps  || {};
  const allIds    = Object.keys(nodes);
  const edgeList  = [];
  for (const [from, targets] of Object.entries(edges)) {
    for (const to of targets) edgeList.push({ from, to });
  }

  const dataJson = JSON.stringify({ nodes: allIds, edges: edgeList });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>infernoflow — Capability Graph</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;height:100vh;display:flex;flex-direction:column}
  header{padding:14px 20px;border-bottom:1px solid #1e2535;display:flex;align-items:center;gap:12px;background:#0b0e18}
  header h1{font-size:14px;font-weight:700;color:#f1f5f9;letter-spacing:.02em}
  header span{font-size:12px;color:#64748b}
  #stats{margin-left:auto;font-size:11px;color:#475569}
  #canvas{flex:1;position:relative;overflow:hidden}
  svg{width:100%;height:100%}
  .node{cursor:pointer}
  .node rect{rx:8;ry:8;transition:filter .15s}
  .node rect:hover{filter:brightness(1.2)}
  .node text{font-size:11px;font-weight:600;pointer-events:none;text-anchor:middle;dominant-baseline:middle}
  .edge{fill:none;stroke:#334155;stroke-width:1.5;transition:stroke .15s,stroke-width .15s}
  .edge.active{stroke:#f97316;stroke-width:2.5}
  .edge.dim{stroke:#1e2535;stroke-width:1}
  .tooltip{position:absolute;background:#1e2535;border:1px solid #334155;border-radius:10px;padding:12px 16px;font-size:12px;pointer-events:none;opacity:0;transition:opacity .15s;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:220px;color:#e2e8f0;z-index:10}
  .tooltip strong{display:block;margin-bottom:6px;font-size:13px;color:#f1f5f9}
  .tag{display:inline-block;background:#0f1117;border:1px solid #334155;border-radius:4px;padding:2px 7px;margin:2px 2px 2px 0;font-size:10px;color:#94a3b8}
  .tag.calls{border-color:#6366f1;color:#a5b4fc}
  .tag.callers{border-color:#10b981;color:#6ee7b7}
  #legend{position:absolute;bottom:16px;left:20px;display:flex;gap:14px;font-size:11px;color:#64748b}
  .ldot{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:middle}
</style>
</head>
<body>
<header>
  <span style="font-size:18px">🔥</span>
  <h1>infernoflow — Capability Graph</h1>
  <span id="project-name"></span>
  <span id="stats"></span>
</header>
<div id="canvas">
  <svg id="svg">
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#334155"/></marker>
      <marker id="arr-hi" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#f97316"/></marker>
    </defs>
  </svg>
  <div class="tooltip" id="tip"></div>
  <div id="legend">
    <span><span class="ldot" style="background:#6366f180;border:2px solid #6366f1"></span>Has dependencies</span>
    <span><span class="ldot" style="background:#10b98180;border:2px solid #10b981"></span>View layer</span>
    <span><span class="ldot" style="background:#33415580;border:2px solid #475569"></span>Independent</span>
  </div>
</div>
<script>
const DATA = ${dataJson};
const NW=120, NH=34;

// Separate connected vs isolated nodes
const connectedSet = new Set([...DATA.edges.map(e=>e.from),...DATA.edges.map(e=>e.to)]);
const connected    = DATA.nodes.filter(id=>connectedSet.has(id));
const isolated     = DATA.nodes.filter(id=>!connectedSet.has(id));

// Layout connected nodes using basic force-inspired placement
const W = ()=>document.getElementById("canvas").offsetWidth  || 900;
const H = ()=>document.getElementById("canvas").offsetHeight || 600;

function layout() {
  const w=W(), h=H();
  const pos = {};
  // Find sources (no incoming edges)
  const hasIncoming = new Set(DATA.edges.map(e=>e.to));
  const sources = connected.filter(id=>!hasIncoming.has(id));
  const layers = [];
  const assigned = new Set();

  // BFS layering
  let layer = sources.filter(id=>connected.includes(id));
  while (layer.length > 0) {
    layers.push(layer);
    layer.forEach(id=>assigned.add(id));
    const next = [];
    for (const id of layer) {
      for (const {from,to} of DATA.edges) {
        if (from===id && !assigned.has(to)) { next.push(to); assigned.add(to); }
      }
    }
    layer = [...new Set(next)];
  }
  // Any connected nodes not yet assigned
  connected.filter(id=>!assigned.has(id)).forEach(id=>layers[layers.length-1||0]?.push(id)||layers.push([id]));

  const layerH = Math.min(140, (h-180) / Math.max(layers.length,1));
  layers.forEach((layer,li) => {
    const y = 60 + li*layerH;
    const totalW = layer.length*(NW+24)-24;
    const startX = (w-totalW)/2;
    layer.forEach((id,i)=>{
      pos[id] = { x: startX+i*(NW+24), y };
    });
  });

  // Isolated nodes in a grid at bottom
  const cols = Math.max(1, Math.floor((w-40)/(NW+8)));
  isolated.forEach((id,i)=>{
    const col=i%cols, row=Math.floor(i/cols);
    pos[id]={ x:20+col*(NW+8), y:h-120+row*40 };
  });

  return pos;
}

function render() {
  const svg = document.getElementById("svg");
  svg.innerHTML = \`<defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#334155"/></marker>
    <marker id="arr-hi" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#f97316"/></marker>
  </defs>\`;

  const pos = layout();

  function nodeColor(id) {
    if (!connectedSet.has(id)) return {fill:"#33415540",stroke:"#475569",text:"#94a3b8"};
    if (id.startsWith("View"))  return {fill:"#10b98120",stroke:"#10b981",text:"#6ee7b7"};
    return {fill:"#6366f120",stroke:"#6366f1",text:"#a5b4fc"};
  }

  // Draw edges first
  DATA.edges.forEach(({from,to})=>{
    const f=pos[from], t=pos[to];
    if (!f||!t) return;
    const fx=f.x+NW/2, fy=f.y+NH/2, tx=t.x+NW/2, ty=t.y+NH/2;
    const dx=tx-fx, dy=ty-fy, len=Math.sqrt(dx*dx+dy*dy)||1;
    const sx=fx+(dx/len)*(NW/2+4), sy=fy+(dy/len)*(NH/2+4);
    const ex=tx-(dx/len)*(NW/2+8), ey=ty-(dy/len)*(NH/2+8);
    const mx=(sx+ex)/2-dy*0.18, my=(sy+ey)/2+dx*0.18;
    const p=document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("d",\`M\${sx},\${sy} Q\${mx},\${my} \${ex},\${ey}\`);
    p.setAttribute("class","edge");
    p.setAttribute("marker-end","url(#arr)");
    p.dataset.from=from; p.dataset.to=to;
    svg.appendChild(p);
  });

  // Draw nodes
  DATA.nodes.forEach(id=>{
    const p=pos[id]; if(!p) return;
    const c=nodeColor(id);
    const isSmall=!connectedSet.has(id);
    const w=isSmall?NW:NW, h=isSmall?26:NH;

    const g=document.createElementNS("http://www.w3.org/2000/svg","g");
    g.setAttribute("class","node");
    g.setAttribute("transform",\`translate(\${p.x},\${p.y})\`);

    const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("width",w); rect.setAttribute("height",h);
    rect.setAttribute("rx",isSmall?5:8);
    rect.setAttribute("fill",c.fill);
    rect.setAttribute("stroke",c.stroke);
    rect.setAttribute("stroke-width",isSmall?"1.5":"2");

    const txt=document.createElementNS("http://www.w3.org/2000/svg","text");
    txt.setAttribute("x",w/2); txt.setAttribute("y",h/2);
    txt.setAttribute("fill",c.text);
    txt.setAttribute("font-size",isSmall?"9":"11");
    txt.setAttribute("font-weight","600");
    txt.setAttribute("text-anchor","middle");
    txt.setAttribute("dominant-baseline","middle");
    // Shorten long names for display
    let label=id;
    if(label.length>15) {
      label=label.replace(/([A-Z])/g,(m,c,o)=>o>0?' '+m:m);
      if(label.length>18) label=label.replace('Complete Pending On','CPO ').replace('Advance Repeat','AdvRpt ');
      if(label.length>18) label=id.replace(/([A-Z][a-z]+)/g,w=>w.slice(0,3)).slice(0,16);
    }
    txt.textContent=label;

    g.appendChild(rect); g.appendChild(txt);
    g.addEventListener("mouseenter",e=>showTip(id,e));
    g.addEventListener("mouseleave",hideTip);
    svg.appendChild(g);
  });

  document.getElementById("stats").textContent = \`\${DATA.nodes.length} capabilities · \${DATA.edges.length} edges\`;
}

function showTip(id, evt) {
  const calls   = DATA.edges.filter(e=>e.from===id).map(e=>e.to);
  const callers = DATA.edges.filter(e=>e.to===id).map(e=>e.from);
  let html = \`<strong>🌊 \${id}</strong>\`;
  if (calls.length)   html += \`<div style="margin-top:6px">calls →<br>\${calls.map(c=>\`<span class="tag calls">\${c}</span>\`).join('')}</div>\`;
  if (callers.length) html += \`<div style="margin-top:6px">← called by<br>\${callers.map(c=>\`<span class="tag callers">\${c}</span>\`).join('')}</div>\`;
  if (!calls.length && !callers.length) html += \`<div style="margin-top:6px;color:#475569;font-size:11px">No inter-capability dependencies</div>\`;
  const tip=document.getElementById("tip");
  tip.innerHTML=html; tip.style.opacity="1";
  const canvas=document.getElementById("canvas").getBoundingClientRect();
  let tx=evt.clientX-canvas.left+16, ty=evt.clientY-canvas.top-60;
  if(tx+220>canvas.width) tx=evt.clientX-canvas.left-236;
  tip.style.left=Math.max(0,tx)+"px"; tip.style.top=Math.max(0,ty)+"px";

  // Highlight edges
  document.querySelectorAll(".edge").forEach(p=>{
    const active=p.dataset.from===id||p.dataset.to===id;
    p.setAttribute("class",active?"edge active":"edge dim");
    p.setAttribute("marker-end",active?"url(#arr-hi)":"url(#arr)");
  });
}
function hideTip(){
  document.getElementById("tip").style.opacity="0";
  document.querySelectorAll(".edge").forEach(p=>{
    p.setAttribute("class","edge");
    p.setAttribute("marker-end","url(#arr)");
  });
}

render();
window.addEventListener("resize", render);
</script>
</body>
</html>`;
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function graphCommand(rawArgs) {
  const args      = (rawArgs || []).slice(1); // skip command name
  const jsonMode  = args.includes("--json");
  const checkMode = args.includes("--check");
  const htmlMode  = args.includes("--html");
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
    console.error(red("✗ inferno/scan.json not found — run `infernoflow scan` first."));
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

  // HTML output
  if (htmlMode) {
    const htmlPath = path.join(infernoDir, "graph.html");
    fs.writeFileSync(htmlPath, buildGraphHtml(graphData));
    console.log(gray(`\n  infernoflow graph  →  HTML`));
    console.log(gray("  ──────────────────────────────────────────────────────────────"));
    console.log(`  ${bold("graph.html")} written → ${cyan("inferno/graph.html")}`);
    console.log(gray(`  ${graphData.capabilities} capabilities · ${graphData.edges} dependency edge(s)`));
    console.log();
    console.log(gray(`  Open in browser:  `) + cyan(`inferno/graph.html`));
    console.log();
    return;
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
