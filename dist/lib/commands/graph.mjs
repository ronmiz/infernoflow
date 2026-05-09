import*as I from"node:fs";import*as v from"node:path";import{bold as w,cyan as X,gray as p,green as j,yellow as T,red as S}from"../ui/output.mjs";function D(i){try{return JSON.parse(I.readFileSync(i,"utf8"))}catch{return null}}function se(i){return i?.stability||"experimental"}const C={frozen:"\u{1F9CA}",stable:"\u3030\uFE0F ",experimental:"\u{1F30A}"},F={frozen:S,stable:T,experimental:j};function Z(i,o){const l={},c={},s={},n={};for(const t of i){const g=o.find(d=>d.id===t.id)||{};l[t.id]={id:t.id,name:t.name||g.name||g.title||t.id,stability:g.stability||"experimental",functions:t.codeAnalysis?.functions||[],calls:t.codeAnalysis?.calls||[],services:t.codeAnalysis?.services||[],dbCalls:t.codeAnalysis?.dbCalls||[],httpCalls:t.codeAnalysis?.httpCalls||[]},c[t.id]=new Set,s[t.id]=new Set;for(const d of t.codeAnalysis?.functions||[]){const f=d.replace(/\(\)$/,"");n[f]=t.id,n[f.toLowerCase()]=t.id}}for(const[t,g]of Object.entries(l))for(const d of g.calls){const f=d.replace(/\(\)$/,""),u=n[f]||n[f.toLowerCase()];u&&u!==t&&c[t]&&s[u]&&(c[t].add(u),s[u].add(t))}const y={},h={};for(const t of Object.keys(l))y[t]=[...c[t]],h[t]=[...s[t]];return{nodes:l,edges:y,reverse:h}}function q(i){const{nodes:o,edges:l,reverse:c}=i,s=Object.keys(o).sort();console.log(),console.log(w("  Capability Dependency Graph")),console.log(p("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")),console.log();let n=!1;for(const h of s){const t=o[h],g=l[h]||[],d=c[h]||[],f=C[t.stability]||"\u{1F30A}",u=F[t.stability]||j;if(!(g.length===0&&d.length===0)){if(n=!0,console.log(`  ${f} ${w(u(h))}`),g.length>0){console.log(p("    calls \u2192"));for(const $ of g){const b=o[$],H=C[b?.stability]||"\u{1F30A}";console.log(p(`       ${H} ${$}`))}}if(d.length>0){console.log(p("    called by \u2190"));for(const $ of d){const b=C[o[$]?.stability]||"\u{1F30A}";console.log(p(`       ${b} ${$}`))}}console.log()}}n||(console.log(p("  No inter-capability dependencies detected.")),console.log(p("  Run `infernoflow scan` first to populate call data.")),console.log());const y=Object.values(i.edges).reduce((h,t)=>h+t.length,0);console.log(p("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")),console.log(p(`  ${s.length} capabilities \xB7 ${y} dependency edge(s)`)),console.log()}function K(i,o){const{nodes:l,edges:c,reverse:s}=o,n=l[i];n||(console.error(S(`\u2717 Capability "${i}" not found in graph.`)),process.exit(1));const y=C[n.stability]||"\u{1F30A}",h=F[n.stability]||j;console.log(),console.log(w(`  ${y} ${h(i)}`)+p(`  (${n.stability})`)),n.services?.length&&console.log(p("  external: ")+X(n.services.join(", "))),console.log();const t=c[i]||[],g=s[i]||[];if(t.length>0){console.log(w("  Calls (downstream dependencies):"));for(const d of t){const f=l[d],u=F[f?.stability]||j,$=C[f?.stability]||"\u{1F30A}";console.log(`    ${$} ${u(d)}`+p(f?.services?.length?`  [${f.services.join(", ")}]`:""))}console.log()}else console.log(p("  No downstream dependencies.")),console.log();if(g.length>0){console.log(w("  Called by (upstream dependents):"));for(const d of g){const f=l[d],u=F[f?.stability]||j,$=C[f?.stability]||"\u{1F30A}";console.log(`    ${$} ${u(d)}`)}console.log()}else console.log(p("  No capabilities call this one.")),console.log();if((n.stability==="frozen"||n.stability==="stable")&&g.length>0){const d=n.stability==="frozen"?S:T;console.log(d(`  \u26A0  This capability is ${n.stability}. Changing it may break:`));for(const f of g)console.log(d(`     \u2022 ${f}`));console.log()}}function Q(i,o){const l=[];if(!i||!o)return l;for(const[c,s]of Object.entries(o.nodes)){if(s.stability==="experimental")continue;const n=new Set(i.reverse?.[c]||[]),h=[...new Set(o.reverse[c]||[])].filter(t=>!n.has(t));if(h.length>0&&l.push({type:"new-dependents",capId:c,stability:s.stability,detail:`${h.join(", ")} now depend on this`}),s.stability==="frozen"){const t=new Set(i.edges?.[c]||[]),g=new Set(o.edges[c]||[]),d=[...g].filter(u=>!t.has(u)),f=[...t].filter(u=>!g.has(u));(d.length>0||f.length>0)&&l.push({type:"frozen-internals-changed",capId:c,stability:s.stability,detail:[d.length?`added calls: ${d.join(", ")}`:"",f.length?`removed calls: ${f.join(", ")}`:""].filter(Boolean).join("; ")})}}return l}async function ae(i){const o=(i||[]).slice(1),l=o.includes("--json"),c=o.includes("--check"),s=o.includes("--mermaid"),n=o.includes("--html"),y=o.indexOf("--cap"),h=y!==-1?o[y+1]:null,t=process.cwd(),g=v.join(t,"inferno"),d=v.join(g,"scan.json"),f=v.join(g,"graph.json"),u=v.join(g,"capabilities.json"),$=300*1e3;let b=D(d);if(!b||!Array.isArray(b.capabilities)||b.capabilities.length===0||I.existsSync(d)&&Date.now()-I.statSync(d).mtimeMs>$){console.log(p("  \u27F3 Running infernoflow scan first (scan.json missing or stale)\u2026"));try{const{scanCommand:e}=await import("./scan.mjs");await e(["scan"]),b=D(d)}catch(e){console.error(S(`\u2717 Could not run scan automatically: ${e.message}`)),console.error(p("  Run `infernoflow scan` manually and try again.")),process.exit(1)}}(!b||!Array.isArray(b.capabilities)||b.capabilities.length===0)&&(console.error(S("\u2717 inferno/scan.json still empty after scan.")),console.error(p("   Make sure your contract has at least one capability and your code matches.")),process.exit(1));let P=[];const L=D(u);L&&(P=Array.isArray(L)?L:L.capabilities||[]);const W=b.capabilities||[],a=Z(W,P),k=Array.isArray(b.components)?b.components:[],A={};for(const e of W){const r=(e.codeAnalysis?.files||[]).map(x=>x.replace(/\\/g,"/"));for(const x of r)A[x]||(A[x]=new Set),A[x].add(e.id)}const Y=[/(?:^|\/)src\/App\.(jsx|tsx|js|ts|vue|svelte)$/i,/(?:^|\/)src\/main\.(jsx|tsx|js|ts)$/i,/(?:^|\/)src\/index\.(jsx|tsx|js|ts)$/i,/(?:^|\/)pages\/_app\.(jsx|tsx|js|ts)$/i,/(?:^|\/)app\/layout\.(jsx|tsx|js|ts)$/i,/(?:^|\/)src\/App\.(jsx|tsx)$/i],E=new Set;for(const e of k)Y.some(r=>r.test(e.file))&&E.add(e.name);let B=0;for(const e of k){const r=`comp:${e.name}`;a.nodes[r]={id:r,name:e.name,stability:E.has(e.name)?"entry":"component",kind:"component",isEntry:E.has(e.name),file:e.file,functions:[],calls:[]},a.edges[r]=a.edges[r]||new Set,a.reverse[r]=a.reverse[r]||new Set;const x=A[e.file]?[...A[e.file]]:[];for(const m of x)a.edges[r].add(m),a.reverse[m]||(a.reverse[m]=new Set),a.reverse[m].add(r),B++}let N=0;for(const e of k){const r=`comp:${e.name}`;for(const x of e.renders||[]){const m=`comp:${x}`;a.nodes[m]&&r!==m&&(a.edges[r].add(m),a.reverse[m]||(a.reverse[m]=new Set),a.reverse[m].add(r),N++)}}const G=Array.isArray(b.uiElements)?b.uiElements:[],_={};for(const e of k)_[e.file]||(_[e.file]=e.name);const M={};for(const e of W){const r=e.codeAnalysis?.functions||[];for(const x of r){const m=x.replace(/\(\)$/,"");M[m]=e.id,M[m.toLowerCase()]=e.id}}let z=0;for(const e of G){const r=`ui:${e.tag}:${e.handler}:${e.file.replace(/[^a-z0-9]/gi,"_")}`;a.nodes[r]={id:r,name:e.label||e.handler,stability:"ui",kind:"ui",tag:e.tag,handler:e.handler,file:e.file,functions:[],calls:[]},a.edges[r]=a.edges[r]||new Set,a.reverse[r]=a.reverse[r]||new Set;const x=_[e.file];if(x){const O=`comp:${x}`;if(a.nodes[O]){a.edges[r].add(O),a.reverse[O]||(a.reverse[O]=new Set),a.reverse[O].add(r),z++;continue}}const m=M[e.handler]||M[e.handler?.toLowerCase()];m&&(a.edges[r].add(m),a.reverse[m]||(a.reverse[m]=new Set),a.reverse[m].add(r),z++)}!l&&!s&&!n&&(B>0&&console.log(p(`  \u{1F9E9} Wired ${k.length} component${k.length===1?"":"s"} to capabilities.`)),N>0&&console.log(p(`  \u{1F333} Found ${N} component render relationship${N===1?"":"s"} (parent \u2192 child).`)),z>0&&console.log(p(`  \u26A1 Wired ${z} UI element${z===1?"":"s"}.`)),E.size>0&&console.log(p(`  \u{1F6AA} Entry: ${[...E].join(", ")}`)));const V=D(f),J=Q(V,a),U={builtAt:new Date().toISOString(),capabilities:Object.keys(a.nodes).length,edges:Object.values(a.edges).reduce((e,r)=>e+r.length,0),nodes:a.nodes,deps:a.edges,dependents:a.reverse};if(l||I.writeFileSync(f,JSON.stringify(U,null,2)),l){console.log(JSON.stringify(U,null,2));return}if(s){console.log(ee(a));return}if(n){const e=v.join(g,"graph.html");I.writeFileSync(e,te(a)),console.log(j("\u2714 Interactive graph saved \u2192 inferno/graph.html")),console.log(p(`  Open it: file://${e.replace(/\\/g,"/")}`));return}if(h?K(h,a):q(a),J.length>0){console.log(T("  \u26A0  Dependency changes detected:"));for(const e of J){const r=e.stability==="frozen"?S("\u{1F9CA}"):T("\u3030\uFE0F ");console.log(`  ${r} ${w(e.capId)} \u2014 ${e.detail}`)}console.log(),c&&process.exit(1)}l||console.log(p("  Graph saved \u2192 inferno/graph.json"))}function ee(i){const o=[];o.push("```mermaid"),o.push("graph LR"),o.push("  classDef frozen       fill:#fee,stroke:#c44,color:#900;"),o.push("  classDef stable       fill:#fffbe6,stroke:#cc9,color:#840;"),o.push("  classDef experimental fill:#eef,stroke:#88c,color:#226;"),o.push("  classDef component    fill:#fff3e0,stroke:#ff9800,color:#bf6d00;"),o.push("  classDef entry        fill:#fce4ec,stroke:#e91e63,color:#880e4f,stroke-width:3px;"),o.push("  classDef ui           fill:#e8f5e9,stroke:#4caf50,color:#2e7d32,stroke-dasharray:4 2;");for(const l of Object.keys(i.nodes)){const c=R(l),s=i.nodes[l];if(s.kind==="ui"){const y=`${ne(s.tag)} ${s.name||s.handler}<br/><small>&lt;${s.tag}&gt;</small>`;o.push(`  ${c}(["${y}"]):::ui`)}else if(s.kind==="component")s.isEntry?o.push(`  ${c}{{"\u{1F6AA} ${s.name} (entry)"}}:::entry`):o.push(`  ${c}{{"\u{1F9E9} ${s.name}"}}:::component`);else{const n=s.functions?.length||0,y=`${s.name||l}<br/><small>${n} fn${n===1?"":"s"}</small>`;o.push(`  ${c}["${y}"]:::${s.stability||"experimental"}`)}}for(const[l,c]of Object.entries(i.edges)){const s=c instanceof Set?[...c]:Array.isArray(c)?c:[];for(const n of s)o.push(`  ${R(l)} --> ${R(n)}`)}return o.push("```"),o.join(`
`)}function R(i){return String(i).replace(/[^a-zA-Z0-9_]/g,"_")}function ne(i){switch(i){case"button":return"\u{1F518}";case"input":return"\u2328\uFE0F ";case"form":return"\u{1F4DD}";case"link":return"\u{1F517}";case"select":return"\u25BE";default:return"\u{1F9E9}"}}function te(i){const o=Object.keys(i.nodes).map(s=>{const n=i.nodes[s];return{id:s,name:n.name||s,stability:n.stability||"experimental",kind:n.kind||"capability",isEntry:!!n.isEntry,tag:n.tag||null,handler:n.handler||null,file:n.file||null,functions:n.functions?.length||0}}),l=[];for(const[s,n]of Object.entries(i.edges)){const y=n instanceof Set?[...n]:Array.isArray(n)?n:[];for(const h of y)l.push({source:s,target:h})}const c=JSON.stringify({nodes:o,links:l});return`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>infernoflow \u2014 capability graph</title>
<style>
  body { margin: 0; padding: 0; background: #1e1e1e; color: #ccc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; overflow: hidden; }
  header { padding: 12px 24px; background: #2a2a2a; border-bottom: 1px solid #3a3a3a; }
  header h1 { margin: 0; font-size: 16px; font-weight: 600; }
  header .meta { font-size: 12px; color: #999; margin-top: 4px; }
  header .meta span { margin-right: 16px; }
  header .legend { margin-top: 8px; font-size: 11px; }
  header .legend .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  svg { width: 100vw; height: calc(100vh - 88px); cursor: grab; }
  svg:active { cursor: grabbing; }
  .link { stroke: #555; stroke-opacity: 0.7; }
  .node circle { stroke: #1e1e1e; stroke-width: 2px; cursor: pointer; }
  .node text { fill: #ddd; font-size: 11px; font-weight: 500; pointer-events: none; }
  .node.frozen       circle { fill: #d43f3a; }
  .node.stable       circle { fill: #f0ad4e; }
  .node.experimental circle { fill: #5bc0de; }
  .node.component    circle { fill: #ff9800; }
  .node.component    text   { fill: #ffd180; }
  .node.entry        circle { fill: #e91e63; stroke: #ff80ab; stroke-width: 4px; }
  .node.entry        text   { fill: #ff80ab; font-weight: 700; }
  .node.ui           circle { fill: #4caf50; stroke-dasharray: 3 2; }
  .node.ui           text   { fill: #aef; font-weight: 400; font-style: italic; }
  .node:hover circle { stroke: #fff; stroke-width: 3px; }
  .tooltip { position: fixed; background: #2a2a2a; border: 1px solid #555; padding: 8px 12px; border-radius: 4px; font-size: 12px; pointer-events: none; opacity: 0; transition: opacity 0.15s; max-width: 300px; }
</style>
</head>
<body>
<header>
  <h1>\u{1F525} infernoflow \u2014 capability graph</h1>
  <div class="meta">
    <span>Generated: ${new Date().toLocaleString()}</span>
    <span>${o.length} capabilities \xB7 ${l.length} edges</span>
  </div>
  <div class="legend">
    <span><span class="swatch" style="background:#e91e63"></span>entry (App.jsx / main / index)</span>
    <span><span class="swatch" style="background:#ff9800"></span>component</span>
    <span><span class="swatch" style="background:#5bc0de"></span>capability</span>
    <span><span class="swatch" style="background:#4caf50"></span>UI element</span>
    <span><span class="swatch" style="background:#d43f3a"></span>frozen</span>
    <span style="color:#666; margin-left:16px;">drag \xB7 scroll to zoom \xB7 hover for details</span>
  </div>
</header>
<svg></svg>
<div class="tooltip" id="tt"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
<script>
const data = ${c};
const svg = d3.select("svg");
const W = window.innerWidth, H = window.innerHeight - 88;
const g = svg.append("g");

const zoom = d3.zoom().scaleExtent([0.3, 4]).on("zoom", e => g.attr("transform", e.transform));
svg.call(zoom);

const sim = d3.forceSimulation(data.nodes)
  .force("link",   d3.forceLink(data.links).id(d => d.id).distance(120))
  .force("charge", d3.forceManyBody().strength(-400))
  .force("center", d3.forceCenter(W/2, H/2))
  .force("collide", d3.forceCollide(40));

const link = g.append("g").selectAll("line")
  .data(data.links).enter().append("line")
  .attr("class", "link").attr("marker-end", "url(#arrow)");

svg.append("defs").append("marker").attr("id","arrow").attr("viewBox","0 -5 10 10").attr("refX",18).attr("refY",0).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto").append("path").attr("d","M0,-5L10,0L0,5").attr("fill","#888");

const node = g.append("g").selectAll(".node")
  .data(data.nodes).enter().append("g")
  .attr("class", d => "node " + (d.isEntry ? "entry" : (d.kind === "ui" ? "ui" : (d.kind === "component" ? "component" : d.stability))))
  .call(d3.drag()
    .on("start", (e,d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
    .on("drag",  (e,d) => { d.fx=e.x; d.fy=e.y; })
    .on("end",   (e,d) => { if (!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }));

node.append("circle").attr("r", d => {
  if (d.isEntry) return 18;             // entry component is biggest \u2014 root of the tree
  if (d.kind === "ui") return 7;
  if (d.kind === "component") return 11;
  return 12 + Math.min(d.functions, 8);
});
node.append("text").attr("dx", 18).attr("dy", 4).text(d => {
  if (d.kind === "ui") {
    const emoji = { button: "\u{1F518}", input: "\u2328\uFE0F", form: "\u{1F4DD}", link: "\u{1F517}", select: "\u25BE" }[d.tag] || "\u{1F9E9}";
    return emoji + " " + d.name;
  }
  if (d.kind === "component") return "\u{1F9E9} " + d.name;
  return d.name;
});

const tt = d3.select("#tt");
node.on("mouseover", (e,d) => {
  let html;
  if (d.kind === "ui") {
    html = \`<strong>\${d.name}</strong><br/>UI element: &lt;\${d.tag}&gt;<br/>Handler: \${d.handler || "\u2014"}\`;
  } else if (d.kind === "component") {
    html = \`<strong>\u{1F9E9} \${d.name}</strong><br/>Component<br/>\${d.file || ""}\`;
  } else {
    html = \`<strong>\${d.name}</strong><br/>Capability \xB7 \${d.stability}<br/>Functions: \${d.functions}\`;
  }
  tt.html(html).style("left", (e.pageX+12)+"px").style("top", (e.pageY+12)+"px").style("opacity", 1);
}).on("mouseout", () => tt.style("opacity", 0));

sim.on("tick", () => {
  link.attr("x1", d=>d.source.x).attr("y1", d=>d.source.y).attr("x2", d=>d.target.x).attr("y2", d=>d.target.y);
  node.attr("transform", d => \`translate(\${d.x},\${d.y})\`);
});
</script>
</body>
</html>`}function ie(i){return D(v.join(i,"graph.json"))}export{ae as graphCommand,ie as loadGraph};
