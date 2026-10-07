import*as d from"node:fs";import*as f from"node:path";import"node:os";import{fileURLToPath as T}from"node:url";import{execSync as J}from"node:child_process";import{detectIdeContext as E}from"../ai/ideDetection.mjs";import{header as L,ok as w,warn as H,info as S,done as I,cyan as l,yellow as _,bold as y,green as u,gray as h}from"../ui/output.mjs";import"../cursorHooksInstall.mjs";import{refreshSecuritySensitiveCopies as N}from"../securityRefresh.mjs";import{updateProjectMcpJson as U,updateIdeMcpJson as W,updateClaudeDesktopPerProject as V,removeLegacyUserLevelEntry as C,claudeJsonPath as K,claudeDesktopConfigPath as v,runningFromNpxCache as B}from"../mcpRegistration.mjs";import"../vsCodeCopilotHooksInstall.mjs";import{updateInjectionConfig as q}from"../amp/io.mjs";import{findProjectRoot as G}from"../projectRoot.mjs";import{refreshRuleFilesFromMemory as z}from"../ruleFiles.mjs";import{injectionPatchFromArgs as Q}from"./refresh.mjs";const X=f.dirname(T(import.meta.url));function b(){return f.resolve(X,"../../templates")}function Y(t){try{return J(`npx infernoflow ${t}`,{encoding:"utf8",cwd:process.cwd(),timeout:6e4,stdio:["inherit","pipe","pipe"]})}catch(n){return n.stdout||n.stderr||n.message}}function k(t){if(!d.existsSync(t))return{data:{},existed:!1,corrupt:!1,backup:null};let n;try{n=d.readFileSync(t,"utf8")}catch{return{data:{},existed:!0,corrupt:!1,backup:null}}try{const c=JSON.parse(n);return!c||typeof c!="object"||Array.isArray(c)?{data:{},existed:!0,corrupt:!1,backup:null}:{data:c,existed:!0,corrupt:!1,backup:null}}catch{let c=null;try{c=`${t}.corrupt-${Date.now()}.bak`,d.writeFileSync(c,n,"utf8")}catch{c=null}return{data:{},existed:!0,corrupt:!0,backup:c}}}function Z(t){const n=f.join(t,".git","hooks","post-commit");if(!d.existsSync(n))return{installed:!1,removed:!1};try{const c=d.readFileSync(n,"utf8");if(!c.includes('infernoflow log "commit:'))return{installed:!1,removed:!1};const i=c.split(/\r?\n/).filter(s=>!s.includes('infernoflow log "commit:')&&!/^#\s*infernoflow(:| auto-capture)/.test(s.trim())&&!/^# Best-effort and non-blocking — never fails a commit\.$/.test(s.trim()));return i.filter(s=>s.trim()&&!s.startsWith("#!")).length?d.writeFileSync(n,i.join(`
`).replace(/\n*$/,`
`),"utf8"):d.unlinkSync(n),{installed:!1,removed:!0}}catch(c){return{installed:!1,removed:!1,error:c.message}}}const x=4,P=`#!/usr/bin/env node
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
  const msg = "User frustration: " + prompt.replace(/\\s+/g, " ").trim().replace(/^[\\s-]+/, "").slice(0, 60);
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
`;function ee(t){const n=f.join(t,".claude","hooks"),c=f.join(n,"log-frustration.mjs");try{d.mkdirSync(n,{recursive:!0}),d.writeFileSync(c,P,"utf8");try{d.chmodSync(c,493)}catch{}}catch(a){return{installed:!1,error:a.message}}const i=f.join(t,".claude","settings.json"),{data:o}=k(i);(!o.hooks||typeof o.hooks!="object")&&(o.hooks={}),Array.isArray(o.hooks.UserPromptSubmit)||(o.hooks.UserPromptSubmit=[]);const s="node .claude/hooks/log-frustration.mjs",p=o.hooks.UserPromptSubmit.some(a=>Array.isArray(a?.hooks)&&a.hooks.some(e=>typeof e?.command=="string"&&e.command.includes("log-frustration.mjs")));p||o.hooks.UserPromptSubmit.push({hooks:[{type:"command",command:s}]});try{d.mkdirSync(f.dirname(i),{recursive:!0}),d.writeFileSync(i,JSON.stringify(o,null,2),"utf8")}catch(a){return{installed:!0,registered:!1,error:a.message}}return{installed:!0,registered:!p}}const oe=`#!/usr/bin/env node
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
`;function te(t){const n=f.join(t,".claude","hooks"),c=f.join(n,"infernoflow-session.mjs");try{d.mkdirSync(n,{recursive:!0}),d.writeFileSync(c,oe,"utf8");try{d.chmodSync(c,493)}catch{}}catch(a){return{installed:!1,error:a.message}}const i=f.join(t,".claude","settings.json"),{data:o,corrupt:s}=k(i);if(s)return{installed:!0,registered:!1,error:"settings.json unreadable"};(!o.hooks||typeof o.hooks!="object")&&(o.hooks={});let p=!1;for(const[a,e]of[["SessionStart","start"],["SessionEnd","end"]])Array.isArray(o.hooks[a])||(o.hooks[a]=[]),o.hooks[a].some(m=>Array.isArray(m?.hooks)&&m.hooks.some(g=>typeof g?.command=="string"&&g.command.includes("infernoflow-session.mjs")))||(o.hooks[a].push({hooks:[{type:"command",command:`node .claude/hooks/infernoflow-session.mjs ${e}`}]}),p=!0);if(p)try{d.writeFileSync(i,JSON.stringify(o,null,2),"utf8")}catch(a){return{installed:!0,registered:!1,error:a.message}}return{installed:!0,registered:p}}const re=["infernoflow_status","infernoflow_check","infernoflow_context","infernoflow_git_drift","amp_read","amp_write","amp_search","amp_bookmark","amp_handoff","amp_health","amp_resume"],$=["infernoflow_status","infernoflow_check","infernoflow_git_drift","amp_read","amp_search","amp_health","amp_resume"],se=re.filter(t=>!$.includes(t));function ne(t,n){const c=f.join(t,".claude"),i=f.join(c,"settings.json"),{data:o}=k(i),s=r=>typeof r=="string"&&r.startsWith("mcp__infernoflow__"),p={...o};if(Array.isArray(o.allowedTools)){const r=o.allowedTools.filter(m=>!s(m));r.length?p.allowedTools=r:delete p.allowedTools}const a=o.permissions&&typeof o.permissions=="object"&&!Array.isArray(o.permissions)?{...o.permissions}:{},e=new Set(Array.isArray(a.allow)?a.allow:[]);for(const r of se)e.delete(`mcp__infernoflow__${r}`);e.delete("mcp__infernoflow__*");for(const r of $)e.add(`mcp__infernoflow__${r}`);return a.allow=[...e],p.permissions=a,d.mkdirSync(c,{recursive:!0}),d.writeFileSync(i,JSON.stringify(p,null,2),"utf8"),i}function ie(t,{silent:n=!1}={}){const c=b(),i=n?()=>{}:e=>w(e),o=n?()=>{}:e=>H(e),s={mcpServer:!1,projectMcpJson:!1,claudeJson:!1,claudeSettings:!1,claudeDesktop:!1,gitHooks:!1,captureHook:!1,backups:[]},p=(()=>{try{return G(t)}catch{return t}})();try{const e=N(t,{captureHookScript:P});e.length&&(s.securityRefreshed=e,e.some(r=>r.endsWith("inferno-mcp-server.mjs"))&&(s.mcpServer=!0),i("Security update: replaced outdated "+e.map(r=>l(r)).join(", ")))}catch{}B()&&o("infernoflow is running from the npx cache \u2014 MCP configs will point there and break when the cache is cleared. Install it: npm i -g infernoflow, then run: infernoflow setup --yes");let a=!1;try{const e=U(p);e.skipped==="tracked"?o(".mcp.json is tracked by git \u2014 not adding this machine's paths to it. Add the infernoflow server with: claude mcp add infernoflow -s local -- node <infernoflow>/bin/infernoflow.mjs mcp"):e.skipped?o(".mcp.json is unreadable \u2014 left unchanged"):(a=!0,e.updated&&(s.projectMcpJson=!0,i("Registered MCP server in "+l(".mcp.json")+h(" (Claude Code, this project only)"))),e.gitignored&&i("Added "+l(".mcp.json")+" to .gitignore (it holds this machine's paths)"))}catch(e){o(".mcp.json update skipped: "+e.message)}if(a)try{const e=C(K());e.removed&&(s.legacyClaudeJsonRemoved=e,i("Removed the old user-level infernoflow entry from "+l("~/.claude.json")+h(` (was pinned to ${e.pinnedTo||"one project"}; backup: ${e.backup})`)))}catch(e){o("~/.claude.json cleanup skipped: "+e.message)}for(const[e,r]of[["vscode",".vscode/mcp.json"],["cursor",".cursor/mcp.json"]])try{W(p,e).updated&&(s[e==="vscode"?"vscodeMcp":"cursorMcp"]=!0,i("Registered MCP server in "+l(r)))}catch(m){o(r+" update skipped: "+m.message)}try{const e=V(p);if(e.updated&&(s.claudeDesktop=!0,i("Registered MCP server "+l(e.name)+" in "+l("claude_desktop_config.json")+h(" (Claude Desktop app)"))),!e.skipped){const r=C(v());r.removed&&(s.legacyDesktopRemoved=r,i("Removed the old pinned infernoflow entry from "+l("claude_desktop_config.json")+h(` (backup: ${r.backup})`)))}}catch(e){o("Claude Desktop config skipped: "+e.message)}try{ne(t,!1),s.claudeSettings=!0,i("Pre-approved read-only infernoflow tools in "+l(".claude/settings.json")+" (memory writes still ask)")}catch(e){o(".claude/settings.json skipped: "+e.message)}try{Z(t).removed&&(s.gitHookRemoved=!0,i("Removed the old commit-logging line from "+l(".git/hooks/post-commit")+h(" (git already keeps commit history)")))}catch(e){o("git hook install skipped: "+e.message)}try{ee(t).installed&&(s.captureHook=!0,i("Installed capture hook \u2192 "+l(".claude/hooks/log-frustration.mjs")))}catch(e){o("capture hook install skipped: "+e.message)}try{te(t).registered&&(s.sessionHooks=!0,i("Installed session hooks \u2192 "+l(".claude/hooks/infernoflow-session.mjs")+h(" (fresh memory at start, resume point at end)")))}catch(e){o("session hooks skipped: "+e.message)}try{z(t)}catch{}return s}async function _e(t){const n=process.cwd(),c=t.includes("--force")||t.includes("-f"),i=t.includes("--yes")||t.includes("-y"),o=b();L("infernoflow setup");const{ideDetected:s}=E("auto");S(`IDE detected: ${y(s==="cursor"?"Cursor":s==="vscode"?"VS Code":s==="windsurf"?"Windsurf":"unknown")}`);const a=f.join(n,".ai-memory");d.existsSync(a)?w(".ai-memory/ already exists \u2014 skipping init"):(console.log(`
  ${_(".ai-memory/")} not found \u2014 running init ...
`),Y(i?"init --yes":"init"));const e=Q(t);if(Object.keys(e).length)try{q(n,e),w("Injection config updated \u2192 "+JSON.stringify(e))}catch{}console.log(),S("Wiring up MCP servers for Cursor / VS Code Copilot / Claude Code ...");const r=ie(n,{silent:!1});console.log(),I("infernoflow ready"),console.log(`
  ${y("What was set up:")}`),console.log(`    ${u("\u2714")} MCP server \u2192 ${l("infernoflow mcp")} ${h("(runs from the installed package)")}`),r.projectMcpJson&&console.log(`    ${u("\u2714")} Claude Code MCP config \u2192 ${l(".mcp.json")} ${h("(this project)")}`),r.cursorMcp&&console.log(`    ${u("\u2714")} Cursor MCP config \u2192 ${l(".cursor/mcp.json")}`),r.vscodeMcp&&console.log(`    ${u("\u2714")} VS Code Copilot MCP config \u2192 ${l(".vscode/mcp.json")}`),r.legacyClaudeJsonRemoved&&console.log(`    ${u("\u2714")} Removed old pinned entry from ${l("~/.claude.json")} ${h("(backup saved)")}`),r.claudeSettings&&console.log(`    ${u("\u2714")} Read-only tools pre-approved \u2192 ${l(".claude/settings.json")}`),r.claudeDesktop&&console.log(`    ${u("\u2714")} Claude Desktop MCP config \u2192 ${l("claude_desktop_config.json")}`),r.gitHookRemoved&&console.log(`    ${u("\u2714")} Old commit-logging hook removed \u2192 ${l(".git/hooks/post-commit")}`),r.sessionHooks&&console.log(`    ${u("\u2714")} Session hooks (fresh memory at start, resume point at end) \u2192 ${l(".claude/hooks/infernoflow-session.mjs")}`),r.captureHook&&console.log(`    ${u("\u2714")} Capture hook (Claude Code/Cursor) \u2192 ${l(".claude/hooks/log-frustration.mjs")}`);try{const{detectStaleMcpRuntime:m}=await import("../mcpRuntime.mjs"),{readFileSync:g}=await import("node:fs"),{dirname:R,join:A}=await import("node:path"),{fileURLToPath:M}=await import("node:url"),O=R(M(import.meta.url)),F=A(O,"..","..","package.json"),D=JSON.parse(g(F,"utf8")).version,j=m(n,D);j&&(console.log(),console.log(`  ${_("\u26A0")} ${y("Restart required:")} ${j.message}`))}catch{}console.log(),console.log(`  ${y("Next step:")} Restart your AI tool. Test by asking:`),console.log(`    ${l('"call the amp_write tool with a test note"')}`),console.log()}export{P as CAPTURE_HOOK_SCRIPT,x as CAPTURE_HOOK_VERSION,$ as MCP_READ_TOOLS,re as MCP_TOOLS,se as MCP_WRITE_TOOLS,oe as SESSION_HOOK_SCRIPT,ie as autoSetupMcp,v as claudeDesktopConfigPath,ee as installClaudeCodeCaptureHook,te as installClaudeSessionHooks,Z as installGitHooks,_e as setupCommand,ne as writeClaudeSettings};
