import*as l from"node:fs";import*as d from"node:path";import"node:os";import{fileURLToPath as F}from"node:url";import{execSync as J}from"node:child_process";import{detectIdeContext as H}from"../ai/ideDetection.mjs";import{header as O,ok as y,warn as I,info as w,done as L,cyan as i,yellow as j,bold as h,green as f,gray as m}from"../ui/output.mjs";import"../cursorHooksInstall.mjs";import{refreshSecuritySensitiveCopies as N}from"../securityRefresh.mjs";import{updateProjectMcpJson as T,updateIdeMcpJson as U,updateClaudeDesktopPerProject as E,removeLegacyUserLevelEntry as S,claudeJsonPath as V,claudeDesktopConfigPath as C,runningFromNpxCache as W}from"../mcpRegistration.mjs";import"../vsCodeCopilotHooksInstall.mjs";import{updateInjectionConfig as K}from"../amp/io.mjs";import{findProjectRoot as q}from"../projectRoot.mjs";import{injectionPatchFromArgs as B}from"./refresh.mjs";const G=d.dirname(F(import.meta.url));function v(){return d.resolve(G,"../../templates")}function z(n){try{return J(`npx infernoflow ${n}`,{encoding:"utf8",cwd:process.cwd(),timeout:6e4,stdio:["inherit","pipe","pipe"]})}catch(s){return s.stdout||s.stderr||s.message}}function b(n){if(!l.existsSync(n))return{data:{},existed:!1,corrupt:!1,backup:null};let s;try{s=l.readFileSync(n,"utf8")}catch{return{data:{},existed:!0,corrupt:!1,backup:null}}try{const c=JSON.parse(s);return!c||typeof c!="object"||Array.isArray(c)?{data:{},existed:!0,corrupt:!1,backup:null}:{data:c,existed:!0,corrupt:!1,backup:null}}catch{let c=null;try{c=`${n}.corrupt-${Date.now()}.bak`,l.writeFileSync(c,s,"utf8")}catch{c=null}return{data:{},existed:!0,corrupt:!0,backup:c}}}function Q(n){const s=d.join(n,".git");if(!l.existsSync(s))return{installed:!1,skipped:"not-a-git-repo"};const c=d.join(s,"hooks"),o=d.join(c,"post-commit"),r='infernoflow log "commit: $(git log -1 --pretty=%s)" --type note --source git-hook --auto --quiet >/dev/null 2>&1 || true';try{if(l.mkdirSync(c,{recursive:!0}),l.existsSync(o)){const t=l.readFileSync(o,"utf8");if(t.includes("infernoflow"))return{installed:!1,already:!0};const u=t.replace(/\s*$/,"")+`

# infernoflow auto-capture
`+r+`
`;l.writeFileSync(o,u,"utf8")}else{const t=["#!/bin/sh","# infernoflow: auto-capture the commit subject into session memory.","# Best-effort and non-blocking \u2014 never fails a commit.",r,""].join(`
`);l.writeFileSync(o,t,"utf8")}try{l.chmodSync(o,493)}catch{}return{installed:!0,path:o}}catch(t){return{installed:!1,error:t.message}}}const X=2,_=`#!/usr/bin/env node
// infernoflow UserPromptSubmit hook (Claude Code / Cursor).
// infernoflow-hook-version: ${X}
// Logs a best-effort 'attempt' entry when the user's prompt shows frustration,
// so the highest-value capture signal doesn't depend on the model remembering.
// Never blocks the prompt. Never uses a shell.
import { readFileSync, existsSync, realpathSync } from "node:fs";
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
    hits = execFileSync(finder, ["infernoflow"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 3000 })
      .split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean);
  } catch {}
  for (const c of hits) {
    try { const real = realpathSync(c); if (/\\.m?js$/i.test(real)) return real; } catch {}
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
if (prompt && MARKERS.some((re) => re.test(prompt))) {
  // Leading dashes are stripped so the text can never be read as a CLI flag.
  const msg = "User frustration: " + prompt.replace(/\\s+/g, " ").trim().replace(/^[\\s-]+/, "").slice(0, 120);
  const cli = findCliMjs();
  if (cli) {
    try {
      spawnSync(process.execPath, [cli, "log", msg, "--type", "attempt", "--result", "failed", "--auto", "--quiet", "--source", "hook"], {
        stdio: "ignore", timeout: 5000, windowsHide: true, shell: false,
      });
    } catch {}
  }
}
process.exit(0);
`;function Y(n){const s=d.join(n,".claude","hooks"),c=d.join(s,"log-frustration.mjs");try{l.mkdirSync(s,{recursive:!0}),l.writeFileSync(c,_,"utf8");try{l.chmodSync(c,493)}catch{}}catch(p){return{installed:!1,error:p.message}}const o=d.join(n,".claude","settings.json"),{data:r}=b(o);(!r.hooks||typeof r.hooks!="object")&&(r.hooks={}),Array.isArray(r.hooks.UserPromptSubmit)||(r.hooks.UserPromptSubmit=[]);const t="node .claude/hooks/log-frustration.mjs",u=r.hooks.UserPromptSubmit.some(p=>Array.isArray(p?.hooks)&&p.hooks.some(e=>typeof e?.command=="string"&&e.command.includes("log-frustration.mjs")));u||r.hooks.UserPromptSubmit.push({hooks:[{type:"command",command:t}]});try{l.mkdirSync(d.dirname(o),{recursive:!0}),l.writeFileSync(o,JSON.stringify(r,null,2),"utf8")}catch(p){return{installed:!0,registered:!1,error:p.message}}return{installed:!0,registered:!u}}const Z=["infernoflow_status","infernoflow_run","infernoflow_apply","infernoflow_check","infernoflow_context","infernoflow_implement","infernoflow_git_drift","infernoflow_scan_ui","infernoflow_review","amp_read","amp_write","amp_search","amp_handoff","amp_health"];function ee(n,s){const c=d.join(n,".claude"),o=d.join(c,"settings.json"),{data:r}=b(o),t=new Set(r.allowedTools||[]);for(const p of Z)t.add(`mcp__infernoflow__${p}`);const u={...r,allowedTools:[...t]};return l.mkdirSync(c,{recursive:!0}),l.writeFileSync(o,JSON.stringify(u,null,2),"utf8"),o}function oe(n,{silent:s=!1}={}){const c=v(),o=s?()=>{}:e=>y(e),r=s?()=>{}:e=>I(e),t={mcpServer:!1,projectMcpJson:!1,claudeJson:!1,claudeSettings:!1,claudeDesktop:!1,gitHooks:!1,captureHook:!1,backups:[]},u=(()=>{try{return q(n)}catch{return n}})();try{const e=N(n,{captureHookScript:_});e.length&&(t.securityRefreshed=e,e.some(a=>a.endsWith("inferno-mcp-server.mjs"))&&(t.mcpServer=!0),o("Security update: replaced outdated "+e.map(a=>i(a)).join(", ")))}catch{}W()&&r("infernoflow is running from the npx cache \u2014 MCP configs will point there and break when the cache is cleared. Install it: npm i -g infernoflow, then run: infernoflow setup --yes");let p=!1;try{const e=T(u);e.skipped==="tracked"?r(".mcp.json is tracked by git \u2014 not adding this machine's paths to it. Add the infernoflow server with: claude mcp add infernoflow -s local -- node <infernoflow>/bin/infernoflow.mjs mcp"):e.skipped?r(".mcp.json is unreadable \u2014 left unchanged"):(p=!0,e.updated&&(t.projectMcpJson=!0,o("Registered MCP server in "+i(".mcp.json")+m(" (Claude Code, this project only)"))),e.gitignored&&o("Added "+i(".mcp.json")+" to .gitignore (it holds this machine's paths)"))}catch(e){r(".mcp.json update skipped: "+e.message)}if(p)try{const e=S(V());e.removed&&(t.legacyClaudeJsonRemoved=e,o("Removed the old user-level infernoflow entry from "+i("~/.claude.json")+m(` (was pinned to ${e.pinnedTo||"one project"}; backup: ${e.backup})`)))}catch(e){r("~/.claude.json cleanup skipped: "+e.message)}for(const[e,a]of[["vscode",".vscode/mcp.json"],["cursor",".cursor/mcp.json"]])try{U(u,e).updated&&(t[e==="vscode"?"vscodeMcp":"cursorMcp"]=!0,o("Registered MCP server in "+i(a)))}catch(g){r(a+" update skipped: "+g.message)}try{const e=E(u);if(e.updated&&(t.claudeDesktop=!0,o("Registered MCP server "+i(e.name)+" in "+i("claude_desktop_config.json")+m(" (Claude Desktop app)"))),!e.skipped){const a=S(C());a.removed&&(t.legacyDesktopRemoved=a,o("Removed the old pinned infernoflow entry from "+i("claude_desktop_config.json")+m(` (backup: ${a.backup})`)))}}catch(e){r("Claude Desktop config skipped: "+e.message)}try{ee(n,!1),t.claudeSettings=!0,o("Pre-approved infernoflow tools in "+i(".claude/settings.json"))}catch(e){r(".claude/settings.json skipped: "+e.message)}try{Q(n).installed&&(t.gitHooks=!0,o("Installed git post-commit hook \u2192 "+i(".git/hooks/post-commit")))}catch(e){r("git hook install skipped: "+e.message)}try{Y(n).installed&&(t.captureHook=!0,o("Installed capture hook \u2192 "+i(".claude/hooks/log-frustration.mjs")))}catch(e){r("capture hook install skipped: "+e.message)}return t}async function he(n){const s=process.cwd(),c=n.includes("--force")||n.includes("-f"),o=n.includes("--yes")||n.includes("-y"),r=v();O("infernoflow setup");const{ideDetected:t}=H("auto");w(`IDE detected: ${h(t==="cursor"?"Cursor":t==="vscode"?"VS Code":t==="windsurf"?"Windsurf":"unknown")}`);const p=d.join(s,".ai-memory");l.existsSync(p)?y(".ai-memory/ already exists \u2014 skipping init"):(console.log(`
  ${j(".ai-memory/")} not found \u2014 running init ...
`),z(o?"init --yes":"init"));const e=B(n);if(Object.keys(e).length)try{K(s,e),y("Injection config updated \u2192 "+JSON.stringify(e))}catch{}console.log(),w("Wiring up MCP servers for Cursor / VS Code Copilot / Claude Code ...");const a=oe(s,{silent:!1});console.log(),L("infernoflow ready"),console.log(`
  ${h("What was set up:")}`),console.log(`    ${f("\u2714")} MCP server \u2192 ${i("infernoflow mcp")} ${m("(runs from the installed package)")}`),a.projectMcpJson&&console.log(`    ${f("\u2714")} Claude Code MCP config \u2192 ${i(".mcp.json")} ${m("(this project)")}`),a.cursorMcp&&console.log(`    ${f("\u2714")} Cursor MCP config \u2192 ${i(".cursor/mcp.json")}`),a.vscodeMcp&&console.log(`    ${f("\u2714")} VS Code Copilot MCP config \u2192 ${i(".vscode/mcp.json")}`),a.legacyClaudeJsonRemoved&&console.log(`    ${f("\u2714")} Removed old pinned entry from ${i("~/.claude.json")} ${m("(backup saved)")}`),a.claudeSettings&&console.log(`    ${f("\u2714")} Auto-approved tools \u2192 ${i(".claude/settings.json")}`),a.claudeDesktop&&console.log(`    ${f("\u2714")} Claude Desktop MCP config \u2192 ${i("claude_desktop_config.json")}`),a.gitHooks&&console.log(`    ${f("\u2714")} Git post-commit hook \u2192 ${i(".git/hooks/post-commit")}`),a.captureHook&&console.log(`    ${f("\u2714")} Capture hook (Claude Code/Cursor) \u2192 ${i(".claude/hooks/log-frustration.mjs")}`);try{const{detectStaleMcpRuntime:g}=await import("../mcpRuntime.mjs"),{readFileSync:$}=await import("node:fs"),{dirname:x,join:P}=await import("node:path"),{fileURLToPath:M}=await import("node:url"),R=x(M(import.meta.url)),A=P(R,"..","..","package.json"),D=JSON.parse($(A,"utf8")).version,k=g(s,D);k&&(console.log(),console.log(`  ${j("\u26A0")} ${h("Restart required:")} ${k.message}`))}catch{}console.log(),console.log(`  ${h("Next step:")} Restart your AI tool. Test by asking:`),console.log(`    ${i('"call the amp_write tool with a test note"')}`),console.log()}export{_ as CAPTURE_HOOK_SCRIPT,X as CAPTURE_HOOK_VERSION,Z as MCP_TOOLS,oe as autoSetupMcp,C as claudeDesktopConfigPath,Y as installClaudeCodeCaptureHook,Q as installGitHooks,he as setupCommand,ee as writeClaudeSettings};
