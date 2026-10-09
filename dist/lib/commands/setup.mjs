import{humanText as L,isFrustration as H}from"../frustration.mjs";import*as d from"node:fs";import*as u from"node:path";import"node:os";import{fileURLToPath as E}from"node:url";import{execSync as I}from"node:child_process";import{detectIdeContext as N}from"../ai/ideDetection.mjs";import{header as U,ok as k,warn as W,info as C,done as V,cyan as l,yellow as v,bold as y,green as m,gray as h}from"../ui/output.mjs";import"../cursorHooksInstall.mjs";import{refreshSecuritySensitiveCopies as B,hookVersionOf as w}from"../securityRefresh.mjs";import{updateProjectMcpJson as K,updateIdeMcpJson as q,updateClaudeDesktopPerProject as G,removeLegacyUserLevelEntry as x,claudeJsonPath as z,claudeDesktopConfigPath as b,runningFromNpxCache as Q}from"../mcpRegistration.mjs";import"../vsCodeCopilotHooksInstall.mjs";import{updateInjectionConfig as X}from"../amp/io.mjs";import{findProjectRoot as Y}from"../projectRoot.mjs";import{refreshRuleFilesFromMemory as Z}from"../ruleFiles.mjs";import{injectionPatchFromArgs as ee}from"./refresh.mjs";const oe=u.dirname(E(import.meta.url));function P(){return u.resolve(oe,"../../templates")}function te(t){try{return I(`npx infernoflow ${t}`,{encoding:"utf8",cwd:process.cwd(),timeout:6e4,stdio:["inherit","pipe","pipe"]})}catch(n){return n.stdout||n.stderr||n.message}}function j(t){if(!d.existsSync(t))return{data:{},existed:!1,corrupt:!1,backup:null};let n;try{n=d.readFileSync(t,"utf8")}catch{return{data:{},existed:!0,corrupt:!1,backup:null}}try{const i=JSON.parse(n);return!i||typeof i!="object"||Array.isArray(i)?{data:{},existed:!0,corrupt:!1,backup:null}:{data:i,existed:!0,corrupt:!1,backup:null}}catch{let i=null;try{i=`${t}.corrupt-${Date.now()}.bak`,d.writeFileSync(i,n,"utf8")}catch{i=null}return{data:{},existed:!0,corrupt:!0,backup:i}}}function re(t){const n=u.join(t,".git","hooks","post-commit");if(!d.existsSync(n))return{installed:!1,removed:!1};try{const i=d.readFileSync(n,"utf8");if(!i.includes('infernoflow log "commit:'))return{installed:!1,removed:!1};const c=i.split(/\r?\n/).filter(s=>!s.includes('infernoflow log "commit:')&&!/^#\s*infernoflow(:| auto-capture)/.test(s.trim())&&!/^# Best-effort and non-blocking — never fails a commit\.$/.test(s.trim()));return c.filter(s=>s.trim()&&!s.startsWith("#!")).length?d.writeFileSync(n,c.join(`
`).replace(/\n*$/,`
`),"utf8"):d.unlinkSync(n),{installed:!1,removed:!0}}catch(i){return{installed:!1,removed:!1,error:i.message}}}const $=5,S=`#!/usr/bin/env node
// infernoflow UserPromptSubmit hook (Claude Code / Cursor).
// infernoflow-hook-version: ${$}
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

// 0.46.3: only text the human typed counts \u2014 subagent hand-backs, system
// reminders, pasted logs and code reach this hook too. Same functions as
// lib/frustration.mjs (embedded from the running code) and the Cursor hook.
// Bound to fixed names: the published build is minified, so the embedded
// source may be "function n(e){\u2026}" \u2014 a named const keeps the call sites valid.
const humanText = ${L.toString()};
const isFrustration = ${H.toString()};
// D14 (0.46.0): one entry per burst \u2014 a run of frustrated prompts within 10
// minutes is the same problem; the agent / memory-keeper writes the real lesson.
const STATE = join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".ai-memory", ".hook-state.json");
function recentlyLogged() {
  try { const s = JSON.parse(readFileSync(STATE, "utf8")); return Date.now() - (s.lastFrustration || 0) < 10 * 60_000; } catch { return false; }
}
const text = humanText(prompt);
if (text && isFrustration(text) && !recentlyLogged()) {
  // Leading dashes are stripped so the text can never be read as a CLI flag.
  const msg = "User frustration: " + text.replace(/^[\\s-]+/, "").slice(0, 60);
  const cli = findCliMjs();
  if (cli) {
    try {
      const r = spawnSync(process.execPath, [cli, "log", msg, "--type", "attempt", "--result", "failed", "--auto", "--quiet", "--source", "hook", "--agent", "hook", "--tags", "needs-summary"], {
        stdio: "ignore", timeout: 15_000, windowsHide: true, shell: false,
      });
      // Start the cooldown only if the entry was actually written.
      if (r.status === 0) { try { writeFileSync(STATE, JSON.stringify({ lastFrustration: Date.now() })); } catch {} }
    } catch {}
  }
}
process.exit(0);
`;function se(t){const n=u.join(t,".claude","hooks"),i=u.join(n,"log-frustration.mjs");try{d.mkdirSync(n,{recursive:!0});let r=null;try{r=d.readFileSync(i,"utf8")}catch{}r&&w(r)>w(S)||d.writeFileSync(i,S,"utf8");try{d.chmodSync(i,493)}catch{}}catch(r){return{installed:!1,error:r.message}}const c=u.join(t,".claude","settings.json"),{data:o}=j(c);(!o.hooks||typeof o.hooks!="object")&&(o.hooks={}),Array.isArray(o.hooks.UserPromptSubmit)||(o.hooks.UserPromptSubmit=[]);const s="node .claude/hooks/log-frustration.mjs",p=o.hooks.UserPromptSubmit.some(r=>Array.isArray(r?.hooks)&&r.hooks.some(e=>typeof e?.command=="string"&&e.command.includes("log-frustration.mjs")));p||o.hooks.UserPromptSubmit.push({hooks:[{type:"command",command:s}]});try{d.mkdirSync(u.dirname(c),{recursive:!0}),d.writeFileSync(c,JSON.stringify(o,null,2),"utf8")}catch(r){return{installed:!0,registered:!1,error:r.message}}return{installed:!0,registered:!p}}const R=`#!/usr/bin/env node
// infernoflow Claude Code session hook \u2014 usage: node infernoflow-session.mjs start|end
// infernoflow-hook-version: ${$}
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
`;function ne(t){const n=u.join(t,".claude","hooks"),i=u.join(n,"infernoflow-session.mjs");try{d.mkdirSync(n,{recursive:!0});let r=null;try{r=d.readFileSync(i,"utf8")}catch{}r&&w(r)>w(R)||d.writeFileSync(i,R,"utf8");try{d.chmodSync(i,493)}catch{}}catch(r){return{installed:!1,error:r.message}}const c=u.join(t,".claude","settings.json"),{data:o,corrupt:s}=j(c);if(s)return{installed:!0,registered:!1,error:"settings.json unreadable"};(!o.hooks||typeof o.hooks!="object")&&(o.hooks={});let p=!1;for(const[r,e]of[["SessionStart","start"],["SessionEnd","end"]])Array.isArray(o.hooks[r])||(o.hooks[r]=[]),o.hooks[r].some(f=>Array.isArray(f?.hooks)&&f.hooks.some(g=>typeof g?.command=="string"&&g.command.includes("infernoflow-session.mjs")))||(o.hooks[r].push({hooks:[{type:"command",command:`node .claude/hooks/infernoflow-session.mjs ${e}`}]}),p=!0);if(p)try{d.writeFileSync(c,JSON.stringify(o,null,2),"utf8")}catch(r){return{installed:!0,registered:!1,error:r.message}}return{installed:!0,registered:p}}const ie=["infernoflow_status","infernoflow_check","infernoflow_context","infernoflow_git_drift","amp_read","amp_write","amp_search","amp_bookmark","amp_handoff","amp_health","amp_resume"],F=["infernoflow_status","infernoflow_check","infernoflow_git_drift","amp_read","amp_search","amp_health","amp_resume"],ce=["infernoflow_check","infernoflow_context"],ae=ie.filter(t=>!F.includes(t));function le(t,n){const i=u.join(t,".claude"),c=u.join(i,"settings.json"),{data:o}=j(c),s=f=>typeof f=="string"&&f.startsWith("mcp__infernoflow__"),p={...o};if(Array.isArray(o.allowedTools)){const f=o.allowedTools.filter(g=>!s(g));f.length?p.allowedTools=f:delete p.allowedTools}const r=o.permissions&&typeof o.permissions=="object"&&!Array.isArray(o.permissions)?{...o.permissions}:{},e=new Set(Array.isArray(r.allow)?r.allow:[]);for(const f of ae)e.delete(`mcp__infernoflow__${f}`);e.delete("mcp__infernoflow__*");const a=d.existsSync(u.join(t,"inferno","contract.json"));for(const f of F)ce.includes(f)&&!a?e.delete(`mcp__infernoflow__${f}`):e.add(`mcp__infernoflow__${f}`);return r.allow=[...e],p.permissions=r,d.mkdirSync(i,{recursive:!0}),d.writeFileSync(c,JSON.stringify(p,null,2),"utf8"),c}function de(t,{silent:n=!1}={}){const i=P(),c=n?()=>{}:e=>k(e),o=n?()=>{}:e=>W(e),s={mcpServer:!1,projectMcpJson:!1,claudeJson:!1,claudeSettings:!1,claudeDesktop:!1,gitHooks:!1,captureHook:!1,backups:[]},p=(()=>{try{return Y(t)}catch{return t}})();try{const e=B(t,{captureHookScript:S});e.length&&(s.securityRefreshed=e,e.some(a=>a.endsWith("inferno-mcp-server.mjs"))&&(s.mcpServer=!0),c("Security update: replaced outdated "+e.map(a=>l(a)).join(", ")))}catch{}Q()&&o("infernoflow is running from the npx cache \u2014 MCP configs will point there and break when the cache is cleared. Install it: npm i -g infernoflow, then run: infernoflow setup --yes");let r=!1;try{const e=K(p);e.skipped==="tracked"?o(".mcp.json is tracked by git \u2014 not adding this machine's paths to it. Add the infernoflow server with: claude mcp add infernoflow -s local -- node <infernoflow>/bin/infernoflow.mjs mcp"):e.skipped?o(".mcp.json is unreadable \u2014 left unchanged"):(r=!0,e.updated&&(s.projectMcpJson=!0,c("Registered MCP server in "+l(".mcp.json")+h(" (Claude Code, this project only)"))),e.gitignored&&c("Added "+l(".mcp.json")+" to .gitignore (it holds this machine's paths)"))}catch(e){o(".mcp.json update skipped: "+e.message)}if(r)try{const e=x(z());e.removed&&(s.legacyClaudeJsonRemoved=e,c("Removed the old user-level infernoflow entry from "+l("~/.claude.json")+h(` (was pinned to ${e.pinnedTo||"one project"}; backup: ${e.backup})`)))}catch(e){o("~/.claude.json cleanup skipped: "+e.message)}for(const[e,a]of[["vscode",".vscode/mcp.json"],["cursor",".cursor/mcp.json"]])try{q(p,e).updated&&(s[e==="vscode"?"vscodeMcp":"cursorMcp"]=!0,c("Registered MCP server in "+l(a)))}catch(f){o(a+" update skipped: "+f.message)}try{const e=G(p);if(e.updated&&(s.claudeDesktop=!0,c("Registered MCP server "+l(e.name)+" in "+l("claude_desktop_config.json")+h(" (Claude Desktop app)"))),!e.skipped){const a=x(b());a.removed&&(s.legacyDesktopRemoved=a,c("Removed the old pinned infernoflow entry from "+l("claude_desktop_config.json")+h(` (backup: ${a.backup})`)))}}catch(e){o("Claude Desktop config skipped: "+e.message)}try{le(t,!1),s.claudeSettings=!0,c("Pre-approved read-only infernoflow tools in "+l(".claude/settings.json")+" (memory writes still ask)")}catch(e){o(".claude/settings.json skipped: "+e.message)}try{re(t).removed&&(s.gitHookRemoved=!0,c("Removed the old commit-logging line from "+l(".git/hooks/post-commit")+h(" (git already keeps commit history)")))}catch(e){o("git hook install skipped: "+e.message)}try{se(t).installed&&(s.captureHook=!0,c("Installed capture hook \u2192 "+l(".claude/hooks/log-frustration.mjs")))}catch(e){o("capture hook install skipped: "+e.message)}try{ne(t).registered&&(s.sessionHooks=!0,c("Installed session hooks \u2192 "+l(".claude/hooks/infernoflow-session.mjs")+h(" (fresh memory at start, resume point at end)")))}catch(e){o("session hooks skipped: "+e.message)}try{Z(t)}catch{}return s}async function Pe(t){const n=process.cwd(),i=t.includes("--force")||t.includes("-f"),c=t.includes("--yes")||t.includes("-y"),o=P();U("infernoflow setup");const{ideDetected:s}=N("auto");C(`IDE detected: ${y(s==="cursor"?"Cursor":s==="vscode"?"VS Code":s==="windsurf"?"Windsurf":"unknown")}`);const r=u.join(n,".ai-memory");d.existsSync(r)?k(".ai-memory/ already exists \u2014 skipping init"):(console.log(`
  ${v(".ai-memory/")} not found \u2014 running init ...
`),te(c?"init --yes":"init"));const e=ee(t);if(Object.keys(e).length)try{X(n,e),k("Injection config updated \u2192 "+JSON.stringify(e))}catch{}console.log(),C("Wiring up MCP servers for Cursor / VS Code Copilot / Claude Code ...");const a=de(n,{silent:!1});console.log(),V("infernoflow ready"),console.log(`
  ${y("What was set up:")}`),console.log(`    ${m("\u2714")} MCP server \u2192 ${l("infernoflow mcp")} ${h("(runs from the installed package)")}`),a.projectMcpJson&&console.log(`    ${m("\u2714")} Claude Code MCP config \u2192 ${l(".mcp.json")} ${h("(this project)")}`),a.cursorMcp&&console.log(`    ${m("\u2714")} Cursor MCP config \u2192 ${l(".cursor/mcp.json")}`),a.vscodeMcp&&console.log(`    ${m("\u2714")} VS Code Copilot MCP config \u2192 ${l(".vscode/mcp.json")}`),a.legacyClaudeJsonRemoved&&console.log(`    ${m("\u2714")} Removed old pinned entry from ${l("~/.claude.json")} ${h("(backup saved)")}`),a.claudeSettings&&console.log(`    ${m("\u2714")} Read-only tools pre-approved \u2192 ${l(".claude/settings.json")}`),a.claudeDesktop&&console.log(`    ${m("\u2714")} Claude Desktop MCP config \u2192 ${l("claude_desktop_config.json")}`),a.gitHookRemoved&&console.log(`    ${m("\u2714")} Old commit-logging hook removed \u2192 ${l(".git/hooks/post-commit")}`),a.sessionHooks&&console.log(`    ${m("\u2714")} Session hooks (fresh memory at start, resume point at end) \u2192 ${l(".claude/hooks/infernoflow-session.mjs")}`),a.captureHook&&console.log(`    ${m("\u2714")} Capture hook (Claude Code/Cursor) \u2192 ${l(".claude/hooks/log-frustration.mjs")}`);try{const{detectStaleMcpRuntime:f}=await import("../mcpRuntime.mjs"),{readFileSync:g}=await import("node:fs"),{dirname:O,join:A}=await import("node:path"),{fileURLToPath:T}=await import("node:url"),M=O(T(import.meta.url)),D=A(M,"..","..","package.json"),J=JSON.parse(g(D,"utf8")).version,_=f(n,J);_&&(console.log(),console.log(`  ${v("\u26A0")} ${y("Restart required:")} ${_.message}`))}catch{}console.log(),console.log(`  ${y("Next step:")} Restart your AI tool. Test by asking:`),console.log(`    ${l('"call the amp_write tool with a test note"')}`),console.log()}export{S as CAPTURE_HOOK_SCRIPT,$ as CAPTURE_HOOK_VERSION,ce as MCP_CONTRACT_TOOLS,F as MCP_READ_TOOLS,ie as MCP_TOOLS,ae as MCP_WRITE_TOOLS,R as SESSION_HOOK_SCRIPT,de as autoSetupMcp,b as claudeDesktopConfigPath,se as installClaudeCodeCaptureHook,ne as installClaudeSessionHooks,re as installGitHooks,Pe as setupCommand,le as writeClaudeSettings};
