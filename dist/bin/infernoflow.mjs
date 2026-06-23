#!/usr/bin/env node
(function(){if(process.platform!=="win32"||process.env.WT_SESSION||process.env.ConEmuPID||process.env.TERM_PROGRAM==="vscode")return;const s={"\u2500":"-","\u2501":"-","\u2550":"=","\u2502":"|","\u2503":"|","\u2551":"|","\u250C":"+","\u2510":"+","\u2514":"+","\u2518":"+","\u251C":"+","\u2524":"+","\u252C":"+","\u2534":"+","\u253C":"+","\xB7":"*","\u2192":"->","\u2190":"<-","\u2714":"[OK]","\u2713":"[OK]","\u2718":"[X]","\u2717":"[X]","\u26A0":"[!]",\u2139:"[i]"},r=new RegExp(Object.keys(s).join("|"),"g"),l=/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{200D}]\u{FE0F}? ?/gu,f=c=>c.replace(r,p=>s[p]).replace(l,"");function u(c){const p=c.write.bind(c);c.write=function(a,...C){return typeof a=="string"?a=f(a):Buffer.isBuffer(a)&&(a=Buffer.from(f(a.toString("utf8")),"utf8")),p(a,...C)}}u(process.stdout),u(process.stderr)})();import{readFileSync as $}from"node:fs";import{dirname as k,join as y}from"node:path";import{fileURLToPath as v}from"node:url";import{bold as i,gray as e,cyan as t,red as g}from"../lib/ui/output.mjs";const A=k(v(import.meta.url));function I(o){for(const s of[y(o,"..","..","package.json"),y(o,"..","package.json")])try{return JSON.parse($(s,"utf8"))}catch{}return{version:"0.0.0-source"}}const M=I(A),m=M.version||"0.0.0",h={log:"Append to session memory (decisions, gotchas, failed attempts)",ask:"Query memory by keyword (gotchas surface first)",switch:"Generate a handoff doc for the next AI agent / session",recap:"End-of-session summary + health score + unlogged-change surfacing",status:"Quick health check \u2014 entries, gotchas, decisions, last activity",refresh:"Rebuild CLAUDE.md / .cursorrules / copilot-instructions.md from memory",forget:"Delete a memory entry by id or unique prefix (--last for the newest)",prune:"Archive stale notes/attempts (gotchas/decisions never touched) \u2014 see --apply",init:"Scaffold .ai-memory/ and wire the current IDE in one command",setup:"Re-run wiring (idempotent) \u2014 detects IDE, installs MCP + hooks",doctor:"Diagnose your setup \u2014 Node, git, contract, AI provider, MCP, hooks",context:"Generate AI-ready context for new sessions","install-cursor-hooks":"Install Cursor hooks (afterAgentResponse + stop)","install-vscode-copilot-hooks":"Install VS Code + Copilot agent hooks (Preview)","generate-skills":"Generate Cursor rules + skill files from your developer profile",ai:"Manage AI providers \u2014 setup, status, test, clear",telemetry:"Opt-in anonymous telemetry (on | off | status)",uninstall:"Remove infernoflow from a project (--dry-run to preview)",check:"Validate contract, capabilities, scenarios, changelog",sync:"Cross-machine sync for personal memory \u2014 status/set/clear/migrate",amp:"AI Memory Protocol \u2014 status, migrate, validate (run: infernoflow amp)"},d={log:async o=>(await import("../lib/commands/log.mjs")).logCommand(o),ask:async o=>(await import("../lib/commands/ask.mjs")).askCommand(o),switch:async o=>(await import("../lib/commands/switch.mjs")).switchCommand(o),recap:async o=>(await import("../lib/commands/recap.mjs")).recapCommand(o),status:async o=>(await import("../lib/commands/status.mjs")).statusCommand(o),refresh:async o=>(await import("../lib/commands/refresh.mjs")).refreshCommand(o),forget:async o=>(await import("../lib/commands/forget.mjs")).forgetCommand(o),prune:async o=>(await import("../lib/commands/prune.mjs")).pruneCommand(o),init:async o=>(await import("../lib/commands/init.mjs")).initCommand(o),setup:async o=>(await import("../lib/commands/setup.mjs")).setupCommand(o),doctor:async o=>(await import("../lib/commands/doctor.mjs")).doctorCommand(o),context:async o=>(await import("../lib/commands/context.mjs")).contextCommand(o),"install-cursor-hooks":async o=>(await import("../lib/commands/installCursorHooks.mjs")).installCursorHooksCommand(o),"install-vscode-copilot-hooks":async o=>(await import("../lib/commands/installVsCodeCopilotHooks.mjs")).installVsCodeCopilotHooksCommand(o),"generate-skills":async o=>(await import("../lib/commands/generateSkills.mjs")).generateSkillsCommand(o),ai:async o=>(await import("../lib/commands/ai.mjs")).aiCommand(o),telemetry:async o=>(await import("../lib/telemetry.mjs")).telemetryCommand(o),uninstall:async o=>(await import("../lib/commands/uninstall.mjs")).uninstallCommand(o),check:async o=>(await import("../lib/commands/check.mjs")).checkCommand(o),sync:async o=>(await import("../lib/commands/sync.mjs")).syncCommand(o),amp:async o=>(await import("../lib/commands/amp.mjs")).ampCommand(o)};function G(){const o=Object.keys(h),s=Math.max(...o.map(r=>r.length),8)+1;return Object.entries(h).map(([r,l])=>`    ${r.padEnd(s," ")}${l}`).join(`
`)}const O={"Memory (the 5-command core)":["log","ask","switch","recap","status","refresh","forget","prune"],Setup:["init","setup","doctor","context"],"IDE wiring":["install-cursor-hooks","install-vscode-copilot-hooks","generate-skills"],Configuration:["ai","telemetry","sync","uninstall"],Contract:["check"],"AMP (use: infernoflow amp <verb>)":["status","migrate","validate","version"]};function b(){return Object.entries(O).map(([o,s])=>`  ${i(o+":")}
    ${s.join("  ")}`).join(`

`)}const w=Object.keys(d).length,E=`
  ${i("\u{1F525} infernoflow")} ${e("v"+m)}
  ${e("Persistent memory for AI coding sessions")}

  ${i("Usage:")}
    infernoflow [command] [options]

  ${i("Memory")} ${e("\u2014 the 5-command core")}
    ${t("log")} ${e('"..."')}         Add to session memory ${e("(--type gotcha|decision|attempt)")}
    ${t("ask")} ${e('"..."')}         Search your memory by keyword ${e("(gotchas surface first)")}
    ${t("switch")}            Generate handoff for next AI agent
    ${t("recap")}             End-of-session health score + unlogged changes
    ${t("status")}            Quick health check

  ${i("Setup")}
    ${t("init")}              60-second setup ${e("(memory mode by default)")}
    ${t("setup")}             Re-run IDE wiring ${e("(idempotent \u2014 MCP + hooks)")}
    ${t("doctor")}            Diagnose your setup
    ${t("context")}           Generate AI-ready context for new sessions

  ${i("Subsystems")} ${e("\u2014 grouped, run for verbs:")}
    ${t("amp")}               AI Memory Protocol ${e("(status, migrate, validate)")}

  ${e("Run")} ${t("infernoflow commands")} ${e("to see all "+w+" commands grouped.")}
  ${e("Run")} ${t("infernoflow <command> --help")} ${e("for command-specific options.")}
`;import*as R from"node:fs";import*as S from"node:path";try{const o=S.join(process.cwd(),"inferno");if(R.existsSync(o)){const{observeCommandStart:s}=await import("../lib/learning/observe.mjs"),r=process.argv[2];r&&!r.startsWith("-")&&s(o,r)}}catch{}const[,,n,...x]=process.argv;(!n||n==="--help"||n==="-h")&&(console.log(E),process.exit(0)),(n==="--version"||n==="-v")&&(console.log(m),process.exit(0)),n==="commands"&&(console.log(`
  ${i("\u{1F525} infernoflow")} ${e("v"+m)} ${e("\u2014 all "+w+" commands")}
`),console.log(b()),console.log(`
  ${e("Run")} ${t("infernoflow <command> --help")} ${e("for options.")}
`),process.exit(0));const D=Object.keys(d);D.includes(n)||(console.error(g(`
Unknown command: ${n}`)),console.error(e("Run: infernoflow commands  (see all commands)")),console.error(e(`Run: infernoflow --help    (quick start)
`)),process.exit(1));const P=[n,...x];try{const{runUpgradeBackfillIfNeeded:o}=await import("../lib/upgradeCheck.mjs");await o(m,n)}catch{}d[n](P).catch(o=>{console.error(g(`
Error: `)+o.message),process.exit(1)});
