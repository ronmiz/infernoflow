import*as I from"node:fs";import*as $ from"node:path";import{execSync as P}from"node:child_process";import{bold as h,cyan as S,gray as c,green as E,yellow as y,red as x}from"../ui/output.mjs";function N(e,o){try{return P(e,{cwd:o,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim()}catch{return""}}function C(e){try{return JSON.parse(I.readFileSync(e,"utf8"))}catch{return null}}function w(e){return e.replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase().split(/[\s_\-/.]+/).filter(o=>o.length>2)}function _(e,o){const t=e.toLowerCase(),s=new Set;for(const n of o){const i=[...w(n.id||""),...w(n.name||""),...(n.tags||[]).flatMap(w)];if(t.includes((n.id||"").toLowerCase())){s.add(n.id);continue}i.filter(p=>p.length>3&&t.includes(p)).length>=2&&s.add(n.id)}return[...s]}function j(e,o=8e3){if(e.length<=o)return e;const t=Math.floor(o/2);return e.slice(0,t)+`

[\u2026 diff truncated \u2026]

`+e.slice(-t)}function O(e,o,t){const s=t.filter(i=>o.includes(i.id)).map(i=>`  \u2022 ${i.id}: ${i.name}${i.description?" \u2014 "+i.description:""}`).join(`
`);return`You are a senior software architect reviewing a code change for capability drift.

${o.length>0?`Affected capabilities detected:
${s}`:"No specific capabilities were matched \u2014 review the entire contract."}

Git diff:
\`\`\`diff
${j(e)}
\`\`\`

Write a concise capability impact summary covering:
1. Which capabilities are changed, added, or removed
2. Whether the contract (capabilities.json) needs updating
3. Any risks or side-effects (breaking changes, auth/security concerns, API contract violations)
4. Recommended follow-up actions (one sentence each)

Keep the tone professional and brief. Use bullet points only where genuinely helpful.
Do NOT repeat the diff back.`}function R(e,o,t,s){if(console.log(),console.log(h(S("  \u2726 Capability Impact Review"))),console.log(c(`  Source: ${s}`)),console.log(),e.length===0)console.log(y("  No capabilities directly matched \u2014 reviewing full diff."));else{console.log(h("  Affected capabilities:"));for(const n of e){const i=t.find(l=>l.id===n);console.log(`    ${E("\u25B8")} ${n}${i?c(" \u2014 "+i.name):""}`)}}console.log(),console.log(h("  AI Impact Summary")),console.log(c("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));for(const n of o.split(`
`))console.log("  "+n);console.log()}async function L(e){const o=e||[],t=o.includes("--dry-run"),s=o.includes("--json"),n=o.includes("--unstaged"),i=o.includes("--last"),l=process.cwd(),p=$.join(l,"inferno"),b=$.join(p,"capabilities.json");I.existsSync(b)||(console.error(x("\u2717 inferno/capabilities.json not found \u2014 run `infernoflow init` first.")),process.exit(1));const f=C(b);(!Array.isArray(f)||f.length===0)&&(console.log(y("No capabilities found \u2014 nothing to review.")),process.exit(0));let g,a;i?(g="git diff HEAD~1",a="last commit (HEAD~1)"):n?(g="git diff",a="unstaged changes"):(g="git diff --staged",a="staged changes");let d=N(g,l);!d&&!i&&!n&&(d=N("git diff",l),a="unstaged changes (no staged changes found)"),d||(console.log(y("No changes found to review.")),console.log(c("  Tip: stage some files first (`git add -p`) or use --last / --unstaged")),process.exit(0));const u=_(d,f),A=O(d,u,f);t&&(console.log(c("\u2500\u2500 Prompt (--dry-run) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")),console.log(A),process.exit(0)),s||process.stdout.write(c("  Calling AI provider\u2026"));let r=null;try{const{callAI:m}=await import("../ai/providerRouter.mjs");r=await m(A,{cwd:l,maxTokens:600})}catch{}if(s||process.stdout.write("\r"+" ".repeat(30)+"\r"),!r){console.log(),console.log(y("  \u26A0  No AI provider available.")),console.log(c("  Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY,")),console.log(c("  or run Ollama locally. See `infernoflow doctor` for details.")),console.log(),console.log(h("  Affected capabilities (unanswered):"));for(const m of u)console.log(`    \u25B8 ${m}`);console.log(),process.exit(0)}const v=r.text||"(empty response)";s?console.log(JSON.stringify({source:a,provider:r.provider,model:r.model,affectedCapabilities:u,summary:v},null,2)):(R(u,v,f,a),console.log(c(`  Provider: ${r.provider}  Model: ${r.model}`)),console.log())}export{L as reviewCommand};
