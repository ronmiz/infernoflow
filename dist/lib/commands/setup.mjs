import{humanText as L,isFrustration as N,saveSignal as U}from"../frustration.mjs";import*as l from"node:fs";import*as h from"node:path";import"node:os";import{fileURLToPath as W}from"node:url";import{spawnSync as V}from"node:child_process";import{detectIdeContext as B}from"../ai/ideDetection.mjs";import{header as q,ok as j,warn as G,info as P,done as K,cyan as f,yellow as _,bold as y,green as C,gray as u}from"../ui/output.mjs";import"../cursorHooksInstall.mjs";import{refreshSecuritySensitiveCopies as z,hookVersionOf as g}from"../securityRefresh.mjs";import{updateProjectMcpJson as Q,updateIdeMcpJson as X,updateCodexConfig as Y,updateClaudeDesktopPerProject as Z,removeLegacyUserLevelEntry as R,claudeJsonPath as ee,claudeDesktopConfigPath as T,runningFromNpxCache as te,cliEntryPath as oe}from"../mcpRegistration.mjs";import"../vsCodeCopilotHooksInstall.mjs";import{updateInjectionConfig as re}from"../amp/io.mjs";import{findProjectRoot as $}from"../projectRoot.mjs";import{refreshRuleFilesFromMemory as O}from"../ruleFiles.mjs";import{installPreCommitHook as se}from"../gitHooks.mjs";import{installStatus as ne}from"../installStatus.mjs";import{injectionPatchFromArgs as ie}from"./refresh.mjs";const ae=h.dirname(W(import.meta.url));function A(){return h.resolve(ae,"../../templates")}function ce(r){const i=V(process.execPath,[oe(),...r],{encoding:"utf8",cwd:process.cwd(),timeout:6e4,stdio:["inherit","pipe","pipe"],windowsHide:!0});return i.stdout||i.stderr||(i.error?i.error.message:"")}function v(r){if(!l.existsSync(r))return{data:{},existed:!1,corrupt:!1,backup:null};let i;try{i=l.readFileSync(r,"utf8")}catch{return{data:{},existed:!0,corrupt:!1,backup:null}}try{const a=JSON.parse(i);return!a||typeof a!="object"||Array.isArray(a)?{data:{},existed:!0,corrupt:!1,backup:null}:{data:a,existed:!0,corrupt:!1,backup:null}}catch{let a=null;try{a=`${r}.corrupt-${Date.now()}.bak`,l.writeFileSync(a,i,"utf8")}catch{a=null}return{data:{},existed:!0,corrupt:!0,backup:a}}}function le(r){const i=h.join(r,".git","hooks","post-commit");if(!l.existsSync(i))return{installed:!1,removed:!1};try{const a=l.readFileSync(i,"utf8");if(!a.includes('infernoflow log "commit:'))return{installed:!1,removed:!1};const m=a.split(/\r?\n/).filter(n=>!n.includes('infernoflow log "commit:')&&!/^#\s*infernoflow(:| auto-capture)/.test(n.trim())&&!/^# Best-effort and non-blocking — never fails a commit\.$/.test(n.trim()));return m.filter(n=>n.trim()&&!n.startsWith("#!")).length?l.writeFileSync(i,m.join(`
`).replace(/\n*$/,`
`),"utf8"):l.unlinkSync(i),{installed:!1,removed:!0}}catch(a){return{installed:!1,removed:!1,error:a.message}}}const F=6,x=`#!/usr/bin/env node
// infernoflow UserPromptSubmit hook (Claude Code / Cursor).
// infernoflow-hook-version: ${F}
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
const humanText = ${L.toString()};
const isFrustration = ${N.toString()};
const saveSignal = ${U.toString()};
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
`;function de(r){const i=h.join(r,".claude","hooks"),a=h.join(i,"log-frustration.mjs");try{l.mkdirSync(i,{recursive:!0});let o=null;try{o=l.readFileSync(a,"utf8")}catch{}o&&g(o)>g(x)||l.writeFileSync(a,x,"utf8");try{l.chmodSync(a,493)}catch{}}catch(o){return{installed:!1,error:o.message}}const m=h.join(r,".claude","settings.json"),{data:t}=v(m);(!t.hooks||typeof t.hooks!="object")&&(t.hooks={}),Array.isArray(t.hooks.UserPromptSubmit)||(t.hooks.UserPromptSubmit=[]);const n="node .claude/hooks/log-frustration.mjs",c=t.hooks.UserPromptSubmit.some(o=>Array.isArray(o?.hooks)&&o.hooks.some(p=>typeof p?.command=="string"&&p.command.includes("log-frustration.mjs")));c||t.hooks.UserPromptSubmit.push({hooks:[{type:"command",command:n}]});try{l.mkdirSync(h.dirname(m),{recursive:!0}),l.writeFileSync(m,JSON.stringify(t,null,2),"utf8")}catch(o){return{installed:!0,registered:!1,error:o.message}}return{installed:!0,registered:!c}}const D=`#!/usr/bin/env node
// infernoflow Claude Code session hook \u2014 usage: node infernoflow-session.mjs start|end
// infernoflow-hook-version: ${F}
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
`;function fe(r){const i=h.join(r,".claude","hooks"),a=h.join(i,"infernoflow-session.mjs");try{l.mkdirSync(i,{recursive:!0});let o=null;try{o=l.readFileSync(a,"utf8")}catch{}o&&g(o)>g(D)||l.writeFileSync(a,D,"utf8");try{l.chmodSync(a,493)}catch{}}catch(o){return{installed:!1,error:o.message}}const m=h.join(r,".claude","settings.json"),{data:t,corrupt:n}=v(m);if(n)return{installed:!0,registered:!1,error:"settings.json unreadable"};(!t.hooks||typeof t.hooks!="object")&&(t.hooks={});let c=!1;for(const[o,p]of[["SessionStart","start"],["SessionEnd","end"]])Array.isArray(t.hooks[o])||(t.hooks[o]=[]),t.hooks[o].some(s=>Array.isArray(s?.hooks)&&s.hooks.some(d=>typeof d?.command=="string"&&d.command.includes("infernoflow-session.mjs")))||(t.hooks[o].push({hooks:[{type:"command",command:`node .claude/hooks/infernoflow-session.mjs ${p}`}]}),c=!0);if(c)try{l.writeFileSync(m,JSON.stringify(t,null,2),"utf8")}catch(o){return{installed:!0,registered:!1,error:o.message}}return{installed:!0,registered:c}}const pe=["infernoflow_status","infernoflow_check","infernoflow_context","infernoflow_git_drift","amp_read","amp_write","amp_search","amp_bookmark","amp_handoff","amp_health","amp_resume"],M=["infernoflow_status","infernoflow_check","infernoflow_git_drift","amp_read","amp_search","amp_health","amp_resume"],me=["infernoflow_check","infernoflow_context"],ue=pe.filter(r=>!M.includes(r));function he(r,i){const a=h.join(r,".claude"),m=h.join(a,"settings.json"),{data:t}=v(m),n=s=>typeof s=="string"&&s.startsWith("mcp__infernoflow__"),c={...t};if(Array.isArray(t.allowedTools)){const s=t.allowedTools.filter(d=>!n(d));s.length?c.allowedTools=s:delete c.allowedTools}const o=t.permissions&&typeof t.permissions=="object"&&!Array.isArray(t.permissions)?{...t.permissions}:{},p=new Set(Array.isArray(o.allow)?o.allow:[]);for(const s of ue)p.delete(`mcp__infernoflow__${s}`);p.delete("mcp__infernoflow__*");const e=l.existsSync(h.join(r,"inferno","contract.json"));for(const s of M)me.includes(s)&&!e?p.delete(`mcp__infernoflow__${s}`):p.add(`mcp__infernoflow__${s}`);return o.allow=[...p],c.permissions=o,l.mkdirSync(a,{recursive:!0}),l.writeFileSync(m,JSON.stringify(c,null,2),"utf8"),m}function ye(r,{silent:i=!1,create:a=!1}={}){const m=A(),t=i?()=>{}:e=>j(e),n=i?()=>{}:e=>G(e),c={mcpServer:!1,projectMcpJson:!1,claudeJson:!1,claudeSettings:!1,claudeDesktop:!1,gitHooks:!1,captureHook:!1,backups:[]},o=(()=>{try{return $(r)}catch{return r}})();try{const e=z(r,{captureHookScript:x});e.length&&(c.securityRefreshed=e,e.some(s=>s.endsWith("inferno-mcp-server.mjs"))&&(c.mcpServer=!0),t("Security update: replaced outdated "+e.map(s=>f(s)).join(", ")))}catch{}te()&&n("infernoflow is running from the npx cache \u2014 MCP configs will point there and break when the cache is cleared. Install it: npm i -g infernoflow, then run: infernoflow setup --yes");let p=!1;try{const e=Q(o);e.skipped==="tracked"?n(".mcp.json is tracked by git \u2014 not adding this machine's paths to it. Add the infernoflow server with: claude mcp add infernoflow -s local -- node <infernoflow>/bin/infernoflow.mjs mcp"):e.skipped?n(".mcp.json is unreadable \u2014 left unchanged"):(p=!0,e.updated&&(c.projectMcpJson=!0,t("Registered MCP server in "+f(".mcp.json")+u(" (Claude Code, this project only)"))),e.gitignored&&t("Added "+f(".mcp.json")+" to .gitignore (it holds this machine's paths)"))}catch(e){n(".mcp.json update skipped: "+e.message)}if(p)try{const e=R(ee());e.removed&&(c.legacyClaudeJsonRemoved=e,t("Removed the old user-level infernoflow entry from "+f("~/.claude.json")+u(` (was pinned to ${e.pinnedTo||"one project"}; backup: ${e.backup})`)))}catch(e){n("~/.claude.json cleanup skipped: "+e.message)}for(const[e,s]of[["vscode",".vscode/mcp.json"],["cursor",".cursor/mcp.json"]])try{const d=X(o,e);d.updated&&(c[e==="vscode"?"vscodeMcp":"cursorMcp"]=!0,t((d.migrated?"Rewrote the MCP entry in ":"Registered MCP server in ")+f(s)+u(" (no machine paths \u2014 safe to commit)")))}catch(d){n(s+" update skipped: "+d.message)}try{const e=Y(o,{create:a});if(e.updated){c.codexConfig=!0,t((e.created?"Registered MCP server in ":"Updated the MCP entry in ")+f(".codex/config.toml")+u(" (Codex CLI; trust the project in Codex once so it loads this file)"));const s=h.join(o,"AGENTS.md");if(e.created&&!l.existsSync(s)){l.writeFileSync(s,"","utf8");try{O(o)}catch{}if(l.existsSync(s)&&l.readFileSync(s,"utf8").trim())c.agentsMd=!0,t("Created "+f("AGENTS.md")+u(" (Codex reads it; holds the memory block)"));else try{l.unlinkSync(s)}catch{}}}}catch(e){n(".codex/config.toml update skipped: "+e.message)}try{const e=Z(o);if(e.updated&&(c.claudeDesktop=!0,t("Registered MCP server "+f(e.name)+" in "+f("claude_desktop_config.json")+u(" (Claude Desktop app)"))),!e.skipped){const s=R(T());s.removed&&(c.legacyDesktopRemoved=s,t("Removed the old pinned infernoflow entry from "+f("claude_desktop_config.json")+u(` (backup: ${s.backup})`)))}}catch(e){n("Claude Desktop config skipped: "+e.message)}try{he(r,!1),c.claudeSettings=!0,t("Pre-approved read-only infernoflow tools in "+f(".claude/settings.json")+" (memory writes still ask)")}catch(e){n(".claude/settings.json skipped: "+e.message)}try{le(r).removed&&(c.gitHookRemoved=!0,t("Removed the old commit-logging line from "+f(".git/hooks/post-commit")+u(" (git already keeps commit history)")))}catch(e){n("git hook install skipped: "+e.message)}if(a)try{const e=se(o);e.installed?(c.preCommit=!0,t("Installed git pre-commit note \u2192 "+f(".git/hooks/pre-commit")+u(" (lists memory about the files you commit; never blocks)"))):e.skipped==="hooksPath"&&n("git uses a custom hooks folder (core.hooksPath) \u2014 add this line to your pre-commit hook to see memory about committed files: infernoflow hook pre-commit || true")}catch(e){n("pre-commit hook skipped: "+e.message)}try{de(r).installed&&(c.captureHook=!0,t("Installed capture hook \u2192 "+f(".claude/hooks/log-frustration.mjs")))}catch(e){n("capture hook install skipped: "+e.message)}try{fe(r).registered&&(c.sessionHooks=!0,t("Installed session hooks \u2192 "+f(".claude/hooks/infernoflow-session.mjs")+u(" (fresh memory at start, resume point at end)")))}catch(e){n("session hooks skipped: "+e.message)}try{O(r)}catch{}return c}async function Me(r){const i=process.cwd(),a=r.includes("--force")||r.includes("-f"),m=r.includes("--yes")||r.includes("-y"),t=A();q("infernoflow setup");const{ideDetected:n}=B("auto");P(`IDE detected: ${y(n==="cursor"?"Cursor":n==="vscode"?"VS Code":n==="windsurf"?"Windsurf":"unknown")}`);const o=h.join(i,".ai-memory");l.existsSync(o)?j(".ai-memory/ already exists \u2014 skipping init"):(console.log(`
  ${_(".ai-memory/")} not found \u2014 running init ...
`),ce(m?["init","--yes"]:["init"]));const p=ie(r);if(Object.keys(p).length)try{re(i,p),j("Injection config updated \u2192 "+JSON.stringify(p))}catch{}console.log(),P("Wiring up MCP servers for Cursor / VS Code Copilot / Claude Code ...");const e=ye(i,{silent:!1,create:!0});console.log(),K("infernoflow ready");const s=(()=>{try{return $(i)}catch{return i}})();console.log(`
  ${y("Installed in this project:")}`);for(const d of ne(s)){const w=d.state==="ok"?C("\u2714"):d.state==="skipped"?u("\xB7"):_("\u2716"),k=d.where&&d.state==="ok"?` \u2192 ${f(d.where)}`:"",S=d.note?` ${u("("+d.note+")")}`:"";console.log(`    ${w} ${d.state==="ok"?d.label:u(d.label)}${k}${S}`)}e.legacyClaudeJsonRemoved&&console.log(`    ${C("\u2714")} Removed old pinned entry from ${f("~/.claude.json")} ${u("(backup saved)")}`),e.gitHookRemoved&&console.log(`    ${C("\u2714")} Old commit-logging hook removed \u2192 ${f(".git/hooks/post-commit")}`),console.log(`    ${u("MCP server for all of them:")} ${f("infernoflow mcp")} ${u("(runs from the installed package)")}`);try{const{detectStaleMcpRuntime:d}=await import("../mcpRuntime.mjs"),{readFileSync:w}=await import("node:fs"),{dirname:k,join:S}=await import("node:path"),{fileURLToPath:I}=await import("node:url"),E=k(I(import.meta.url)),H=S(E,"..","..","package.json"),J=JSON.parse(w(H,"utf8")).version,b=d(i,J);b&&(console.log(),console.log(`  ${_("\u26A0")} ${y("Restart required:")} ${b.message}`))}catch{}console.log(),console.log(`  ${y("Next step:")} Restart your AI tool. Test by asking:`),console.log(`    ${f('"call the amp_write tool with a test note"')}`),console.log()}export{x as CAPTURE_HOOK_SCRIPT,F as CAPTURE_HOOK_VERSION,me as MCP_CONTRACT_TOOLS,M as MCP_READ_TOOLS,pe as MCP_TOOLS,ue as MCP_WRITE_TOOLS,D as SESSION_HOOK_SCRIPT,ye as autoSetupMcp,T as claudeDesktopConfigPath,de as installClaudeCodeCaptureHook,fe as installClaudeSessionHooks,le as installGitHooks,Me as setupCommand,he as writeClaudeSettings};
