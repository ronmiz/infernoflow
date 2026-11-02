import{humanText as H,isFrustration as I,saveSignal as L}from"../frustration.mjs";import*as l from"node:fs";import*as u from"node:path";import"node:os";import{fileURLToPath as N}from"node:url";import{execSync as U}from"node:child_process";import{detectIdeContext as W}from"../ai/ideDetection.mjs";import{header as V,ok as k,warn as B,info as _,done as G,cyan as d,yellow as v,bold as y,green as g,gray as m}from"../ui/output.mjs";import"../cursorHooksInstall.mjs";import{refreshSecuritySensitiveCopies as q,hookVersionOf as w}from"../securityRefresh.mjs";import{updateProjectMcpJson as K,updateIdeMcpJson as z,updateCodexConfig as Q,updateClaudeDesktopPerProject as X,removeLegacyUserLevelEntry as x,claudeJsonPath as Y,claudeDesktopConfigPath as b,runningFromNpxCache as Z}from"../mcpRegistration.mjs";import"../vsCodeCopilotHooksInstall.mjs";import{updateInjectionConfig as ee}from"../amp/io.mjs";import{findProjectRoot as oe}from"../projectRoot.mjs";import{refreshRuleFilesFromMemory as P}from"../ruleFiles.mjs";import{injectionPatchFromArgs as te}from"./refresh.mjs";const re=u.dirname(N(import.meta.url));function $(){return u.resolve(re,"../../templates")}function se(r){try{return U(`npx infernoflow ${r}`,{encoding:"utf8",cwd:process.cwd(),timeout:6e4,stdio:["inherit","pipe","pipe"]})}catch(c){return c.stdout||c.stderr||c.message}}function S(r){if(!l.existsSync(r))return{data:{},existed:!1,corrupt:!1,backup:null};let c;try{c=l.readFileSync(r,"utf8")}catch{return{data:{},existed:!0,corrupt:!1,backup:null}}try{const i=JSON.parse(c);return!i||typeof i!="object"||Array.isArray(i)?{data:{},existed:!0,corrupt:!1,backup:null}:{data:i,existed:!0,corrupt:!1,backup:null}}catch{let i=null;try{i=`${r}.corrupt-${Date.now()}.bak`,l.writeFileSync(i,c,"utf8")}catch{i=null}return{data:{},existed:!0,corrupt:!0,backup:i}}}function ne(r){const c=u.join(r,".git","hooks","post-commit");if(!l.existsSync(c))return{installed:!1,removed:!1};try{const i=l.readFileSync(c,"utf8");if(!i.includes('infernoflow log "commit:'))return{installed:!1,removed:!1};const p=i.split(/\r?\n/).filter(n=>!n.includes('infernoflow log "commit:')&&!/^#\s*infernoflow(:| auto-capture)/.test(n.trim())&&!/^# Best-effort and non-blocking — never fails a commit\.$/.test(n.trim()));return p.filter(n=>n.trim()&&!n.startsWith("#!")).length?l.writeFileSync(c,p.join(`
`).replace(/\n*$/,`
`),"utf8"):l.unlinkSync(c),{installed:!1,removed:!0}}catch(i){return{installed:!1,removed:!1,error:i.message}}}const R=6,j=`#!/usr/bin/env node
// infernoflow UserPromptSubmit hook (Claude Code / Cursor).
// infernoflow-hook-version: ${R}
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
`;function ie(r){const c=u.join(r,".claude","hooks"),i=u.join(c,"log-frustration.mjs");try{l.mkdirSync(c,{recursive:!0});let t=null;try{t=l.readFileSync(i,"utf8")}catch{}t&&w(t)>w(j)||l.writeFileSync(i,j,"utf8");try{l.chmodSync(i,493)}catch{}}catch(t){return{installed:!1,error:t.message}}const p=u.join(r,".claude","settings.json"),{data:o}=S(p);(!o.hooks||typeof o.hooks!="object")&&(o.hooks={}),Array.isArray(o.hooks.UserPromptSubmit)||(o.hooks.UserPromptSubmit=[]);const n="node .claude/hooks/log-frustration.mjs",a=o.hooks.UserPromptSubmit.some(t=>Array.isArray(t?.hooks)&&t.hooks.some(f=>typeof f?.command=="string"&&f.command.includes("log-frustration.mjs")));a||o.hooks.UserPromptSubmit.push({hooks:[{type:"command",command:n}]});try{l.mkdirSync(u.dirname(p),{recursive:!0}),l.writeFileSync(p,JSON.stringify(o,null,2),"utf8")}catch(t){return{installed:!0,registered:!1,error:t.message}}return{installed:!0,registered:!a}}const T=`#!/usr/bin/env node
// infernoflow Claude Code session hook \u2014 usage: node infernoflow-session.mjs start|end
// infernoflow-hook-version: ${R}
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
`;function ce(r){const c=u.join(r,".claude","hooks"),i=u.join(c,"infernoflow-session.mjs");try{l.mkdirSync(c,{recursive:!0});let t=null;try{t=l.readFileSync(i,"utf8")}catch{}t&&w(t)>w(T)||l.writeFileSync(i,T,"utf8");try{l.chmodSync(i,493)}catch{}}catch(t){return{installed:!1,error:t.message}}const p=u.join(r,".claude","settings.json"),{data:o,corrupt:n}=S(p);if(n)return{installed:!0,registered:!1,error:"settings.json unreadable"};(!o.hooks||typeof o.hooks!="object")&&(o.hooks={});let a=!1;for(const[t,f]of[["SessionStart","start"],["SessionEnd","end"]])Array.isArray(o.hooks[t])||(o.hooks[t]=[]),o.hooks[t].some(s=>Array.isArray(s?.hooks)&&s.hooks.some(h=>typeof h?.command=="string"&&h.command.includes("infernoflow-session.mjs")))||(o.hooks[t].push({hooks:[{type:"command",command:`node .claude/hooks/infernoflow-session.mjs ${f}`}]}),a=!0);if(a)try{l.writeFileSync(p,JSON.stringify(o,null,2),"utf8")}catch(t){return{installed:!0,registered:!1,error:t.message}}return{installed:!0,registered:a}}const ae=["infernoflow_status","infernoflow_check","infernoflow_context","infernoflow_git_drift","amp_read","amp_write","amp_search","amp_bookmark","amp_handoff","amp_health","amp_resume"],O=["infernoflow_status","infernoflow_check","infernoflow_git_drift","amp_read","amp_search","amp_health","amp_resume"],le=["infernoflow_check","infernoflow_context"],de=ae.filter(r=>!O.includes(r));function fe(r,c){const i=u.join(r,".claude"),p=u.join(i,"settings.json"),{data:o}=S(p),n=s=>typeof s=="string"&&s.startsWith("mcp__infernoflow__"),a={...o};if(Array.isArray(o.allowedTools)){const s=o.allowedTools.filter(h=>!n(h));s.length?a.allowedTools=s:delete a.allowedTools}const t=o.permissions&&typeof o.permissions=="object"&&!Array.isArray(o.permissions)?{...o.permissions}:{},f=new Set(Array.isArray(t.allow)?t.allow:[]);for(const s of de)f.delete(`mcp__infernoflow__${s}`);f.delete("mcp__infernoflow__*");const e=l.existsSync(u.join(r,"inferno","contract.json"));for(const s of O)le.includes(s)&&!e?f.delete(`mcp__infernoflow__${s}`):f.add(`mcp__infernoflow__${s}`);return t.allow=[...f],a.permissions=t,l.mkdirSync(i,{recursive:!0}),l.writeFileSync(p,JSON.stringify(a,null,2),"utf8"),p}function pe(r,{silent:c=!1,create:i=!1}={}){const p=$(),o=c?()=>{}:e=>k(e),n=c?()=>{}:e=>B(e),a={mcpServer:!1,projectMcpJson:!1,claudeJson:!1,claudeSettings:!1,claudeDesktop:!1,gitHooks:!1,captureHook:!1,backups:[]},t=(()=>{try{return oe(r)}catch{return r}})();try{const e=q(r,{captureHookScript:j});e.length&&(a.securityRefreshed=e,e.some(s=>s.endsWith("inferno-mcp-server.mjs"))&&(a.mcpServer=!0),o("Security update: replaced outdated "+e.map(s=>d(s)).join(", ")))}catch{}Z()&&n("infernoflow is running from the npx cache \u2014 MCP configs will point there and break when the cache is cleared. Install it: npm i -g infernoflow, then run: infernoflow setup --yes");let f=!1;try{const e=K(t);e.skipped==="tracked"?n(".mcp.json is tracked by git \u2014 not adding this machine's paths to it. Add the infernoflow server with: claude mcp add infernoflow -s local -- node <infernoflow>/bin/infernoflow.mjs mcp"):e.skipped?n(".mcp.json is unreadable \u2014 left unchanged"):(f=!0,e.updated&&(a.projectMcpJson=!0,o("Registered MCP server in "+d(".mcp.json")+m(" (Claude Code, this project only)"))),e.gitignored&&o("Added "+d(".mcp.json")+" to .gitignore (it holds this machine's paths)"))}catch(e){n(".mcp.json update skipped: "+e.message)}if(f)try{const e=x(Y());e.removed&&(a.legacyClaudeJsonRemoved=e,o("Removed the old user-level infernoflow entry from "+d("~/.claude.json")+m(` (was pinned to ${e.pinnedTo||"one project"}; backup: ${e.backup})`)))}catch(e){n("~/.claude.json cleanup skipped: "+e.message)}for(const[e,s]of[["vscode",".vscode/mcp.json"],["cursor",".cursor/mcp.json"]])try{const h=z(t,e);h.updated&&(a[e==="vscode"?"vscodeMcp":"cursorMcp"]=!0,o((h.migrated?"Rewrote the MCP entry in ":"Registered MCP server in ")+d(s)+m(" (no machine paths \u2014 safe to commit)")))}catch(h){n(s+" update skipped: "+h.message)}try{const e=Q(t,{create:i});if(e.updated){a.codexConfig=!0,o((e.created?"Registered MCP server in ":"Updated the MCP entry in ")+d(".codex/config.toml")+m(" (Codex CLI; trust the project in Codex once so it loads this file)"));const s=u.join(t,"AGENTS.md");if(e.created&&!l.existsSync(s)){l.writeFileSync(s,"","utf8");try{P(t)}catch{}if(l.existsSync(s)&&l.readFileSync(s,"utf8").trim())a.agentsMd=!0,o("Created "+d("AGENTS.md")+m(" (Codex reads it; holds the memory block)"));else try{l.unlinkSync(s)}catch{}}}}catch(e){n(".codex/config.toml update skipped: "+e.message)}try{const e=X(t);if(e.updated&&(a.claudeDesktop=!0,o("Registered MCP server "+d(e.name)+" in "+d("claude_desktop_config.json")+m(" (Claude Desktop app)"))),!e.skipped){const s=x(b());s.removed&&(a.legacyDesktopRemoved=s,o("Removed the old pinned infernoflow entry from "+d("claude_desktop_config.json")+m(` (backup: ${s.backup})`)))}}catch(e){n("Claude Desktop config skipped: "+e.message)}try{fe(r,!1),a.claudeSettings=!0,o("Pre-approved read-only infernoflow tools in "+d(".claude/settings.json")+" (memory writes still ask)")}catch(e){n(".claude/settings.json skipped: "+e.message)}try{ne(r).removed&&(a.gitHookRemoved=!0,o("Removed the old commit-logging line from "+d(".git/hooks/post-commit")+m(" (git already keeps commit history)")))}catch(e){n("git hook install skipped: "+e.message)}try{ie(r).installed&&(a.captureHook=!0,o("Installed capture hook \u2192 "+d(".claude/hooks/log-frustration.mjs")))}catch(e){n("capture hook install skipped: "+e.message)}try{ce(r).registered&&(a.sessionHooks=!0,o("Installed session hooks \u2192 "+d(".claude/hooks/infernoflow-session.mjs")+m(" (fresh memory at start, resume point at end)")))}catch(e){n("session hooks skipped: "+e.message)}try{P(r)}catch{}return a}async function Re(r){const c=process.cwd(),i=r.includes("--force")||r.includes("-f"),p=r.includes("--yes")||r.includes("-y"),o=$();V("infernoflow setup");const{ideDetected:n}=W("auto");_(`IDE detected: ${y(n==="cursor"?"Cursor":n==="vscode"?"VS Code":n==="windsurf"?"Windsurf":"unknown")}`);const t=u.join(c,".ai-memory");l.existsSync(t)?k(".ai-memory/ already exists \u2014 skipping init"):(console.log(`
  ${v(".ai-memory/")} not found \u2014 running init ...
`),se(p?"init --yes":"init"));const f=te(r);if(Object.keys(f).length)try{ee(c,f),k("Injection config updated \u2192 "+JSON.stringify(f))}catch{}console.log(),_("Wiring up MCP servers for Cursor / VS Code Copilot / Claude Code ...");const e=pe(c,{silent:!1,create:!0});console.log(),G("infernoflow ready"),console.log(`
  ${y("What was set up:")}`),console.log(`    ${g("\u2714")} MCP server \u2192 ${d("infernoflow mcp")} ${m("(runs from the installed package)")}`),e.projectMcpJson&&console.log(`    ${g("\u2714")} Claude Code MCP config \u2192 ${d(".mcp.json")} ${m("(this project)")}`),e.cursorMcp&&console.log(`    ${g("\u2714")} Cursor MCP config \u2192 ${d(".cursor/mcp.json")}`),e.codexConfig&&console.log(`    ${g("\u2714")} Codex MCP config \u2192 ${d(".codex/config.toml")}${e.agentsMd?` + ${d("AGENTS.md")}`:""} ${m("(trust the project in Codex once)")}`),e.vscodeMcp&&console.log(`    ${g("\u2714")} VS Code Copilot MCP config \u2192 ${d(".vscode/mcp.json")}`),e.legacyClaudeJsonRemoved&&console.log(`    ${g("\u2714")} Removed old pinned entry from ${d("~/.claude.json")} ${m("(backup saved)")}`),e.claudeSettings&&console.log(`    ${g("\u2714")} Read-only tools pre-approved \u2192 ${d(".claude/settings.json")}`),e.claudeDesktop&&console.log(`    ${g("\u2714")} Claude Desktop MCP config \u2192 ${d("claude_desktop_config.json")}`),e.gitHookRemoved&&console.log(`    ${g("\u2714")} Old commit-logging hook removed \u2192 ${d(".git/hooks/post-commit")}`),e.sessionHooks&&console.log(`    ${g("\u2714")} Session hooks (fresh memory at start, resume point at end) \u2192 ${d(".claude/hooks/infernoflow-session.mjs")}`),e.captureHook&&console.log(`    ${g("\u2714")} Capture hook (Claude Code/Cursor) \u2192 ${d(".claude/hooks/log-frustration.mjs")}`);try{const{detectStaleMcpRuntime:s}=await import("../mcpRuntime.mjs"),{readFileSync:h}=await import("node:fs"),{dirname:A,join:M}=await import("node:path"),{fileURLToPath:F}=await import("node:url"),D=A(F(import.meta.url)),E=M(D,"..","..","package.json"),J=JSON.parse(h(E,"utf8")).version,C=s(c,J);C&&(console.log(),console.log(`  ${v("\u26A0")} ${y("Restart required:")} ${C.message}`))}catch{}console.log(),console.log(`  ${y("Next step:")} Restart your AI tool. Test by asking:`),console.log(`    ${d('"call the amp_write tool with a test note"')}`),console.log()}export{j as CAPTURE_HOOK_SCRIPT,R as CAPTURE_HOOK_VERSION,le as MCP_CONTRACT_TOOLS,O as MCP_READ_TOOLS,ae as MCP_TOOLS,de as MCP_WRITE_TOOLS,T as SESSION_HOOK_SCRIPT,pe as autoSetupMcp,b as claudeDesktopConfigPath,ie as installClaudeCodeCaptureHook,ce as installClaudeSessionHooks,ne as installGitHooks,Re as setupCommand,fe as writeClaudeSettings};
