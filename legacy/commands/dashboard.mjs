/**
 * infernoflow dashboard
 *
 * Launches a local web server on http://localhost:7337 showing:
 *   - Contract health status
 *   - Capability list with add/remove/change history
 *   - Drift timeline (last N sessions)
 *   - Agent activity log
 *   - Auto-refresh via SSE (server-sent events)
 *
 * Usage:
 *   infernoflow dashboard              # open on port 7337
 *   infernoflow dashboard --port 8080  # custom port
 *   infernoflow dashboard --no-open    # don't auto-open browser
 */

import * as fs      from "node:fs";
import * as path    from "node:path";
import * as http    from "node:http";
import * as os      from "node:os";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { header, ok, info, warn, bold, cyan, gray } from "../ui/output.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── data loaders ──────────────────────────────────────────────────────────────

function loadContract(infernoDir) {
  const contractPath = path.join(infernoDir, "contract.json");
  if (!fs.existsSync(contractPath)) return null;
  try { return JSON.parse(fs.readFileSync(contractPath, "utf8")); } catch { return null; }
}

function loadCapabilities(infernoDir) {
  for (const name of ["capabilities.json", "contract.json"]) {
    const p = path.join(infernoDir, name);
    if (!fs.existsSync(p)) continue;
    try {
      const obj = JSON.parse(fs.readFileSync(p, "utf8"));
      const raw = obj.capabilities || [];
      return raw.map(c => typeof c === "string" ? { id: c, title: c } : c);
    } catch {}
  }
  return [];
}

function loadProfile(infernoDir) {
  const p = path.join(infernoDir, "developer-profile.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function loadAgents(infernoDir) {
  const agentsDir = path.join(infernoDir, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir)
    .filter(f => f.endsWith(".json"))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(agentsDir, f), "utf8")); } catch { return null; } })
    .filter(Boolean);
}

function loadHookLog(infernoDir) {
  const logPath = path.join(infernoDir, "HOOK.log");
  if (!fs.existsSync(logPath)) return null;
  try { return JSON.parse(fs.readFileSync(logPath, "utf8")); } catch { return null; }
}

function runCheck(infernoDir) {
  try {
    const out = execSync("npx infernoflow check --json", {
      cwd: path.dirname(infernoDir),
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch (err) {
    try { return JSON.parse(err.stdout || "{}"); } catch { return { status: "error", error: "check failed" }; }
  }
}

// ── Analytics data loaders ────────────────────────────────────────────────────

function loadAudit(infernoDir) {
  const p = path.join(infernoDir, "audit.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function loadLinks(infernoDir) {
  const p = path.join(infernoDir, "links.json");
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}

/**
 * Parse git log for inferno/ directory to build analytics:
 *   - capability velocity (caps added/removed per week)
 *   - contributor activity (commits per author)
 *   - health score trend (from check logs or heuristic via commit frequency)
 */
function loadGitAnalytics(cwd, infernoDir) {
  try {
    // Commits touching inferno/ in past 90 days (iso date, author email, subject)
    const raw = execSync(
      `git log --since="90 days ago" --format="%aI|%ae|%s" -- inferno/`,
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 8000 }
    ).trim();

    if (!raw) return { velocity: [], contributors: [], healthTrend: [] };

    const commits = raw.split("\n").filter(Boolean).map(line => {
      const [date, email, ...subjectParts] = line.split("|");
      return { date: new Date(date), email: email || "unknown", subject: subjectParts.join("|") };
    });

    // Bucket by ISO week (YYYY-Www)
    function isoWeek(d) {
      const dt  = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = dt.getUTCDay() || 7;
      dt.setUTCDate(dt.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
      return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    }

    // Velocity: commits per week
    const weekMap = new Map();
    for (const c of commits) {
      const w = isoWeek(c.date);
      weekMap.set(w, (weekMap.get(w) || 0) + 1);
    }
    // Fill in the last 13 weeks
    const velocity = [];
    const now = new Date();
    for (let i = 12; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const w = isoWeek(d);
      velocity.push({ week: w, commits: weekMap.get(w) || 0 });
    }

    // Contributors: unique authors, sorted by commit count
    const authorMap = new Map();
    for (const c of commits) {
      const name = c.email.split("@")[0];
      authorMap.set(name, (authorMap.get(name) || 0) + 1);
    }
    const contributors = [...authorMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Health trend: simple heuristic from commit density per week
    // More commits → more drift activity. We mark weeks with >3 commits as "busy" (amber), 0 = stale, else ok
    const healthTrend = velocity.map(v => ({
      week:  v.week,
      score: v.commits === 0 ? 40 : v.commits <= 2 ? 75 : v.commits <= 5 ? 90 : 85,
      label: v.commits === 0 ? "stale" : v.commits <= 2 ? "ok" : v.commits <= 5 ? "healthy" : "busy",
    }));

    return { velocity, contributors, healthTrend };
  } catch {
    return { velocity: [], contributors: [], healthTrend: [] };
  }
}

function loadScan(infernoDir) {
  const p = path.join(infernoDir, "scan.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function loadGraph(infernoDir) {
  const p = path.join(infernoDir, "graph.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function gatherData(infernoDir) {
  const caps     = loadCapabilities(infernoDir);
  const contract = loadContract(infernoDir);
  const profile  = loadProfile(infernoDir);
  const agents   = loadAgents(infernoDir);
  const hookLog  = loadHookLog(infernoDir);
  const check    = runCheck(infernoDir);
  const audit    = loadAudit(infernoDir);
  const links    = loadLinks(infernoDir);
  const sessions = profile?.recentSessions?.slice(-10) || [];
  const candidates = [
    ...(profile?.agentCandidates || []),
    ...(profile?.skillCandidates || []),
  ];
  const cwd       = path.dirname(infernoDir);
  const analytics = loadGitAnalytics(cwd, infernoDir);
  const scan      = loadScan(infernoDir);
  const graph     = loadGraph(infernoDir);

  return { caps, contract, agents, hookLog, check, sessions, candidates, audit, links, analytics, scan, graph, infernoDir };
}

// ── HTML builder ──────────────────────────────────────────────────────────────

// ── SVG chart builders ────────────────────────────────────────────────────────

function barChart(values, labels, color = "#f97316", height = 80) {
  const W = 600, H = height;
  const n = values.length;
  if (!n) return `<svg width="${W}" height="${H}"></svg>`;
  const max   = Math.max(...values, 1);
  const bw    = Math.floor(W / n) - 4;
  const bars  = values.map((v, i) => {
    const bh = Math.max(2, Math.round((v / max) * (H - 20)));
    const x  = i * (W / n) + 2;
    const y  = H - bh - 10;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${color}" rx="2" opacity="0.85"/>
            <title>${labels[i]}: ${v}</title>`;
  }).join("\n");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

function lineChart(values, color = "#3b82f6", height = 80) {
  const W = 600, H = height;
  const n = values.length;
  if (n < 2) return `<svg width="${W}" height="${H}"></svg>`;
  const max  = Math.max(...values, 1);
  const min  = Math.min(...values, 0);
  const range = max - min || 1;
  const pts  = values.map((v, i) => {
    const x = Math.round((i / (n - 1)) * (W - 20)) + 10;
    const y = Math.round(H - 10 - ((v - min) / range) * (H - 20));
    return `${x},${y}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${values.map((v, i) => {
      const [px, py] = pts.split(" ")[i].split(",");
      return `<circle cx="${px}" cy="${py}" r="4" fill="${color}"><title>${v}</title></circle>`;
    }).join("")}
  </svg>`;
}

function heatRow(name, count, maxCount) {
  const pct  = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
  const fill = pct > 70 ? "#f97316" : pct > 40 ? "#f59e0b" : pct > 10 ? "#3b82f6" : "#2d3148";
  return `<div class="heat-row">
    <span class="heat-name">${esc(name)}</span>
    <div class="heat-bar-wrap"><div class="heat-bar" style="width:${pct}%;background:${fill}"></div></div>
    <span class="heat-count">${count}</span>
  </div>`;
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildHtml(data, projectName) {
  const { caps, agents, check, sessions, candidates, audit, links, analytics } = data;

  const statusColor = check?.status === "ok"      ? "#22c55e"
                    : check?.status === "warning"  ? "#f59e0b"
                    : check?.status === "error"    ? "#ef4444"
                    : "#6b7280";

  const statusLabel = check?.status || "unknown";
  const capCount    = caps.length;
  const agentCount  = agents.length;
  const issueCount  = (check?.issues || []).length;

  // Capability rows
  const capRows = caps.map(c => {
    const statusBadge = c.status ? `<span class="badge">${c.status}</span>` : "";
    return `<tr>
      <td><code>${esc(c.id)}</code></td>
      <td>${esc(c.title || "")}${statusBadge}</td>
      <td>${esc(c.since || "")}</td>
    </tr>`;
  }).join("\n");

  // Agent rows
  const agentRows = agents.map(a => {
    const steps = (a.steps || []).map(s => typeof s === "string" ? s : s.command).join(" → ");
    const conf  = a.confidence ? `${Math.round(a.confidence * 100)}%` : "—";
    return `<tr>
      <td><strong>${esc(a.name)}</strong></td>
      <td>${esc(a.description || steps)}</td>
      <td><code>${esc(steps)}</code></td>
      <td>${conf}</td>
    </tr>`;
  }).join("\n");

  // Issues
  const issueItems = (check?.issues || []).map(i =>
    `<li class="issue">${esc(typeof i === "string" ? i : i.message || JSON.stringify(i))}</li>`
  ).join("\n");

  // Session timeline
  const sessionItems = sessions.slice().reverse().map(s => {
    const cmds = (s.commands || []).join(", ");
    const date = s.startedAt ? new Date(s.startedAt).toLocaleString() : "unknown";
    return `<div class="session-item">
      <span class="session-date">${esc(date)}</span>
      <span class="session-cmds">${esc(cmds || "no commands recorded")}</span>
    </div>`;
  }).join("\n");

  // Candidate suggestions
  const candidateItems = candidates.map(c =>
    `<li class="candidate">${esc(c.name || c.id || "unnamed")}: ${esc(c.description || "")}</li>`
  ).join("\n");

  // ── Analytics ─────────────────────────────────────────────────────────────
  const vel    = analytics?.velocity    || [];
  const contribs = analytics?.contributors || [];
  const trend  = analytics?.healthTrend || [];

  const velValues  = vel.map(v => v.commits);
  const velLabels  = vel.map(v => v.week);
  const velChart   = barChart(velValues, velLabels, "#f97316", 90);

  const trendValues = trend.map(t => t.score);
  const trendChart  = lineChart(trendValues, "#3b82f6", 80);

  const maxContrib = contribs.length ? Math.max(...contribs.map(c => c.count)) : 1;
  const heatRows   = contribs.length
    ? contribs.map(c => heatRow(c.name, c.count, maxContrib)).join("\n")
    : `<div class="empty">No git history in inferno/ yet</div>`;

  // Audit summary card
  const auditStats   = audit?.stats || null;
  const auditHigh    = auditStats?.high ?? "—";
  const auditMedium  = auditStats?.medium ?? "—";
  const linkedCount  = links.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>infernoflow — ${esc(projectName)}</title>
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
  <span class="flame">🔥</span>
  <div>
    <h1>infernoflow</h1>
    <div class="project">${esc(projectName)}</div>
  </div>
  <div class="live">Live</div>
</header>
<main>

  <!-- Stat cards -->
  <div class="cards">
    <div class="card">
      <div class="label">Contract status</div>
      <div class="value status-${statusLabel}" style="color:${statusColor}">${statusLabel.toUpperCase()}</div>
      <div class="sub">${issueCount > 0 ? issueCount + " issue" + (issueCount !== 1 ? "s" : "") : "All checks passed"}</div>
    </div>
    <div class="card">
      <div class="label">Capabilities</div>
      <div class="value">${capCount}</div>
      <div class="sub">tracked in contract</div>
    </div>
    <div class="card">
      <div class="label">Agents</div>
      <div class="value">${agentCount}</div>
      <div class="sub">synthesized workflows</div>
    </div>
    <div class="card">
      <div class="label">Sessions</div>
      <div class="value">${sessions.length}</div>
      <div class="sub">recent sessions logged</div>
    </div>
    ${auditStats ? `
    <div class="card">
      <div class="label">Security surface</div>
      <div class="value" style="color:${auditHigh > 0 ? "var(--red)" : "var(--green)"}">${auditHigh}</div>
      <div class="sub">${auditHigh} high · ${auditMedium} medium risk caps</div>
    </div>` : ""}
    <div class="card">
      <div class="label">Linked tickets</div>
      <div class="value" style="color:var(--blue)">${linkedCount}</div>
      <div class="sub">caps linked to Jira/Linear/GitHub</div>
    </div>
  </div>

  ${issueCount > 0 ? `
  <!-- Issues -->
  <section>
    <h2>⚠ Issues</h2>
    <ul class="issues-list">${issueItems}</ul>
  </section>` : ""}

  <!-- Capabilities -->
  <section>
    <h2>Capabilities (${capCount})</h2>
    ${capCount > 0 ? `
    <table>
      <thead><tr><th>ID</th><th>Title</th><th>Since</th></tr></thead>
      <tbody>${capRows}</tbody>
    </table>` : `<div class="empty">No capabilities found in inferno/capabilities.json</div>`}
  </section>

  <!-- Agents -->
  <section>
    <h2>Synthesized Agents (${agentCount})</h2>
    ${agentCount > 0 ? `
    <table>
      <thead><tr><th>Name</th><th>Description</th><th>Steps</th><th>Confidence</th></tr></thead>
      <tbody>${agentRows}</tbody>
    </table>` : `<div class="empty">No agents yet — run <code>infernoflow synthesize</code> to generate them</div>`}
  </section>

  ${candidates.length > 0 ? `
  <!-- Candidates -->
  <section>
    <h2>Workflow Candidates (${candidates.length})</h2>
    <ul class="candidates-list">${candidateItems}</ul>
  </section>` : ""}

  <!-- Session timeline -->
  <section>
    <h2>Recent Sessions</h2>
    ${sessions.length > 0 ? `<div>${sessionItems}</div>`
      : `<div class="empty">No session data yet — sessions are logged automatically as you use infernoflow</div>`}
  </section>

  <!-- Analytics: velocity + health trend -->
  ${vel.length > 0 ? `
  <div class="analytics-grid">
    <section>
      <h2>📈 Capability Velocity (13 weeks)</h2>
      <div class="chart-wrap">
        ${velChart}
        <div class="chart-label">Commits touching inferno/ per week</div>
      </div>
    </section>
    <section>
      <h2>💚 Health Score Trend</h2>
      <div class="chart-wrap">
        ${trendChart}
        <div class="chart-label">Heuristic health score over last 13 weeks</div>
      </div>
    </section>
  </div>` : ""}

  <!-- Contributor heatmap -->
  ${contribs.length > 0 ? `
  <section>
    <h2>👥 Contributor Heatmap (90 days)</h2>
    ${heatRows}
  </section>` : ""}

  <!-- Audit surface map (if audit.json exists) -->
  ${auditStats ? `
  <section>
    <h2>🔐 Security Surface (last audit)</h2>
    <div class="audit-tags">
      <span class="tag tag-high">🔴 ${auditStats.high} HIGH</span>
      <span class="tag tag-medium">🟡 ${auditStats.medium} MEDIUM</span>
      <span class="tag tag-low">🟢 ${auditStats.low} LOW</span>
      ${linkedCount > 0 ? `<span class="tag tag-link">🔗 ${linkedCount} linked to tickets</span>` : ""}
    </div>
    ${audit.capabilities ? `
    <table>
      <thead><tr><th>Severity</th><th>Capability</th><th>Tags</th></tr></thead>
      <tbody>
        ${audit.capabilities.filter(c => c.severity === "high" || c.severity === "medium").slice(0, 10).map(c => `
        <tr>
          <td style="color:${c.severity === "high" ? "var(--red)" : "var(--yellow)"}">${c.severity}</td>
          <td><code>${esc(c.id)}</code></td>
          <td>${esc((c.tags || []).join(", "))}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : ""}
    <div style="padding:8px 18px;font-size:11px;color:var(--muted)">Run <code>infernoflow audit</code> to refresh · Last run: ${esc(audit.runAt ? new Date(audit.runAt).toLocaleString() : "unknown")}</div>
  </section>` : `
  <section>
    <h2>🔐 Security Surface</h2>
    <div class="empty">No audit data yet — run <code>infernoflow audit</code> to classify capabilities by security sensitivity</div>
  </section>`}


<!-- ── Command Center ────────────────────────────────────────────────────── -->
<section id="command-center">
  <h2>🎛️ Command Center</h2>
  <div class="cc-layout">
    <!-- Left: capability list -->
    <div class="cc-caps">
      <h3>Capabilities</h3>
      <div class="cc-cap-list" id="cc-cap-list">
        ${data.caps.map(c => {
          const stability = c.stability || "experimental";
          const icon = stability === "frozen" ? "🧊" : stability === "stable" ? "〰️" : "🌊";
          const scanEntry = data.scan?.capabilities?.find(s => s.id === c.id);
          const files = scanEntry?.codeAnalysis?.sourceFiles || [];
          return `<div class="cc-cap-row" onclick="capDetail('${esc(c.id)}')">
            <span class="cc-icon">${icon}</span>
            <div class="cc-cap-info">
              <span class="cc-cap-id">${esc(c.id)}</span>
              ${files.length ? `<span class="cc-cap-file">${esc(files[0])}</span>` : ""}
            </div>
            <span class="cc-stab cc-stab-${stability}" onclick="event.stopPropagation();cycleStability('${esc(c.id)}','${stability}')" title="Click to change stability">${stability}</span>
          </div>`;
        }).join("")}
        ${data.caps.length === 0 ? `<div class="empty">No capabilities — run <code>infernoflow init</code></div>` : ""}
      </div>
    </div>

    <!-- Middle: quick command buttons -->
    <div class="cc-commands">
      <h3>Quick Commands</h3>
      <div class="cc-btn-grid">
        <button class="cc-btn cc-btn-blue"  onclick="runCmd('scan')">🔬 scan</button>
        <button class="cc-btn cc-btn-blue"  onclick="runCmd('graph')">🕸️ graph</button>
        <button class="cc-btn cc-btn-blue"  onclick="runCmd('stability')">💧 stability</button>
        <button class="cc-btn cc-btn-blue"  onclick="runCmd('check')">✅ check</button>
        <button class="cc-btn cc-btn-orange" onclick="runCmd('doctor')">🩺 doctor</button>
        <button class="cc-btn cc-btn-orange" onclick="runCmd('coverage')">📊 coverage</button>
        <button class="cc-btn cc-btn-green" onclick="runCmd('status')">📡 status</button>
        <button class="cc-btn cc-btn-green" onclick="runCmd('health')">❤️ health</button>
      </div>

      <h3 style="margin-top:18px">Capability Actions</h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <input id="cc-capinput" class="cc-input" placeholder="capability-id" style="flex:1;min-width:120px"/>
        <button class="cc-btn cc-btn-blue"  onclick="runCapCmd('why')">🔍 why</button>
        <button class="cc-btn cc-btn-blue"  onclick="runCapCmd('impact')">💥 impact</button>
        <button class="cc-btn cc-btn-red"   onclick="runCapCmd('freeze')">🧊 freeze</button>
        <button class="cc-btn cc-btn-green" onclick="runCapCmd('thaw')">🌊 thaw</button>
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
<footer>infernoflow dashboard · auto-refreshes when inferno/ changes · <a href="/" style="color:var(--muted)">refresh now</a></footer>
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

  // ── Command runner ──────────────────────────────────────────────────────────
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

  // ── Capability detail panel ─────────────────────────────────────────────────
  async function capDetail(capId) {
    document.getElementById('cc-capinput').value = capId;
    const detail = document.getElementById('cc-detail-inner');
    detail.innerHTML = '<div class="empty">Loading…</div>';

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
        html += '<h4>📍 ' + (w.name || w.capId) + '</h4>';
        html += '<div class="cc-detail-row"><span>Stability</span><span class="cc-stab cc-stab-' + w.stability + '">' + w.stability + '</span></div>';
        if (w.sourceFiles?.length) html += '<div class="cc-detail-row"><span>Files</span><span style="color:#7dd3fc">' + w.sourceFiles.join(', ') + '</span></div>';
        if (w.services?.length) html += '<div class="cc-detail-row"><span>Uses</span><span style="color:#a78bfa">' + w.services.join(', ') + '</span></div>';
        if (w.throws?.length) html += '<div class="cc-detail-row"><span>Throws</span><span style="color:#f97316">' + w.throws.join(', ') + '</span></div>';
        html += '</div>';
      }

      if (im) {
        const riskCls = 'cc-risk-' + im.risk;
        html += '<div class="cc-detail-section">';
        html += '<h4>💥 Impact</h4>';
        html += '<div class="cc-detail-row"><span>Risk</span><span class="' + riskCls + '">' + im.risk.toUpperCase() + '</span></div>';
        html += '<div class="cc-detail-row"><span>Direct deps</span><span>' + im.summary.directCount + '</span></div>';
        html += '<div class="cc-detail-row"><span>Transitive</span><span>' + im.summary.transitiveCount + '</span></div>';
        if (im.direct?.length) {
          html += '<h4 style="margin-top:10px">Direct dependents</h4>';
          im.direct.forEach(d => { html += '<div class="cc-detail-dep">→ <code>' + d + '</code></div>'; });
        }
        if (im.affectedScenarios?.length) {
          html += '<h4 style="margin-top:10px">Scenarios at risk</h4>';
          im.affectedScenarios.forEach(s => { html += '<div class="cc-detail-dep">⚠️ ' + s + '</div>'; });
        }
        html += '</div>';
      }

      if (!html) html = '<div class="empty">No data found for ' + capId + ' — run infernoflow scan first.</div>';
      detail.innerHTML = html;
    } catch (e) {
      detail.innerHTML = '<div class="empty">Error: ' + e.message + '</div>';
    }
  }

  // ── Stability cycle ─────────────────────────────────────────────────────────
  async function cycleStability(capId, current) {
    const next = current === 'experimental' ? 'stable' : current === 'stable' ? 'frozen' : 'experimental';
    if (!confirm('Change ' + capId + ' from ' + current + ' → ' + next + '?')) return;
    await fetch('/api/freeze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capId, level: next }),
    });
    window.location.reload();
  }
</script>
</body>
</html>`;
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function startServer(infernoDir, port) {
  const cwd         = path.dirname(infernoDir);
  const projectName = path.basename(cwd);
  const sseClients  = new Set();

  // Watch inferno/ for changes → notify SSE clients
  let watchTimer = null;
  try {
    fs.watch(infernoDir, { recursive: true }, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        for (const res of sseClients) {
          try { res.write("data: reload\n\n"); } catch {}
        }
      }, 500);
    });
  } catch {}

  const server = http.createServer((req, res) => {
    // SSE endpoint
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // JSON API
    if (req.url === "/api/data") {
      const data = gatherData(infernoDir);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
      return;
    }

    // ── Command runner: POST /api/run { command, args[] } ─────────────────────
    if (req.url === "/api/run" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const { command = "", args = [] } = JSON.parse(body);
          const binPath = path.join(__dirname, "../../bin/infernoflow.mjs");
          res.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8",
            "Transfer-Encoding": "chunked",
            "Cache-Control": "no-cache",
          });
          const child = spawn(process.execPath, [binPath, command, ...args], {
            cwd,
            env: { ...process.env, FORCE_COLOR: "0" },
          });
          child.stdout.on("data", d => res.write(d));
          child.stderr.on("data", d => res.write(d));
          child.on("close", code => {
            res.write(`\n[exit ${code}]\n`);
            res.end();
          });
          child.on("error", err => {
            res.write(`\nError spawning command: ${err.message}\n`);
            res.end();
          });
        } catch (err) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Bad request: " + err.message);
        }
      });
      return;
    }

    // ── Capability why: GET /api/cap/:id/why ──────────────────────────────────
    const whyMatch = req.url?.match(/^\/api\/cap\/([^/]+)\/why$/);
    if (whyMatch) {
      const capId  = decodeURIComponent(whyMatch[1]);
      const binPath = path.join(__dirname, "../../bin/infernoflow.mjs");
      let output = "";
      const child = spawn(process.execPath, [binPath, "why", capId, "--json"], {
        cwd, env: { ...process.env, FORCE_COLOR: "0" },
      });
      child.stdout.on("data", d => { output += d; });
      child.stderr.on("data", () => {});
      child.on("close", () => {
        try {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(output.trim() || "[]");
        } catch {}
      });
      return;
    }

    // ── Capability impact: GET /api/cap/:id/impact ────────────────────────────
    const impactMatch = req.url?.match(/^\/api\/cap\/([^/]+)\/impact$/);
    if (impactMatch) {
      const capId   = decodeURIComponent(impactMatch[1]);
      const binPath = path.join(__dirname, "../../bin/infernoflow.mjs");
      let output = "";
      const child = spawn(process.execPath, [binPath, "impact", capId, "--json"], {
        cwd, env: { ...process.env, FORCE_COLOR: "0" },
      });
      child.stdout.on("data", d => { output += d; });
      child.stderr.on("data", () => {});
      child.on("close", () => {
        try {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(output.trim() || "{}");
        } catch {}
      });
      return;
    }

    // ── Freeze/thaw: POST /api/freeze { capId, level } ───────────────────────
    if (req.url === "/api/freeze" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const { capId, level } = JSON.parse(body);
          const binPath = path.join(__dirname, "../../bin/infernoflow.mjs");
          const cmd     = level === "experimental" ? "thaw" : "freeze";
          const args    = level === "stable" ? [capId, "--stable"] : [capId];
          const child   = spawn(process.execPath, [binPath, cmd, ...args], { cwd });
          child.on("close", () => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          });
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // Dashboard HTML
    try {
      const data = gatherData(infernoDir);
      const html = buildHtml(data, projectName);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Error: ${err.message}`);
    }
  });

  server.listen(port, "127.0.0.1", () => {});
  return server;
}

function openBrowser(url) {
  const platform = os.platform();
  try {
    if (platform === "darwin") execSync(`open "${url}"`, { stdio: "ignore" });
    else if (platform === "win32") execSync(`start "" "${url}"`, { stdio: "ignore", shell: true });
    else execSync(`xdg-open "${url}"`, { stdio: "ignore" });
  } catch {}
}

// ── main ──────────────────────────────────────────────────────────────────────

export async function dashboardCommand(rawArgs) {
  const args    = rawArgs.slice(1);
  const noOpen  = args.includes("--no-open");
  const portIdx = args.indexOf("--port");
  const port    = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 7337;

  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  header("infernoflow dashboard");

  if (!fs.existsSync(infernoDir)) {
    warn("inferno/ not found — run: infernoflow init");
    process.exit(1);
  }

  const url = `http://localhost:${port}`;

  startServer(infernoDir, port);

  ok(`Dashboard running → ${cyan(url)}`);
  info("Auto-refreshes when inferno/ files change");
  info("Press Ctrl+C to stop");
  console.log();

  if (!noOpen) openBrowser(url);

  // Keep alive
  await new Promise(() => {});
}
