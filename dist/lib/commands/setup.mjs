import{humanText as H,isFrustration as I,saveSignal as L}from"../frustration.mjs";import*as d from"node:fs";import*as u from"node:path";import"node:os";import{fileURLToPath as E}from"node:url";import{execSync as N}from"node:child_process";import{detectIdeContext as U}from"../ai/ideDetection.mjs";import{header as W,ok as k,warn as V,info as C,done as B,cyan as l,yellow as v,bold as y,green as m,gray as h}from"../ui/output.mjs";import"../cursorHooksInstall.mjs";import{refreshSecuritySensitiveCopies as q,hookVersionOf as w}from"../securityRefresh.mjs";import{updateProjectMcpJson as K,updateIdeMcpJson as G,updateClaudeDesktopPerProject as z,removeLegacyUserLevelEntry as x,claudeJsonPath as Q,claudeDesktopConfigPath as b,runningFromNpxCache as X}from"../mcpRegistration.mjs";import"../vsCodeCopilotHooksInstall.mjs";import{updateInjectionConfig as Y}from"../amp/io.mjs";import{findProjectRoot as Z}from"../projectRoot.mjs";import{refreshRuleFilesFromMemory as ee}from"../ruleFiles.mjs";import{injectionPatchFromArgs as oe}from"./refresh.mjs";const te=u.dirname(E(import.meta.url));function P(){return u.resolve(te,"../../templates")}function se(t){try{return N(`npx infernoflow ${t}`,{encoding:"utf8",cwd:process.cwd(),timeout:6e4,stdio:["inherit","pipe","pipe"]})}catch(n){return n.stdout||n.stderr||n.message}}function S(t){if(!d.existsSync(t))return{data:{},existed:!1,corrupt:!1,backup:null};let n;try{n=d.readFileSync(t,"utf8")}catch{return{data:{},existed:!0,corrupt:!1,backup:null}}try{const i=JSON.parse(n);return!i||typeof i!="object"||Array.isArray(i)?{data:{},existed:!0,corrupt:!1,backup:null}:{data:i,existed:!0,corrupt:!1,backup:null}}catch{let i=null;try{i=`${t}.corrupt-${Date.now()}.bak`,d.writeFileSync(i,n,"utf8")}catch{i=null}return{data:{},existed:!0,corrupt:!0,backup:i}}}function re(t){const n=u.join(t,".git","hooks","post-commit");if(!d.existsSync(n))return{installed:!1,removed:!1};try{const i=d.readFileSync(n,"utf8");if(!i.includes('infernoflow log "commit:'))return{installed:!1,removed:!1};const a=i.split(/\r?\n/).filter(r=>!r.includes('infernoflow log "commit:')&&!/^#\s*infernoflow(:| auto-capture)/.test(r.trim())&&!/^# Best-effort and non-blocking — never fails a commit\.$/.test(r.trim()));return a.filter(r=>r.trim()&&!r.startsWith("#!")).length?d.writeFileSync(n,a.join(`
`).replace(/\n*$/,`
`),"utf8"):d.unlinkSync(n),{installed:!1,removed:!0}}catch(i){return{installed:!1,removed:!1,error:i.message}}}const $=6,j=`#!/usr/bin/env node
// infernoflow UserPromptSubmit hook (Claude Code / Cursor).
// infernoflow-hook-version: ${$}
// Logs a best-effort 'attempt' entry when the user's prompt shows frustration,
// so the highest-value capture signal doesn't depend on the model remembering.
// 0.47.0: when the prompt asks to remember something, states a decision or a
// finding, it adds a one-line reminder to the agent's context (the prompt
// itself is not stored \u2014 the agent saves a summary if it is worth keeping).
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
const humanText = ${H.toString()};
const isFrustration = ${I.toString()};
const saveSignal = ${L.toString()};
// D14 (0.46.0): one entry per burst \u2014 a run of frustrated prompts within 10
// minutes is the same problem; the agent / memory-keeper writes the real lesson.
const STATE = join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".ai-memory", ".hook-state.json");
function readState() { try { return JSON.parse(readFileSync(STATE, "utf8")) || {}; } catch { return {}; } }
function writeState(patch) { try { writeFileSync(STATE, JSON.stringify({ ...readState(), ...patch })); } catch {} }
function recentlyLogged() { return Date.now() - (readState().lastFrustration || 0) < 10 * 60_000; }
const text = humanText(prompt);
const HINTS = {
  remember:  "The user asked to remember something in this prompt. Save it with the infernoflow amp_write tool: one clear sentence in your own words (type decision, gotcha or note \u2014 whichever fits), not a quote of the prompt.",
  decision:  "This prompt states a decision. Once it is settled, save it with the infernoflow amp_write tool, type decision: one sentence with the choice and the reason. Skip it if it is trivial or already saved.",
  discovery: "This prompt describes a finding. If it is non-obvious \u2014 something the next session could not re-derive from the code \u2014 save it with the infernoflow amp_write tool, type gotcha, one sentence (add file if it is about one file).",
};
const kind = text && existsSync(join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".ai-memory")) ? saveSignal(text) : null;
// An explicit "remember" always counts; decisions / findings remind at most once per 10 minutes each.
if (kind && (kind === "remember" || Date.now() - (readState()["lastHint_" + kind] || 0) >= 10 * 60_000)) {
  writeState({ ["lastHint_" + kind]: Date.now() });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "infernoflow: " + HINTS[kind] } }) + "\\n");
}
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
      if (r.status === 0) writeState({ lastFrustration: Date.now() });
    } catch {}
  }
}
process.exit(0);
`;function ne(t){const n=u.join(t,".claude","hooks"),i=u.join(n,"log-frustration.mjs");try{d.mkdirSync(n,{recursive:!0});let s=null;try{s=d.readFileSync(i,"utf8")}catch{}s&&w(s)>w(j)||d.writeFileSync(i,j,"utf8");try{d.chmodSync(i,493)}catch{}}catch(s){return{installed:!1,error:s.message}}const a=u.join(t,".claude","settings.json"),{data:o}=S(a);(!o.hooks||typeof o.hooks!="object")&&(o.hooks={}),Array.isArray(o.hooks.UserPromptSubmit)||(o.hooks.UserPromptSubmit=[]);const r="node .claude/hooks/log-frustration.mjs",p=o.hooks.UserPromptSubmit.some(s=>Array.isArray(s?.hooks)&&s.hooks.some(e=>typeof e?.command=="string"&&e.command.includes("log-frustration.mjs")));p||o.hooks.UserPromptSubmit.push({hooks:[{type:"command",command:r}]});try{d.mkdirSync(u.dirname(a),{recursive:!0}),d.writeFileSync(a,JSON.stringify(o,null,2),"utf8")}catch(s){return{installed:!0,registered:!1,error:s.message}}return{installed:!0,registered:!p}}const R=`#!/usr/bin/env node
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
`;function ie(t){const n=u.join(t,".claude","hooks"),i=u.join(n,"infernoflow-session.mjs");try{d.mkdirSync(n,{recursive:!0});let s=null;try{s=d.readFileSync(i,"utf8")}catch{}s&&w(s)>w(R)||d.writeFileSync(i,R,"utf8");try{d.chmodSync(i,493)}catch{}}catch(s){return{installed:!1,error:s.message}}const a=u.join(t,".claude","settings.json"),{data:o,corrupt:r}=S(a);if(r)return{installed:!0,registered:!1,error:"settings.json unreadable"};(!o.hooks||typeof o.hooks!="object")&&(o.hooks={});let p=!1;for(const[s,e]of[["SessionStart","start"],["SessionEnd","end"]])Array.isArray(o.hooks[s])||(o.hooks[s]=[]),o.hooks[s].some(f=>Array.isArray(f?.hooks)&&f.hooks.some(g=>typeof g?.command=="string"&&g.command.includes("infernoflow-session.mjs")))||(o.hooks[s].push({hooks:[{type:"command",command:`node .claude/hooks/infernoflow-session.mjs ${e}`}]}),p=!0);if(p)try{d.writeFileSync(a,JSON.stringify(o,null,2),"utf8")}catch(s){return{installed:!0,registered:!1,error:s.message}}return{installed:!0,registered:p}}const ae=["infernoflow_status","infernoflow_check","infernoflow_context","infernoflow_git_drift","amp_read","amp_write","amp_search","amp_bookmark","amp_handoff","amp_health","amp_resume"],O=["infernoflow_status","infernoflow_check","infernoflow_git_drift","amp_read","amp_search","amp_health","amp_resume"],ce=["infernoflow_check","infernoflow_context"],le=ae.filter(t=>!O.includes(t));function de(t,n){const i=u.join(t,".claude"),a=u.join(i,"settings.json"),{data:o}=S(a),r=f=>typeof f=="string"&&f.startsWith("mcp__infernoflow__"),p={...o};if(Array.isArray(o.allowedTools)){const f=o.allowedTools.filter(g=>!r(g));f.length?p.allowedTools=f:delete p.allowedTools}const s=o.permissions&&typeof o.permissions=="object"&&!Array.isArray(o.permissions)?{...o.permissions}:{},e=new Set(Array.isArray(s.allow)?s.allow:[]);for(const f of le)e.delete(`mcp__infernoflow__${f}`);e.delete("mcp__infernoflow__*");const c=d.existsSync(u.join(t,"inferno","contract.json"));for(const f of O)ce.includes(f)&&!c?e.delete(`mcp__infernoflow__${f}`):e.add(`mcp__infernoflow__${f}`);return s.allow=[...e],p.permissions=s,d.mkdirSync(i,{recursive:!0}),d.writeFileSync(a,JSON.stringify(p,null,2),"utf8"),a}function fe(t,{silent:n=!1}={}){const i=P(),a=n?()=>{}:e=>k(e),o=n?()=>{}:e=>V(e),r={mcpServer:!1,projectMcpJson:!1,claudeJson:!1,claudeSettings:!1,claudeDesktop:!1,gitHooks:!1,captureHook:!1,backups:[]},p=(()=>{try{return Z(t)}catch{return t}})();try{const e=q(t,{captureHookScript:j});e.length&&(r.securityRefreshed=e,e.some(c=>c.endsWith("inferno-mcp-server.mjs"))&&(r.mcpServer=!0),a("Security update: replaced outdated "+e.map(c=>l(c)).join(", ")))}catch{}X()&&o("infernoflow is running from the npx cache \u2014 MCP configs will point there and break when the cache is cleared. Install it: npm i -g infernoflow, then run: infernoflow setup --yes");let s=!1;try{const e=K(p);e.skipped==="tracked"?o(".mcp.json is tracked by git \u2014 not adding this machine's paths to it. Add the infernoflow server with: claude mcp add infernoflow -s local -- node <infernoflow>/bin/infernoflow.mjs mcp"):e.skipped?o(".mcp.json is unreadable \u2014 left unchanged"):(s=!0,e.updated&&(r.projectMcpJson=!0,a("Registered MCP server in "+l(".mcp.json")+h(" (Claude Code, this project only)"))),e.gitignored&&a("Added "+l(".mcp.json")+" to .gitignore (it holds this machine's paths)"))}catch(e){o(".mcp.json update skipped: "+e.message)}if(s)try{const e=x(Q());e.removed&&(r.legacyClaudeJsonRemoved=e,a("Removed the old user-level infernoflow entry from "+l("~/.claude.json")+h(` (was pinned to ${e.pinnedTo||"one project"}; backup: ${e.backup})`)))}catch(e){o("~/.claude.json cleanup skipped: "+e.message)}for(const[e,c]of[["vscode",".vscode/mcp.json"],["cursor",".cursor/mcp.json"]])try{const f=G(p,e);f.updated&&(r[e==="vscode"?"vscodeMcp":"cursorMcp"]=!0,a((f.migrated?"Rewrote the MCP entry in ":"Registered MCP server in ")+l(c)+h(" (no machine paths \u2014 safe to commit)")))}catch(f){o(c+" update skipped: "+f.message)}try{const e=z(p);if(e.updated&&(r.claudeDesktop=!0,a("Registered MCP server "+l(e.name)+" in "+l("claude_desktop_config.json")+h(" (Claude Desktop app)"))),!e.skipped){const c=x(b());c.removed&&(r.legacyDesktopRemoved=c,a("Removed the old pinned infernoflow entry from "+l("claude_desktop_config.json")+h(` (backup: ${c.backup})`)))}}catch(e){o("Claude Desktop config skipped: "+e.message)}try{de(t,!1),r.claudeSettings=!0,a("Pre-approved read-only infernoflow tools in "+l(".claude/settings.json")+" (memory writes still ask)")}catch(e){o(".claude/settings.json skipped: "+e.message)}try{re(t).removed&&(r.gitHookRemoved=!0,a("Removed the old commit-logging line from "+l(".git/hooks/post-commit")+h(" (git already keeps commit history)")))}catch(e){o("git hook install skipped: "+e.message)}try{ne(t).installed&&(r.captureHook=!0,a("Installed capture hook \u2192 "+l(".claude/hooks/log-frustration.mjs")))}catch(e){o("capture hook install skipped: "+e.message)}try{ie(t).registered&&(r.sessionHooks=!0,a("Installed session hooks \u2192 "+l(".claude/hooks/infernoflow-session.mjs")+h(" (fresh memory at start, resume point at end)")))}catch(e){o("session hooks skipped: "+e.message)}try{ee(t)}catch{}return r}async function $e(t){const n=process.cwd(),i=t.includes("--force")||t.includes("-f"),a=t.includes("--yes")||t.includes("-y"),o=P();W("infernoflow setup");const{ideDetected:r}=U("auto");C(`IDE detected: ${y(r==="cursor"?"Cursor":r==="vscode"?"VS Code":r==="windsurf"?"Windsurf":"unknown")}`);const s=u.join(n,".ai-memory");d.existsSync(s)?k(".ai-memory/ already exists \u2014 skipping init"):(console.log(`
  ${v(".ai-memory/")} not found \u2014 running init ...
`),se(a?"init --yes":"init"));const e=oe(t);if(Object.keys(e).length)try{Y(n,e),k("Injection config updated \u2192 "+JSON.stringify(e))}catch{}console.log(),C("Wiring up MCP servers for Cursor / VS Code Copilot / Claude Code ...");const c=fe(n,{silent:!1});console.log(),B("infernoflow ready"),console.log(`
  ${y("What was set up:")}`),console.log(`    ${m("\u2714")} MCP server \u2192 ${l("infernoflow mcp")} ${h("(runs from the installed package)")}`),c.projectMcpJson&&console.log(`    ${m("\u2714")} Claude Code MCP config \u2192 ${l(".mcp.json")} ${h("(this project)")}`),c.cursorMcp&&console.log(`    ${m("\u2714")} Cursor MCP config \u2192 ${l(".cursor/mcp.json")}`),c.vscodeMcp&&console.log(`    ${m("\u2714")} VS Code Copilot MCP config \u2192 ${l(".vscode/mcp.json")}`),c.legacyClaudeJsonRemoved&&console.log(`    ${m("\u2714")} Removed old pinned entry from ${l("~/.claude.json")} ${h("(backup saved)")}`),c.claudeSettings&&console.log(`    ${m("\u2714")} Read-only tools pre-approved \u2192 ${l(".claude/settings.json")}`),c.claudeDesktop&&console.log(`    ${m("\u2714")} Claude Desktop MCP config \u2192 ${l("claude_desktop_config.json")}`),c.gitHookRemoved&&console.log(`    ${m("\u2714")} Old commit-logging hook removed \u2192 ${l(".git/hooks/post-commit")}`),c.sessionHooks&&console.log(`    ${m("\u2714")} Session hooks (fresh memory at start, resume point at end) \u2192 ${l(".claude/hooks/infernoflow-session.mjs")}`),c.captureHook&&console.log(`    ${m("\u2714")} Capture hook (Claude Code/Cursor) \u2192 ${l(".claude/hooks/log-frustration.mjs")}`);try{const{detectStaleMcpRuntime:f}=await import("../mcpRuntime.mjs"),{readFileSync:g}=await import("node:fs"),{dirname:T,join:A}=await import("node:path"),{fileURLToPath:F}=await import("node:url"),D=T(F(import.meta.url)),M=A(D,"..","..","package.json"),J=JSON.parse(g(M,"utf8")).version,_=f(n,J);_&&(console.log(),console.log(`  ${v("\u26A0")} ${y("Restart required:")} ${_.message}`))}catch{}console.log(),console.log(`  ${y("Next step:")} Restart your AI tool. Test by asking:`),console.log(`    ${l('"call the amp_write tool with a test note"')}`),console.log()}export{j as CAPTURE_HOOK_SCRIPT,$ as CAPTURE_HOOK_VERSION,ce as MCP_CONTRACT_TOOLS,O as MCP_READ_TOOLS,ae as MCP_TOOLS,le as MCP_WRITE_TOOLS,R as SESSION_HOOK_SCRIPT,fe as autoSetupMcp,b as claudeDesktopConfigPath,ne as installClaudeCodeCaptureHook,ie as installClaudeSessionHooks,re as installGitHooks,$e as setupCommand,de as writeClaudeSettings};
