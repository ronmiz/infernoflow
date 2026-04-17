#!/usr/bin/env node
import{readFileSync as d}from"node:fs";import{dirname as m,join as f}from"node:path";import{fileURLToPath as u}from"node:url";import{bold as e,gray as t,red as r}from"../lib/ui/output.mjs";const h=m(u(import.meta.url)),y=JSON.parse(d(f(h,"..","package.json"),"utf8")),i=y.version||"0.0.0",s={init:"Scaffold inferno/ in your project (or adopt existing project)","install-cursor-hooks":"Install Cursor hooks: draft agent replies to inferno/CONTEXT.draft.md","install-vscode-copilot-hooks":"Install VS Code + Copilot agent hooks (Preview): draft to inferno/CONTEXT.draft.md",check:"Validate contract, capabilities, scenarios, changelog",status:"Show contract health at a glance","pr-impact":"Summarize PR impact on capabilities and docs",sync:"Run deterministic inferno sync flow",run:"One-command detect/propose/apply/validate flow","doc-gate":"Fail if code changed but docs were not updated",suggest:"Generate AI prompt + apply capability updates",implement:"Generate code-agent implementation prompt(s)",context:"Generate AI-ready context for new sessions"},c={init:async o=>(await import("../lib/commands/init.mjs")).initCommand(o),"install-cursor-hooks":async o=>(await import("../lib/commands/installCursorHooks.mjs")).installCursorHooksCommand(o),"install-vscode-copilot-hooks":async o=>(await import("../lib/commands/installVsCodeCopilotHooks.mjs")).installVsCodeCopilotHooksCommand(o),check:async o=>(await import("../lib/commands/check.mjs")).checkCommand(o),status:async o=>(await import("../lib/commands/status.mjs")).statusCommand(o),"pr-impact":async o=>(await import("../lib/commands/prImpact.mjs")).prImpactCommand(o),sync:async o=>(await import("../lib/commands/syncAuto.mjs")).syncCommand(o),run:async o=>(await import("../lib/commands/run.mjs")).runCommand(o),suggest:async o=>(await import("../lib/commands/suggest.mjs")).suggestCommand(o),implement:async o=>(await import("../lib/commands/implement.mjs")).implementCommand(o),context:async o=>(await import("../lib/commands/context.mjs")).contextCommand(o),"doc-gate":async o=>(await import("../lib/commands/docGate.mjs")).docGateCommand(o)};function g(){const o=Object.keys(s),l=Math.max(...o.map(a=>a.length),8)+1;return Object.entries(s).map(([a,p])=>`    ${a.padEnd(l," ")}${p}`).join(`
`)}const w=`
  ${e("\u{1F525} infernoflow")} ${t("v"+i)}
  ${t("The forge for liquid code \u2014 keep every AI session in sync")}

  ${e("Usage:")}
    infernoflow <command> [options]

  ${e("Commands:")}
${g()}

  ${e("init options:")}
    --cursor-hooks           Also install Cursor hooks (draft \u2192 inferno/CONTEXT.draft.md)
    --vscode-copilot-hooks   Also install VS Code + Copilot hooks (.github/hooks \u2014 Preview)
    --adopt             Infer capabilities from an existing codebase
    --lang <name>       Override detected language (e.g. ts, js, py)
    --framework <name>  Override detected framework (e.g. react, angular, express)
    --project-type <t>  Override project type (frontend|backend|fullstack|cli|library)
    --report-json       Print inferred adoption report as JSON
    --report-json-only  Print JSON report only (no human-readable logs)
    --report-human-only Print only human-readable adoption report (no JSON block)
    --yes, -y           Skip prompts and accept inferred/default values
    --force, -f         Overwrite existing inferno/ files

  ${e("install-cursor-hooks options:")}
    --force, -f         Overwrite .cursor/hooks.json and hook scripts if they exist

  ${e("install-vscode-copilot-hooks options:")}
    --force, -f         Overwrite .github/hooks/infernoflow-drafts.json and scripts if they exist

  ${e("context options:")}
    --intent  "..."     What you plan to build next
    --working "..."     What you are building right now
    --decision "..."    Record a decision or note
    --show              Print context without writing file
    --copy, -c          Copy context to clipboard instantly
    --reset             Clear all stored state

  ${e("implement options:")}
    --mode <type>       cursor | generic | both (default: both)
    --copy, -c          Copy generated prompt(s) to clipboard

  ${e("run options:")}
    --dry-run           Execute full flow without writing files
    --json              Emit machine-readable events and result payload
    --no-rollback       Keep changes even if validation fails
    --provider <type>   auto | agent | local | prompt (default: auto)
    --ide <name>        auto | cursor | vscode | windsurf (default: auto)

  ${e("Typical workflow:")}
    ${t('1. infernoflow context --intent "what I want to build"')}
    ${t("2. [paste inferno/CONTEXT.md into Claude / Cursor / Copilot]")}
    ${t("3. [build the feature]")}
    ${t('4. infernoflow suggest "what I built"')}
    ${t("5. infernoflow check")}

  ${e("Machine output:")}
    ${t("status --json")}
    ${t("check --json")}
    ${t("doc-gate --json")}
    ${t("pr-impact --json")}
    ${t("sync --auto --json")}
    ${t('run "task" --json')}
`,[,,n,...k]=process.argv;(!n||n==="--help"||n==="-h")&&(console.log(w),process.exit(0)),(n==="--version"||n==="-v")&&(console.log(i),process.exit(0));const C=Object.keys(c);C.includes(n)||(console.error(r(`
Unknown command: ${n}`)),console.error(t(`Run: infernoflow --help
`)),process.exit(1));const b=[n,...k];c[n](b).catch(o=>{console.error(r(`
Error: `)+o.message),process.exit(1)});
