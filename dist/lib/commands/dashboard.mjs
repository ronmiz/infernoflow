import*as m from"node:fs";import*as g from"node:path";import*as V from"node:http";import*as K from"node:os";import{execSync as S,spawn as z}from"node:child_process";import{fileURLToPath as Q}from"node:url";import{header as X,ok as Z,info as P,warn as q,cyan as tt}from"../ui/output.mjs";const T=g.dirname(Q(import.meta.url));function et(t){const n=g.join(t,"contract.json");if(!m.existsSync(n))return null;try{return JSON.parse(m.readFileSync(n,"utf8"))}catch{return null}}function nt(t){for(const n of["capabilities.json","contract.json"]){const l=g.join(t,n);if(m.existsSync(l))try{return(JSON.parse(m.readFileSync(l,"utf8")).capabilities||[]).map(d=>typeof d=="string"?{id:d,title:d}:d)}catch{}}return[]}function at(t){const n=g.join(t,"developer-profile.json");if(!m.existsSync(n))return null;try{return JSON.parse(m.readFileSync(n,"utf8"))}catch{return null}}function it(t){const n=g.join(t,"agents");return m.existsSync(n)?m.readdirSync(n).filter(l=>l.endsWith(".json")).map(l=>{try{return JSON.parse(m.readFileSync(g.join(n,l),"utf8"))}catch{return null}}).filter(Boolean):[]}function ot(t){const n=g.join(t,"HOOK.log");if(!m.existsSync(n))return null;try{return JSON.parse(m.readFileSync(n,"utf8"))}catch{return null}}function st(t){try{const n=S("npx infernoflow check --json",{cwd:g.dirname(t),encoding:"utf8",timeout:15e3,stdio:["ignore","pipe","pipe"]});return JSON.parse(n)}catch(n){try{return JSON.parse(n.stdout||"{}")}catch{return{status:"error",error:"check failed"}}}}function ct(t){const n=g.join(t,"audit.json");if(!m.existsSync(n))return null;try{return JSON.parse(m.readFileSync(n,"utf8"))}catch{return null}}function rt(t){const n=g.join(t,"links.json");if(!m.existsSync(n))return[];try{return JSON.parse(m.readFileSync(n,"utf8"))}catch{return[]}}function dt(t,n){try{let d=function(e){const i=new Date(Date.UTC(e.getFullYear(),e.getMonth(),e.getDate())),p=i.getUTCDay()||7;i.setUTCDate(i.getUTCDate()+4-p);const v=new Date(Date.UTC(i.getUTCFullYear(),0,1)),x=Math.ceil(((i-v)/864e5+1)/7);return`${i.getUTCFullYear()}-W${String(x).padStart(2,"0")}`};var l=d;const u=S('git log --since="90 days ago" --format="%aI|%ae|%s" -- inferno/',{cwd:t,encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:8e3}).trim();if(!u)return{velocity:[],contributors:[],healthTrend:[]};const r=u.split(`
`).filter(Boolean).map(e=>{const[i,p,...v]=e.split("|");return{date:new Date(i),email:p||"unknown",subject:v.join("|")}}),h=new Map;for(const e of r){const i=d(e.date);h.set(i,(h.get(i)||0)+1)}const s=[],o=new Date;for(let e=12;e>=0;e--){const i=new Date(o);i.setDate(i.getDate()-e*7);const p=d(i);s.push({week:p,commits:h.get(p)||0})}const b=new Map;for(const e of r){const i=e.email.split("@")[0];b.set(i,(b.get(i)||0)+1)}const y=[...b.entries()].map(([e,i])=>({name:e,count:i})).sort((e,i)=>i.count-e.count).slice(0,8),c=s.map(e=>({week:e.week,score:e.commits===0?40:e.commits<=2?75:e.commits<=5?90:85,label:e.commits===0?"stale":e.commits<=2?"ok":e.commits<=5?"healthy":"busy"}));return{velocity:s,contributors:y,healthTrend:c}}catch{return{velocity:[],contributors:[],healthTrend:[]}}}function lt(t){const n=g.join(t,"scan.json");if(!m.existsSync(n))return null;try{return JSON.parse(m.readFileSync(n,"utf8"))}catch{return null}}function pt(t){const n=g.join(t,"graph.json");if(!m.existsSync(n))return null;try{return JSON.parse(m.readFileSync(n,"utf8"))}catch{return null}}function E(t){const n=nt(t),l=et(t),u=at(t),r=it(t),d=ot(t),h=st(t),s=ct(t),o=rt(t),b=u?.recentSessions?.slice(-10)||[],y=[...u?.agentCandidates||[],...u?.skillCandidates||[]],c=g.dirname(t),e=dt(c,t),i=lt(t),p=pt(t);return{caps:n,contract:l,agents:r,hookLog:d,check:h,sessions:b,candidates:y,audit:s,links:o,analytics:e,scan:i,graph:p,infernoDir:t}}function ut(t,n,l="#f97316",u=80){const d=u,h=t.length;if(!h)return`<svg width="600" height="${d}"></svg>`;const s=Math.max(...t,1),o=Math.floor(600/h)-4,b=t.map((y,c)=>{const e=Math.max(2,Math.round(y/s*(d-20))),i=c*(600/h)+2,p=d-e-10;return`<rect x="${i}" y="${p}" width="${o}" height="${e}" fill="${l}" rx="2" opacity="0.85"/>
            <title>${n[c]}: ${y}</title>`}).join(`
`);return`<svg viewBox="0 0 600 ${d}" width="100%" height="${d}" xmlns="http://www.w3.org/2000/svg">${b}</svg>`}function ht(t,n="#3b82f6",l=80){const r=l,d=t.length;if(d<2)return`<svg width="600" height="${r}"></svg>`;const h=Math.max(...t,1),s=Math.min(...t,0),o=h-s||1,b=t.map((y,c)=>{const e=Math.round(c/(d-1)*580)+10,i=Math.round(r-10-(y-s)/o*(r-20));return`${e},${i}`}).join(" ");return`<svg viewBox="0 0 600 ${r}" width="100%" height="${r}" xmlns="http://www.w3.org/2000/svg">
    <polyline points="${b}" fill="none" stroke="${n}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${t.map((y,c)=>{const[e,i]=b.split(" ")[c].split(",");return`<circle cx="${e}" cy="${i}" r="4" fill="${n}"><title>${y}</title></circle>`}).join("")}
  </svg>`}function mt(t,n,l){const u=l>0?Math.round(n/l*100):0,r=u>70?"#f97316":u>40?"#f59e0b":u>10?"#3b82f6":"#2d3148";return`<div class="heat-row">
    <span class="heat-name">${f(t)}</span>
    <div class="heat-bar-wrap"><div class="heat-bar" style="width:${u}%;background:${r}"></div></div>
    <span class="heat-count">${n}</span>
  </div>`}function ft(t,n){const{caps:l,agents:u,check:r,sessions:d,candidates:h,audit:s,links:o,analytics:b}=t,y=r?.status==="ok"?"#22c55e":r?.status==="warning"?"#f59e0b":r?.status==="error"?"#ef4444":"#6b7280",c=r?.status||"unknown",e=l.length,i=u.length,p=(r?.issues||[]).length,v=l.map(a=>{const w=a.status?`<span class="badge">${a.status}</span>`:"";return`<tr>
      <td><code>${f(a.id)}</code></td>
      <td>${f(a.title||"")}${w}</td>
      <td>${f(a.since||"")}</td>
    </tr>`}).join(`
`),x=u.map(a=>{const w=(a.steps||[]).map(j=>typeof j=="string"?j:j.command).join(" \u2192 "),C=a.confidence?`${Math.round(a.confidence*100)}%`:"\u2014";return`<tr>
      <td><strong>${f(a.name)}</strong></td>
      <td>${f(a.description||w)}</td>
      <td><code>${f(w)}</code></td>
      <td>${C}</td>
    </tr>`}).join(`
`),H=(r?.issues||[]).map(a=>`<li class="issue">${f(typeof a=="string"?a:a.message||JSON.stringify(a))}</li>`).join(`
`),L=d.slice().reverse().map(a=>{const w=(a.commands||[]).join(", "),C=a.startedAt?new Date(a.startedAt).toLocaleString():"unknown";return`<div class="session-item">
      <span class="session-date">${f(C)}</span>
      <span class="session-cmds">${f(w||"no commands recorded")}</span>
    </div>`}).join(`
`),R=h.map(a=>`<li class="candidate">${f(a.name||a.id||"unnamed")}: ${f(a.description||"")}</li>`).join(`
`),O=b?.velocity||[],$=b?.contributors||[],F=b?.healthTrend||[],J=O.map(a=>a.commits),A=O.map(a=>a.week),U=ut(J,A,"#f97316",90),D=F.map(a=>a.score),W=ht(D,"#3b82f6",80),B=$.length?Math.max(...$.map(a=>a.count)):1,_=$.length?$.map(a=>mt(a.name,a.count,B)).join(`
`):'<div class="empty">No git history in inferno/ yet</div>',k=s?.stats||null,I=k?.high??"\u2014",G=k?.medium??"\u2014",N=o.length;return`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>infernoflow \u2014 ${f(n)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2d3148;
    --text: #e2e8f0; --muted: #64748b; --accent: #f97316;
    --green: #22c55e; --yellow: #f59e0b; --red: #ef4444; --blue: #3b82f6;
  }
  body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
  header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 18px; font-weight: 700; }
  header .flame { font-size: 22px; }
  header .project { color: var(--muted); font-size: 13px; }
  header .live { margin-left: auto; font-size: 11px; color: var(--green); display: flex; align-items: center; gap: 4px; }
  header .live::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
  .card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 8px; }
  .card .value { font-size: 28px; font-weight: 700; }
  .card .sub   { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .status-ok      { color: var(--green); }
  .status-warning { color: var(--yellow); }
  .status-error   { color: var(--red); }
  section { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  section h2 { font-size: 13px; font-weight: 600; padding: 14px 18px; border-bottom: 1px solid var(--border); color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 18px; text-align: left; border-bottom: 1px solid var(--border); }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); background: rgba(255,255,255,0.02); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,0.03); }
  code { font-family: monospace; font-size: 12px; background: rgba(255,255,255,0.07); padding: 1px 5px; border-radius: 4px; }
  .badge { font-size: 10px; background: rgba(249,115,22,0.15); color: var(--accent); padding: 1px 6px; border-radius: 9px; margin-left: 6px; }
  .issues-list, .candidates-list { list-style: none; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; }
  .issue { color: var(--red); font-size: 13px; }
  .candidate { color: var(--yellow); font-size: 13px; }
  .empty { padding: 24px 18px; color: var(--muted); text-align: center; font-size: 13px; }
  .session-item { display: flex; gap: 16px; align-items: baseline; padding: 9px 18px; border-bottom: 1px solid var(--border); }
  .session-item:last-child { border-bottom: none; }
  .session-date { font-size: 11px; color: var(--muted); white-space: nowrap; min-width: 140px; }
  .session-cmds { font-size: 12px; color: var(--text); }
  /* Analytics */
  .chart-wrap { padding: 16px 18px; }
  .chart-label { font-size: 11px; color: var(--muted); margin-top: 6px; text-align: center; }
  .analytics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .heat-row { display: flex; align-items: center; gap: 10px; padding: 6px 18px; border-bottom: 1px solid var(--border); }
  .heat-row:last-child { border-bottom: none; }
  .heat-name  { min-width: 110px; font-size: 12px; color: var(--text); font-family: monospace; }
  .heat-bar-wrap { flex: 1; height: 10px; background: var(--border); border-radius: 5px; overflow: hidden; }
  .heat-bar   { height: 100%; border-radius: 5px; transition: width 0.3s; }
  .heat-count { font-size: 12px; color: var(--muted); min-width: 30px; text-align: right; }
  .audit-tags { display: flex; gap: 8px; padding: 14px 18px; flex-wrap: wrap; }
  .tag { font-size: 12px; padding: 4px 10px; border-radius: 9px; font-weight: 600; }
  .tag-high   { background: rgba(239,68,68,0.15);  color: #ef4444; }
  .tag-medium { background: rgba(245,158,11,0.15); color: #f59e0b; }
  .tag-low    { background: rgba(34,197,94,0.15);  color: #22c55e; }
  .tag-link   { background: rgba(59,130,246,0.15); color: #3b82f6; }
  footer { text-align: center; color: var(--muted); font-size: 11px; padding: 24px; }
</style>
</head>
<body>
<header>
  <span class="flame">\u{1F525}</span>
  <div>
    <h1>infernoflow</h1>
    <div class="project">${f(n)}</div>
  </div>
  <div class="live">Live</div>
</header>
<main>

  <!-- Stat cards -->
  <div class="cards">
    <div class="card">
      <div class="label">Contract status</div>
      <div class="value status-${c}" style="color:${y}">${c.toUpperCase()}</div>
      <div class="sub">${p>0?p+" issue"+(p!==1?"s":""):"All checks passed"}</div>
    </div>
    <div class="card">
      <div class="label">Capabilities</div>
      <div class="value">${e}</div>
      <div class="sub">tracked in contract</div>
    </div>
    <div class="card">
      <div class="label">Agents</div>
      <div class="value">${i}</div>
      <div class="sub">synthesized workflows</div>
    </div>
    <div class="card">
      <div class="label">Sessions</div>
      <div class="value">${d.length}</div>
      <div class="sub">recent sessions logged</div>
    </div>
    ${k?`
    <div class="card">
      <div class="label">Security surface</div>
      <div class="value" style="color:${I>0?"var(--red)":"var(--green)"}">${I}</div>
      <div class="sub">${I} high \xB7 ${G} medium risk caps</div>
    </div>`:""}
    <div class="card">
      <div class="label">Linked tickets</div>
      <div class="value" style="color:var(--blue)">${N}</div>
      <div class="sub">caps linked to Jira/Linear/GitHub</div>
    </div>
  </div>

  ${p>0?`
  <!-- Issues -->
  <section>
    <h2>\u26A0 Issues</h2>
    <ul class="issues-list">${H}</ul>
  </section>`:""}

  <!-- Capabilities -->
  <section>
    <h2>Capabilities (${e})</h2>
    ${e>0?`
    <table>
      <thead><tr><th>ID</th><th>Title</th><th>Since</th></tr></thead>
      <tbody>${v}</tbody>
    </table>`:'<div class="empty">No capabilities found in inferno/capabilities.json</div>'}
  </section>

  <!-- Agents -->
  <section>
    <h2>Synthesized Agents (${i})</h2>
    ${i>0?`
    <table>
      <thead><tr><th>Name</th><th>Description</th><th>Steps</th><th>Confidence</th></tr></thead>
      <tbody>${x}</tbody>
    </table>`:'<div class="empty">No agents yet \u2014 run <code>infernoflow synthesize</code> to generate them</div>'}
  </section>

  ${h.length>0?`
  <!-- Candidates -->
  <section>
    <h2>Workflow Candidates (${h.length})</h2>
    <ul class="candidates-list">${R}</ul>
  </section>`:""}

  <!-- Session timeline -->
  <section>
    <h2>Recent Sessions</h2>
    ${d.length>0?`<div>${L}</div>`:'<div class="empty">No session data yet \u2014 sessions are logged automatically as you use infernoflow</div>'}
  </section>

  <!-- Analytics: velocity + health trend -->
  ${O.length>0?`
  <div class="analytics-grid">
    <section>
      <h2>\u{1F4C8} Capability Velocity (13 weeks)</h2>
      <div class="chart-wrap">
        ${U}
        <div class="chart-label">Commits touching inferno/ per week</div>
      </div>
    </section>
    <section>
      <h2>\u{1F49A} Health Score Trend</h2>
      <div class="chart-wrap">
        ${W}
        <div class="chart-label">Heuristic health score over last 13 weeks</div>
      </div>
    </section>
  </div>`:""}

  <!-- Contributor heatmap -->
  ${$.length>0?`
  <section>
    <h2>\u{1F465} Contributor Heatmap (90 days)</h2>
    ${_}
  </section>`:""}

  <!-- Audit surface map (if audit.json exists) -->
  ${k?`
  <section>
    <h2>\u{1F510} Security Surface (last audit)</h2>
    <div class="audit-tags">
      <span class="tag tag-high">\u{1F534} ${k.high} HIGH</span>
      <span class="tag tag-medium">\u{1F7E1} ${k.medium} MEDIUM</span>
      <span class="tag tag-low">\u{1F7E2} ${k.low} LOW</span>
      ${N>0?`<span class="tag tag-link">\u{1F517} ${N} linked to tickets</span>`:""}
    </div>
    ${s.capabilities?`
    <table>
      <thead><tr><th>Severity</th><th>Capability</th><th>Tags</th></tr></thead>
      <tbody>
        ${s.capabilities.filter(a=>a.severity==="high"||a.severity==="medium").slice(0,10).map(a=>`
        <tr>
          <td style="color:${a.severity==="high"?"var(--red)":"var(--yellow)"}">${a.severity}</td>
          <td><code>${f(a.id)}</code></td>
          <td>${f((a.tags||[]).join(", "))}</td>
        </tr>`).join("")}
      </tbody>
    </table>`:""}
    <div style="padding:8px 18px;font-size:11px;color:var(--muted)">Run <code>infernoflow audit</code> to refresh \xB7 Last run: ${f(s.runAt?new Date(s.runAt).toLocaleString():"unknown")}</div>
  </section>`:`
  <section>
    <h2>\u{1F510} Security Surface</h2>
    <div class="empty">No audit data yet \u2014 run <code>infernoflow audit</code> to classify capabilities by security sensitivity</div>
  </section>`}


<!-- \u2500\u2500 Command Center \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
<section id="command-center">
  <h2>\u{1F39B}\uFE0F Command Center</h2>
  <div class="cc-layout">
    <!-- Left: capability list -->
    <div class="cc-caps">
      <h3>Capabilities</h3>
      <div class="cc-cap-list" id="cc-cap-list">
        ${t.caps.map(a=>{const w=a.stability||"experimental",C=w==="frozen"?"\u{1F9CA}":w==="stable"?"\u3030\uFE0F":"\u{1F30A}",M=t.scan?.capabilities?.find(Y=>Y.id===a.id)?.codeAnalysis?.sourceFiles||[];return`<div class="cc-cap-row" onclick="capDetail('${f(a.id)}')">
            <span class="cc-icon">${C}</span>
            <div class="cc-cap-info">
              <span class="cc-cap-id">${f(a.id)}</span>
              ${M.length?`<span class="cc-cap-file">${f(M[0])}</span>`:""}
            </div>
            <span class="cc-stab cc-stab-${w}" onclick="event.stopPropagation();cycleStability('${f(a.id)}','${w}')" title="Click to change stability">${w}</span>
          </div>`}).join("")}
        ${t.caps.length===0?'<div class="empty">No capabilities \u2014 run <code>infernoflow init</code></div>':""}
      </div>
    </div>

    <!-- Middle: quick command buttons -->
    <div class="cc-commands">
      <h3>Quick Commands</h3>
      <div class="cc-btn-grid">
        <button class="cc-btn cc-btn-blue"  onclick="runCmd('scan')">\u{1F52C} scan</button>
        <button class="cc-btn cc-btn-blue"  onclick="runCmd('graph')">\u{1F578}\uFE0F graph</button>
        <button class="cc-btn cc-btn-blue"  onclick="runCmd('stability')">\u{1F4A7} stability</button>
        <button class="cc-btn cc-btn-blue"  onclick="runCmd('check')">\u2705 check</button>
        <button class="cc-btn cc-btn-orange" onclick="runCmd('doctor')">\u{1FA7A} doctor</button>
        <button class="cc-btn cc-btn-orange" onclick="runCmd('coverage')">\u{1F4CA} coverage</button>
        <button class="cc-btn cc-btn-green" onclick="runCmd('status')">\u{1F4E1} status</button>
        <button class="cc-btn cc-btn-green" onclick="runCmd('health')">\u2764\uFE0F health</button>
      </div>

      <h3 style="margin-top:18px">Capability Actions</h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <input id="cc-capinput" class="cc-input" placeholder="capability-id" style="flex:1;min-width:120px"/>
        <button class="cc-btn cc-btn-blue"  onclick="runCapCmd('why')">\u{1F50D} why</button>
        <button class="cc-btn cc-btn-blue"  onclick="runCapCmd('impact')">\u{1F4A5} impact</button>
        <button class="cc-btn cc-btn-red"   onclick="runCapCmd('freeze')">\u{1F9CA} freeze</button>
        <button class="cc-btn cc-btn-green" onclick="runCapCmd('thaw')">\u{1F30A} thaw</button>
      </div>

      <!-- Terminal output -->
      <h3>Terminal Output</h3>
      <div class="cc-terminal" id="cc-terminal">
        <span class="cc-prompt">Ready. Click a command or capability to begin.</span>
      </div>
    </div>

    <!-- Right: cap detail -->
    <div class="cc-detail" id="cc-detail">
      <h3>Capability Detail</h3>
      <div class="empty" id="cc-detail-inner">Click a capability to see its impact analysis.</div>
    </div>
  </div>
</section>

</main>
<footer>infernoflow dashboard \xB7 auto-refreshes when inferno/ changes \xB7 <a href="/" style="color:var(--muted)">refresh now</a></footer>
<style>
  /* Command Center styles */
  .cc-layout { display:grid; grid-template-columns:220px 1fr 280px; gap:16px; margin-top:12px; min-height:420px; }
  .cc-caps   { background:var(--card); border-radius:8px; padding:12px; overflow:hidden; }
  .cc-caps h3, .cc-commands h3, .cc-detail h3 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 10px 0; }
  .cc-cap-list { display:flex; flex-direction:column; gap:4px; max-height:360px; overflow-y:auto; }
  .cc-cap-row  { display:flex; align-items:center; gap:8px; padding:7px 8px; border-radius:6px; cursor:pointer; transition:background .15s; }
  .cc-cap-row:hover { background:rgba(255,255,255,.06); }
  .cc-icon { font-size:14px; flex-shrink:0; }
  .cc-cap-info { flex:1; min-width:0; }
  .cc-cap-id   { display:block; font-size:12px; font-weight:600; color:var(--fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cc-cap-file { display:block; font-size:10px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cc-stab { font-size:10px; padding:2px 6px; border-radius:10px; cursor:pointer; white-space:nowrap; flex-shrink:0; }
  .cc-stab-frozen       { background:#7f1d1d; color:#fca5a5; }
  .cc-stab-stable       { background:#78350f; color:#fcd34d; }
  .cc-stab-experimental { background:#14532d; color:#86efac; }
  .cc-commands { background:var(--card); border-radius:8px; padding:12px; display:flex; flex-direction:column; }
  .cc-btn-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .cc-btn { border:none; border-radius:6px; padding:8px 12px; font-size:12px; font-weight:600; cursor:pointer; transition:opacity .15s; }
  .cc-btn:hover { opacity:.85; }
  .cc-btn-blue   { background:#1d4ed8; color:#fff; }
  .cc-btn-orange { background:#c2410c; color:#fff; }
  .cc-btn-green  { background:#15803d; color:#fff; }
  .cc-btn-red    { background:#b91c1c; color:#fff; }
  .cc-input { background:#1e2030; border:1px solid #374151; border-radius:6px; color:var(--fg); padding:7px 10px; font-size:12px; outline:none; }
  .cc-input:focus { border-color:#3b82f6; }
  .cc-terminal { background:#0d0f1a; border:1px solid #1e2030; border-radius:6px; padding:12px; font-family:monospace; font-size:11px; line-height:1.6; color:#a3e635; flex:1; min-height:180px; max-height:240px; overflow-y:auto; white-space:pre-wrap; word-break:break-all; margin-top:4px; }
  .cc-prompt { color:var(--muted); }
  .cc-detail { background:var(--card); border-radius:8px; padding:12px; overflow-y:auto; }
  .cc-detail-section { margin-bottom:14px; }
  .cc-detail-section h4 { font-size:11px; color:var(--muted); margin:0 0 6px 0; text-transform:uppercase; letter-spacing:.05em; }
  .cc-detail-row { display:flex; justify-content:space-between; font-size:12px; padding:3px 0; border-bottom:1px solid #1e2030; }
  .cc-detail-dep { font-size:12px; padding:3px 0; }
  .cc-risk-low      { color:#22c55e; font-weight:700; }
  .cc-risk-medium   { color:#f59e0b; font-weight:700; }
  .cc-risk-high     { color:#ef4444; font-weight:700; }
  .cc-risk-critical { color:#ef4444; font-weight:700; text-transform:uppercase; }
</style>
<script>
  // SSE live reload
  const es = new EventSource('/events');
  es.onmessage = () => window.location.reload();
  es.onerror   = () => {};

  // \u2500\u2500 Command runner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const terminal = document.getElementById('cc-terminal');

  async function runCmd(command, args = []) {
    terminal.textContent = '$ infernoflow ' + command + (args.length ? ' ' + args.join(' ') : '') + '\\n';
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args }),
      });
      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        terminal.textContent += dec.decode(value);
        terminal.scrollTop = terminal.scrollHeight;
      }
    } catch (e) {
      terminal.textContent += '\\nError: ' + e.message;
    }
  }

  function runCapCmd(command) {
    const capId = document.getElementById('cc-capinput').value.trim();
    if (!capId) { terminal.textContent = 'Enter a capability ID first.'; return; }
    runCmd(command, [capId]);
  }

  // \u2500\u2500 Capability detail panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  async function capDetail(capId) {
    document.getElementById('cc-capinput').value = capId;
    const detail = document.getElementById('cc-detail-inner');
    detail.innerHTML = '<div class="empty">Loading\u2026</div>';

    try {
      const [why, impact] = await Promise.all([
        fetch('/api/cap/' + encodeURIComponent(capId) + '/why').then(r => r.json()),
        fetch('/api/cap/' + encodeURIComponent(capId) + '/impact').then(r => r.json()),
      ]);

      const w = Array.isArray(why) ? why[0] : why;
      const im = impact?.capId ? impact : null;

      let html = '';

      if (w) {
        html += '<div class="cc-detail-section">';
        html += '<h4>\u{1F4CD} ' + (w.name || w.capId) + '</h4>';
        html += '<div class="cc-detail-row"><span>Stability</span><span class="cc-stab cc-stab-' + w.stability + '">' + w.stability + '</span></div>';
        if (w.sourceFiles?.length) html += '<div class="cc-detail-row"><span>Files</span><span style="color:#7dd3fc">' + w.sourceFiles.join(', ') + '</span></div>';
        if (w.services?.length) html += '<div class="cc-detail-row"><span>Uses</span><span style="color:#a78bfa">' + w.services.join(', ') + '</span></div>';
        if (w.throws?.length) html += '<div class="cc-detail-row"><span>Throws</span><span style="color:#f97316">' + w.throws.join(', ') + '</span></div>';
        html += '</div>';
      }

      if (im) {
        const riskCls = 'cc-risk-' + im.risk;
        html += '<div class="cc-detail-section">';
        html += '<h4>\u{1F4A5} Impact</h4>';
        html += '<div class="cc-detail-row"><span>Risk</span><span class="' + riskCls + '">' + im.risk.toUpperCase() + '</span></div>';
        html += '<div class="cc-detail-row"><span>Direct deps</span><span>' + im.summary.directCount + '</span></div>';
        html += '<div class="cc-detail-row"><span>Transitive</span><span>' + im.summary.transitiveCount + '</span></div>';
        if (im.direct?.length) {
          html += '<h4 style="margin-top:10px">Direct dependents</h4>';
          im.direct.forEach(d => { html += '<div class="cc-detail-dep">\u2192 <code>' + d + '</code></div>'; });
        }
        if (im.affectedScenarios?.length) {
          html += '<h4 style="margin-top:10px">Scenarios at risk</h4>';
          im.affectedScenarios.forEach(s => { html += '<div class="cc-detail-dep">\u26A0\uFE0F ' + s + '</div>'; });
        }
        html += '</div>';
      }

      if (!html) html = '<div class="empty">No data found for ' + capId + ' \u2014 run infernoflow scan first.</div>';
      detail.innerHTML = html;
    } catch (e) {
      detail.innerHTML = '<div class="empty">Error: ' + e.message + '</div>';
    }
  }

  // \u2500\u2500 Stability cycle \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  async function cycleStability(capId, current) {
    const next = current === 'experimental' ? 'stable' : current === 'stable' ? 'frozen' : 'experimental';
    if (!confirm('Change ' + capId + ' from ' + current + ' \u2192 ' + next + '?')) return;
    await fetch('/api/freeze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capId, level: next }),
    });
    window.location.reload();
  }
</script>
</body>
</html>`}function f(t){return String(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function gt(t,n){const l=g.dirname(t),u=g.basename(l),r=new Set;let d=null;try{m.watch(t,{recursive:!0},()=>{clearTimeout(d),d=setTimeout(()=>{for(const s of r)try{s.write(`data: reload

`)}catch{}},500)})}catch{}const h=V.createServer((s,o)=>{if(s.url==="/events"){o.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache",Connection:"keep-alive"}),r.add(o),s.on("close",()=>r.delete(o));return}if(s.url==="/api/data"){const c=E(t);o.writeHead(200,{"Content-Type":"application/json"}),o.end(JSON.stringify(c,null,2));return}if(s.url==="/api/run"&&s.method==="POST"){let c="";s.on("data",e=>{c+=e}),s.on("end",()=>{try{const{command:e="",args:i=[]}=JSON.parse(c),p=g.join(T,"../../bin/infernoflow.mjs");o.writeHead(200,{"Content-Type":"text/plain; charset=utf-8","Transfer-Encoding":"chunked","Cache-Control":"no-cache"});const v=z(process.execPath,[p,e,...i],{cwd:l,env:{...process.env,FORCE_COLOR:"0"}});v.stdout.on("data",x=>o.write(x)),v.stderr.on("data",x=>o.write(x)),v.on("close",x=>{o.write(`
[exit ${x}]
`),o.end()}),v.on("error",x=>{o.write(`
Error spawning command: ${x.message}
`),o.end()})}catch(e){o.writeHead(400,{"Content-Type":"text/plain"}),o.end("Bad request: "+e.message)}});return}const b=s.url?.match(/^\/api\/cap\/([^/]+)\/why$/);if(b){const c=decodeURIComponent(b[1]),e=g.join(T,"../../bin/infernoflow.mjs");let i="";const p=z(process.execPath,[e,"why",c,"--json"],{cwd:l,env:{...process.env,FORCE_COLOR:"0"}});p.stdout.on("data",v=>{i+=v}),p.stderr.on("data",()=>{}),p.on("close",()=>{try{o.writeHead(200,{"Content-Type":"application/json"}),o.end(i.trim()||"[]")}catch{}});return}const y=s.url?.match(/^\/api\/cap\/([^/]+)\/impact$/);if(y){const c=decodeURIComponent(y[1]),e=g.join(T,"../../bin/infernoflow.mjs");let i="";const p=z(process.execPath,[e,"impact",c,"--json"],{cwd:l,env:{...process.env,FORCE_COLOR:"0"}});p.stdout.on("data",v=>{i+=v}),p.stderr.on("data",()=>{}),p.on("close",()=>{try{o.writeHead(200,{"Content-Type":"application/json"}),o.end(i.trim()||"{}")}catch{}});return}if(s.url==="/api/freeze"&&s.method==="POST"){let c="";s.on("data",e=>{c+=e}),s.on("end",()=>{try{const{capId:e,level:i}=JSON.parse(c),p=g.join(T,"../../bin/infernoflow.mjs"),v=i==="experimental"?"thaw":"freeze",x=i==="stable"?[e,"--stable"]:[e];z(process.execPath,[p,v,...x],{cwd:l}).on("close",()=>{o.writeHead(200,{"Content-Type":"application/json"}),o.end(JSON.stringify({ok:!0}))})}catch(e){o.writeHead(400,{"Content-Type":"application/json"}),o.end(JSON.stringify({ok:!1,error:e.message}))}});return}try{const c=E(t),e=ft(c,u);o.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}),o.end(e)}catch(c){o.writeHead(500,{"Content-Type":"text/plain"}),o.end(`Error: ${c.message}`)}});return h.listen(n,"127.0.0.1",()=>{}),h}function bt(t){const n=K.platform();try{n==="darwin"?S(`open "${t}"`,{stdio:"ignore"}):n==="win32"?S(`start "" "${t}"`,{stdio:"ignore",shell:!0}):S(`xdg-open "${t}"`,{stdio:"ignore"})}catch{}}async function $t(t){const n=t.slice(1),l=n.includes("--no-open"),u=n.indexOf("--port"),r=u!==-1?parseInt(n[u+1],10):7337,d=process.cwd(),h=g.join(d,"inferno");X("infernoflow dashboard"),m.existsSync(h)||(q("inferno/ not found \u2014 run: infernoflow init"),process.exit(1));const s=`http://localhost:${r}`;gt(h,r),Z(`Dashboard running \u2192 ${tt(s)}`),P("Auto-refreshes when inferno/ files change"),P("Press Ctrl+C to stop"),console.log(),l||bt(s),await new Promise(()=>{})}export{$t as dashboardCommand};
