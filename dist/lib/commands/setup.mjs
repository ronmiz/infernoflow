import*as d from"node:fs";import*as f from"node:path";import"node:os";import{fileURLToPath as O}from"node:url";import{execSync as J}from"node:child_process";import{detectIdeContext as H}from"../ai/ideDetection.mjs";import{header as T,ok as k,warn as E,info as S,done as L,cyan as c,yellow as C,bold as y,green as u,gray as m}from"../ui/output.mjs";import"../cursorHooksInstall.mjs";import{refreshSecuritySensitiveCopies as I}from"../securityRefresh.mjs";import{updateProjectMcpJson as N,updateIdeMcpJson as U,updateClaudeDesktopPerProject as W,removeLegacyUserLevelEntry as v,claudeJsonPath as V,claudeDesktopConfigPath as b,runningFromNpxCache as K}from"../mcpRegistration.mjs";import"../vsCodeCopilotHooksInstall.mjs";import{updateInjectionConfig as B}from"../amp/io.mjs";import{findProjectRoot as q}from"../projectRoot.mjs";import{refreshRuleFilesFromMemory as G}from"../ruleFiles.mjs";import{injectionPatchFromArgs as z}from"./refresh.mjs";const Q=f.dirname(O(import.meta.url));function _(){return f.resolve(Q,"../../templates")}function X(t){try{return J(`npx infernoflow ${t}`,{encoding:"utf8",cwd:process.cwd(),timeout:6e4,stdio:["inherit","pipe","pipe"]})}catch(s){return s.stdout||s.stderr||s.message}}function w(t){if(!d.existsSync(t))return{data:{},existed:!1,corrupt:!1,backup:null};let s;try{s=d.readFileSync(t,"utf8")}catch{return{data:{},existed:!0,corrupt:!1,backup:null}}try{const i=JSON.parse(s);return!i||typeof i!="object"||Array.isArray(i)?{data:{},existed:!0,corrupt:!1,backup:null}:{data:i,existed:!0,corrupt:!1,backup:null}}catch{let i=null;try{i=`${t}.corrupt-${Date.now()}.bak`,d.writeFileSync(i,s,"utf8")}catch{i=null}return{data:{},existed:!0,corrupt:!0,backup:i}}}function Y(t){const s=f.join(t,".git","hooks","post-commit");if(!d.existsSync(s))return{installed:!1,removed:!1};try{const i=d.readFileSync(s,"utf8");if(!i.includes('infernoflow log "commit:'))return{installed:!1,removed:!1};const n=i.split(/\r?\n/).filter(r=>!r.includes('infernoflow log "commit:')&&!/^#\s*infernoflow(:| auto-capture)/.test(r.trim())&&!/^# Best-effort and non-blocking — never fails a commit\.$/.test(r.trim()));return n.filter(r=>r.trim()&&!r.startsWith("#!")).length?d.writeFileSync(s,n.join(`
`).replace(/\n*$/,`
`),"utf8"):d.unlinkSync(s),{installed:!1,removed:!0}}catch(i){return{installed:!1,removed:!1,error:i.message}}}const x=3,P=`#!/usr/bin/env node
// infernoflow UserPromptSubmit hook (Claude Code / Cursor).
// infernoflow-hook-version: ${x}
// Logs a best-effort 'attempt' entry when the user's prompt shows frustration,
// so the highest-value capture signal doesn't depend on the model remembering.
// Never blocks the prompt. Never uses a shell.
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
let prompt = "";
try { const j = JSON.parse(raw); prompt = j.prompt || j.user_prompt || j.userPrompt || ""; }
catch { prompt = raw; }

// Find the CLI's JavaScript entry point (never the .cmd / shell wrapper).
function findCliMjs() {
  let hits = [];
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    hits = execFileSync(finder, ["infernoflow"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 10_000 })
      .split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean);
  } catch {}
  // where (Windows) searches the current folder first: never use a launcher
  // that lives inside the project (a cloned repo could plant one).
  const proj = (process.env.CLAUDE_PROJECT_DIR || process.cwd()).toLowerCase();
  const inProject = (p) => { const r = p.toLowerCase(); return r === proj || r.startsWith(proj + "/") || r.startsWith(proj + "\\\\"); };
  for (const c of hits) {
    if (inProject(c)) continue;
    try { const real = realpathSync(c); if (/\\.m?js$/i.test(real) && !inProject(real)) return real; } catch {}
    const d = dirname(c);
    for (const pkg of [join(d, "node_modules", "infernoflow"), join(d, "..", "lib", "node_modules", "infernoflow")]) {
      for (const f of [join(pkg, "dist", "bin", "infernoflow.mjs"), join(pkg, "bin", "infernoflow.mjs")]) {
        if (existsSync(f)) return f;
      }
    }
  }
  return null;
}

const MARKERS = [/!!+/, /not working/i, /still (broken|failing|not)/i, /does ?n'?t work/i, /\\bbroken\\b/i, /\\bretry(ing)?\\b/i, /same error/i, /no change/i];
// D14 (0.46.0): one entry per burst \u2014 a run of frustrated prompts within 10
// minutes is the same problem; the agent / memory-keeper writes the real lesson.
const STATE = join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".ai-memory", ".hook-state.json");
function recentlyLogged() {
  try { const s = JSON.parse(readFileSync(STATE, "utf8")); return Date.now() - (s.lastFrustration || 0) < 10 * 60_000; } catch { return false; }
}
if (prompt && MARKERS.some((re) => re.test(prompt)) && !recentlyLogged()) {
  // Leading dashes are stripped so the text can never be read as a CLI flag.
  const msg = "User frustration: " + prompt.replace(/\\s+/g, " ").trim().replace(/^[\\s-]+/, "").slice(0, 120);
  const cli = findCliMjs();
  if (cli) {
    try {
      const r = spawnSync(process.execPath, [cli, "log", msg, "--type", "attempt", "--result", "failed", "--auto", "--quiet", "--source", "hook", "--tags", "needs-summary"], {
        stdio: "ignore", timeout: 15_000, windowsHide: true, shell: false,
      });
      // Start the cooldown only if the entry was actually written.
      if (r.status === 0) { try { writeFileSync(STATE, JSON.stringify({ lastFrustration: Date.now() })); } catch {} }
    } catch {}
  }
}
process.exit(0);
`;function Z(t){const s=f.join(t,".claude","hooks"),i=f.join(s,"log-frustration.mjs");try{d.mkdirSync(s,{recursive:!0}),d.writeFileSync(i,P,"utf8");try{d.chmodSync(i,493)}catch{}}catch(a){return{installed:!1,error:a.message}}const n=f.join(t,".claude","settings.json"),{data:o}=w(n);(!o.hooks||typeof o.hooks!="object")&&(o.hooks={}),Array.isArray(o.hooks.UserPromptSubmit)||(o.hooks.UserPromptSubmit=[]);const r="node .claude/hooks/log-frustration.mjs",p=o.hooks.UserPromptSubmit.some(a=>Array.isArray(a?.hooks)&&a.hooks.some(e=>typeof e?.command=="string"&&e.command.includes("log-frustration.mjs")));p||o.hooks.UserPromptSubmit.push({hooks:[{type:"command",command:r}]});try{d.mkdirSync(f.dirname(n),{recursive:!0}),d.writeFileSync(n,JSON.stringify(o,null,2),"utf8")}catch(a){return{installed:!0,registered:!1,error:a.message}}return{installed:!0,registered:!p}}const ee=`#!/usr/bin/env node
// infernoflow Claude Code session hook \u2014 usage: node infernoflow-session.mjs start|end
// infernoflow-hook-version: ${x}
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";

let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!existsSync(join(cwd, ".ai-memory"))) process.exit(0);

function findCliMjs() {
  let hits = [];
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    hits = execFileSync(finder, ["infernoflow"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 10_000 })
      .split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean);
  } catch {}
  // where (Windows) searches the current folder first: never use a launcher
  // that lives inside the project (a cloned repo could plant one).
  const proj = (process.env.CLAUDE_PROJECT_DIR || process.cwd()).toLowerCase();
  const inProject = (p) => { const r = p.toLowerCase(); return r === proj || r.startsWith(proj + "/") || r.startsWith(proj + "\\\\"); };
  for (const c of hits) {
    if (inProject(c)) continue;
    try { const real = realpathSync(c); if (/\\.m?js$/i.test(real) && !inProject(real)) return real; } catch {}
    const d = dirname(c);
    for (const pkg of [join(d, "node_modules", "infernoflow"), join(d, "..", "lib", "node_modules", "infernoflow")]) {
      for (const f of [join(pkg, "dist", "bin", "infernoflow.mjs"), join(pkg, "bin", "infernoflow.mjs")]) {
        if (existsSync(f)) return f;
      }
    }
  }
  return null;
}

const cli = findCliMjs();
if (!cli) process.exit(0);
if (process.argv[2] === "end") {
  try {
    // Payload fields go as arguments (not stdin): this process exits at once
    // (SessionEnd's ~1.5 s budget) and a pipe could be cut before it is read.
    let p = {}; try { p = JSON.parse(raw || "{}"); } catch {}
    const extra = [];
    if (typeof p.transcript_path === "string") extra.push("--transcript", p.transcript_path);
    if (typeof p.reason === "string") extra.push("--reason", p.reason.slice(0, 40));
    const child = spawn(process.execPath, [cli, "hook", "session-end", ...extra], { cwd, detached: true, stdio: "ignore", windowsHide: true, shell: false });
    child.unref();
  } catch {}
  process.exit(0);
}
try {
  const r = spawnSync(process.execPath, [cli, "hook", "session-start"], { cwd, input: raw, encoding: "utf8", timeout: 15000, windowsHide: true, shell: false });
  if (r.stdout) process.stdout.write(r.stdout);
} catch {}
process.exit(0);
`;function oe(t){const s=f.join(t,".claude","hooks"),i=f.join(s,"infernoflow-session.mjs");try{d.mkdirSync(s,{recursive:!0}),d.writeFileSync(i,ee,"utf8");try{d.chmodSync(i,493)}catch{}}catch(a){return{installed:!1,error:a.message}}const n=f.join(t,".claude","settings.json"),{data:o,corrupt:r}=w(n);if(r)return{installed:!0,registered:!1,error:"settings.json unreadable"};(!o.hooks||typeof o.hooks!="object")&&(o.hooks={});let p=!1;for(const[a,e]of[["SessionStart","start"],["SessionEnd","end"]])Array.isArray(o.hooks[a])||(o.hooks[a]=[]),o.hooks[a].some(h=>Array.isArray(h?.hooks)&&h.hooks.some(g=>typeof g?.command=="string"&&g.command.includes("infernoflow-session.mjs")))||(o.hooks[a].push({hooks:[{type:"command",command:`node .claude/hooks/infernoflow-session.mjs ${e}`}]}),p=!0);if(p)try{d.writeFileSync(n,JSON.stringify(o,null,2),"utf8")}catch(a){return{installed:!0,registered:!1,error:a.message}}return{installed:!0,registered:p}}const te=["infernoflow_status","infernoflow_check","infernoflow_context","infernoflow_git_drift","amp_read","amp_write","amp_search","amp_bookmark","amp_handoff","amp_health","amp_resume"];function re(t,s){const i=f.join(t,".claude"),n=f.join(i,"settings.json"),{data:o}=w(n),r=new Set(o.allowedTools||[]);for(const a of te)r.add(`mcp__infernoflow__${a}`);const p={...o,allowedTools:[...r]};return d.mkdirSync(i,{recursive:!0}),d.writeFileSync(n,JSON.stringify(p,null,2),"utf8"),n}function se(t,{silent:s=!1}={}){const i=_(),n=s?()=>{}:e=>k(e),o=s?()=>{}:e=>E(e),r={mcpServer:!1,projectMcpJson:!1,claudeJson:!1,claudeSettings:!1,claudeDesktop:!1,gitHooks:!1,captureHook:!1,backups:[]},p=(()=>{try{return q(t)}catch{return t}})();try{const e=I(t,{captureHookScript:P});e.length&&(r.securityRefreshed=e,e.some(l=>l.endsWith("inferno-mcp-server.mjs"))&&(r.mcpServer=!0),n("Security update: replaced outdated "+e.map(l=>c(l)).join(", ")))}catch{}K()&&o("infernoflow is running from the npx cache \u2014 MCP configs will point there and break when the cache is cleared. Install it: npm i -g infernoflow, then run: infernoflow setup --yes");let a=!1;try{const e=N(p);e.skipped==="tracked"?o(".mcp.json is tracked by git \u2014 not adding this machine's paths to it. Add the infernoflow server with: claude mcp add infernoflow -s local -- node <infernoflow>/bin/infernoflow.mjs mcp"):e.skipped?o(".mcp.json is unreadable \u2014 left unchanged"):(a=!0,e.updated&&(r.projectMcpJson=!0,n("Registered MCP server in "+c(".mcp.json")+m(" (Claude Code, this project only)"))),e.gitignored&&n("Added "+c(".mcp.json")+" to .gitignore (it holds this machine's paths)"))}catch(e){o(".mcp.json update skipped: "+e.message)}if(a)try{const e=v(V());e.removed&&(r.legacyClaudeJsonRemoved=e,n("Removed the old user-level infernoflow entry from "+c("~/.claude.json")+m(` (was pinned to ${e.pinnedTo||"one project"}; backup: ${e.backup})`)))}catch(e){o("~/.claude.json cleanup skipped: "+e.message)}for(const[e,l]of[["vscode",".vscode/mcp.json"],["cursor",".cursor/mcp.json"]])try{U(p,e).updated&&(r[e==="vscode"?"vscodeMcp":"cursorMcp"]=!0,n("Registered MCP server in "+c(l)))}catch(h){o(l+" update skipped: "+h.message)}try{const e=W(p);if(e.updated&&(r.claudeDesktop=!0,n("Registered MCP server "+c(e.name)+" in "+c("claude_desktop_config.json")+m(" (Claude Desktop app)"))),!e.skipped){const l=v(b());l.removed&&(r.legacyDesktopRemoved=l,n("Removed the old pinned infernoflow entry from "+c("claude_desktop_config.json")+m(` (backup: ${l.backup})`)))}}catch(e){o("Claude Desktop config skipped: "+e.message)}try{re(t,!1),r.claudeSettings=!0,n("Pre-approved infernoflow tools in "+c(".claude/settings.json"))}catch(e){o(".claude/settings.json skipped: "+e.message)}try{Y(t).removed&&(r.gitHookRemoved=!0,n("Removed the old commit-logging line from "+c(".git/hooks/post-commit")+m(" (git already keeps commit history)")))}catch(e){o("git hook install skipped: "+e.message)}try{Z(t).installed&&(r.captureHook=!0,n("Installed capture hook \u2192 "+c(".claude/hooks/log-frustration.mjs")))}catch(e){o("capture hook install skipped: "+e.message)}try{oe(t).registered&&(r.sessionHooks=!0,n("Installed session hooks \u2192 "+c(".claude/hooks/infernoflow-session.mjs")+m(" (fresh memory at start, resume point at end)")))}catch(e){o("session hooks skipped: "+e.message)}try{G(t)}catch{}return r}async function je(t){const s=process.cwd(),i=t.includes("--force")||t.includes("-f"),n=t.includes("--yes")||t.includes("-y"),o=_();T("infernoflow setup");const{ideDetected:r}=H("auto");S(`IDE detected: ${y(r==="cursor"?"Cursor":r==="vscode"?"VS Code":r==="windsurf"?"Windsurf":"unknown")}`);const a=f.join(s,".ai-memory");d.existsSync(a)?k(".ai-memory/ already exists \u2014 skipping init"):(console.log(`
  ${C(".ai-memory/")} not found \u2014 running init ...
`),X(n?"init --yes":"init"));const e=z(t);if(Object.keys(e).length)try{B(s,e),k("Injection config updated \u2192 "+JSON.stringify(e))}catch{}console.log(),S("Wiring up MCP servers for Cursor / VS Code Copilot / Claude Code ...");const l=se(s,{silent:!1});console.log(),L("infernoflow ready"),console.log(`
  ${y("What was set up:")}`),console.log(`    ${u("\u2714")} MCP server \u2192 ${c("infernoflow mcp")} ${m("(runs from the installed package)")}`),l.projectMcpJson&&console.log(`    ${u("\u2714")} Claude Code MCP config \u2192 ${c(".mcp.json")} ${m("(this project)")}`),l.cursorMcp&&console.log(`    ${u("\u2714")} Cursor MCP config \u2192 ${c(".cursor/mcp.json")}`),l.vscodeMcp&&console.log(`    ${u("\u2714")} VS Code Copilot MCP config \u2192 ${c(".vscode/mcp.json")}`),l.legacyClaudeJsonRemoved&&console.log(`    ${u("\u2714")} Removed old pinned entry from ${c("~/.claude.json")} ${m("(backup saved)")}`),l.claudeSettings&&console.log(`    ${u("\u2714")} Auto-approved tools \u2192 ${c(".claude/settings.json")}`),l.claudeDesktop&&console.log(`    ${u("\u2714")} Claude Desktop MCP config \u2192 ${c("claude_desktop_config.json")}`),l.gitHookRemoved&&console.log(`    ${u("\u2714")} Old commit-logging hook removed \u2192 ${c(".git/hooks/post-commit")}`),l.sessionHooks&&console.log(`    ${u("\u2714")} Session hooks (fresh memory at start, resume point at end) \u2192 ${c(".claude/hooks/infernoflow-session.mjs")}`),l.captureHook&&console.log(`    ${u("\u2714")} Capture hook (Claude Code/Cursor) \u2192 ${c(".claude/hooks/log-frustration.mjs")}`);try{const{detectStaleMcpRuntime:h}=await import("../mcpRuntime.mjs"),{readFileSync:g}=await import("node:fs"),{dirname:$,join:R}=await import("node:path"),{fileURLToPath:F}=await import("node:url"),M=$(F(import.meta.url)),A=R(M,"..","..","package.json"),D=JSON.parse(g(A,"utf8")).version,j=h(s,D);j&&(console.log(),console.log(`  ${C("\u26A0")} ${y("Restart required:")} ${j.message}`))}catch{}console.log(),console.log(`  ${y("Next step:")} Restart your AI tool. Test by asking:`),console.log(`    ${c('"call the amp_write tool with a test note"')}`),console.log()}export{P as CAPTURE_HOOK_SCRIPT,x as CAPTURE_HOOK_VERSION,te as MCP_TOOLS,ee as SESSION_HOOK_SCRIPT,se as autoSetupMcp,b as claudeDesktopConfigPath,Z as installClaudeCodeCaptureHook,oe as installClaudeSessionHooks,Y as installGitHooks,je as setupCommand,re as writeClaudeSettings};
