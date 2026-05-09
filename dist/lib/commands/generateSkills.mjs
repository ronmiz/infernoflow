import*as l from"node:fs";import*as s from"node:path";import{readProfile as k}from"../learning/profile.mjs";import{header as y,ok as w,warn as b,done as $,nextSteps as C,cyan as m,yellow as j}from"../ui/output.mjs";const p=s.join("inferno","generated-skills");function f(e,n,i){return l.existsSync(e)&&!i?(b(`Already exists (use --force to overwrite): ${s.relative(process.cwd(),e)}`),!1):(l.mkdirSync(s.dirname(e),{recursive:!0}),l.writeFileSync(e,n,"utf8"),w(`Generated: ${s.relative(process.cwd(),e)}`),!0)}function S(e,n){const i=e.namingStyle!=="unknown"?e.namingStyle:"PascalCase",r=e.preferredVerbs.length>0?e.preferredVerbs.slice(0,5).join(", "):"Add, Update, Remove",t=e.stack?.framework||"unknown",o=e.featureClusters.slice(0,3),a=e.sessionCount>=20?"experienced":e.sessionCount>=5?"intermediate":"new",c=o.map(u=>`- When touching [${u.slice(0,3).join(", ")}], check whether related capabilities also need updating`).join(`
`);return`# infernoflow \u2014 Cursor Rules (auto-generated)
# Project: ${n?.policyId||"unknown"} | Stack: ${t}
# Regenerate with: infernoflow generate-skills --cursor

## Contract awareness
- This project uses infernoflow to track capability contracts
- After implementing any feature, always call \`infernoflow_run\` then \`infernoflow_apply\`
- Run \`infernoflow_check\` before every commit
- Current capabilities: [${(n?.capabilities||[]).join(", ")}]

## Naming conventions (detected from this developer's history)
- Capability IDs use **${i}** (e.g. ${r.split(", ").slice(0,2).map(u=>u+"Item").join(", ")})
- Preferred action verbs: ${r}
- Match this style when suggesting new capability names

## Feature clusters (capabilities this developer adds together)
${c||"- No clusters detected yet \u2014 build more features to train this"}

## Session style (${a})
${a==="experienced"?`- Skip basic explanations \u2014 this developer knows the codebase well
- Be direct and minimal in responses`:`- Include brief context for non-obvious decisions
- Explain infernoflow commands when used`}

## Workflow reminders
- Start sessions with: \`infernoflow context --show\`
- Use \`infernoflow_git_drift\` to check what's changed before starting work
- Use \`infernoflow_implement\` to get a structured coding prompt before writing code
- Changelog entries should be ${e.changelogVerbosity==="detailed"?"detailed (include context and impact)":"brief (one line, action-focused)"}
`}function R(e,n){const r=e.stack?.framework||"unknown",t=(n?.capabilities||[]).slice(0,6);return`# Quick Restore \u2014 ${n?.policyId||"this project"}
# Paste this at the start of any new AI session to restore context instantly.
# Regenerate with: infernoflow generate-skills

## Project snapshot
- **Project:** ${n?.policyId||"unknown"}
- **Stack:** ${r} / ${e.stack?.language||"unknown"} (${e.stack?.projectType||"unknown"})
- **Capabilities:** ${t.join(", ")}${(n?.capabilities||[]).length>6?` +${(n?.capabilities||[]).length-6} more`:""}

## How to start a session
1. Run: \`infernoflow context --show\`
2. Check \`inferno/CONTEXT.md\` for current intent
3. Run: \`infernoflow_git_drift\` to see what changed since last session
4. Pick up where you left off

## infernoflow tools available (in Cursor / VS Code Agent mode)
- \`infernoflow_run\` \u2014 generate a contract update prompt
- \`infernoflow_apply\` \u2014 apply a JSON response
- \`infernoflow_implement\` \u2014 get a structured coding prompt
- \`infernoflow_git_drift\` \u2014 see what capabilities may have drifted
- \`infernoflow_check\` \u2014 validate contract is in sync
- \`infernoflow_status\` \u2014 quick health check

## Definition of done (every feature branch)
- [ ] Code works as intended
- [ ] \`infernoflow_run\` \u2192 \`infernoflow_apply\` completed
- [ ] \`infernoflow_check\` passes
- [ ] Commit message references the capability changed
`}function _(e){const n=e.namingStyle!=="unknown"?e.namingStyle:"PascalCase",i=e.preferredVerbs.length>0?e.preferredVerbs:["Create","Read","Update","Delete","Search"],r=i.slice(0,5).map(t=>n==="PascalCase"?`  - ${t}Item, ${t}Task, ${t}User`:n==="camelCase"?`  - ${t.toLowerCase()}Item, ${t.toLowerCase()}Task`:`  - ${t.toLowerCase()}-item, ${t.toLowerCase()}-task`).join(`
`);return`# Naming Guide \u2014 auto-generated from your capability history

## Detected style: ${n}

### Your preferred action verbs
${i.map(t=>`- **${t}**`).join(`
`)}

### Examples matching your style
${r}

### Rules
- All capability IDs in \`inferno/contract.json\` must follow this style
- New capabilities suggested by AI should match \u2014 reject any that don't
- If you rename a capability, update contract.json + capabilities.json + any scenarios

### When naming a new capability, ask:
1. Does it describe a single, discrete behavior? (If not, split it)
2. Does it start with one of your preferred verbs?
3. Is it in ${n}?
4. Is it unique \u2014 not already in contract.json?
`}function I(e,n){const r=e.featureClusters.slice(0,2)[0]||[],t=e.stack?.framework||"unknown",o=r.slice(0,4).map(a=>`- [ ] Does **${a}** need updating? (check inferno/capabilities.json)`).join(`
`);return`# Feature Scaffold \u2014 ${t} project
# Use this checklist whenever starting a new feature.
# Regenerate with: infernoflow generate-skills

## Before you start
- [ ] Run \`infernoflow context --show\` to load current state
- [ ] Run \`infernoflow_git_drift\` to see any pending drift
- [ ] Set intent: \`infernoflow context --intent "what I'm building"\`

## Implementation checklist
- [ ] Create feature branch
- [ ] Implement the feature
- [ ] Write / update tests
- [ ] Verify it works end-to-end

## Capability cluster check
${o||"- [ ] Review existing capabilities \u2014 do any need updating?"}

## Contract update (required before merge)
- [ ] Run \`infernoflow_run\` with a description of what changed
- [ ] Review the suggested JSON
- [ ] Run \`infernoflow_apply\` with the JSON
- [ ] Run \`infernoflow_check\` \u2014 must pass

## Commit message
- Reference the capability: "feat: add SearchItems endpoint (#42)"
- Update CHANGELOG.md if not auto-updated

## Done when
- [ ] Feature works
- [ ] \`infernoflow_check\` passes
- [ ] PR description mentions which capabilities changed
`}async function A(e){const n=process.cwd(),i=e.includes("--force")||e.includes("-f"),r=e.includes("--cursor");y("generate-skills");const t=s.join(n,"inferno");l.existsSync(t)||(console.error(`  \u2718 inferno/ not found \u2014 run: infernoflow init
`),process.exit(1));const o=k(t);let a=null;try{a=JSON.parse(l.readFileSync(s.join(t,"contract.json"),"utf8"))}catch{}const c=s.join(n,p);if(f(s.join(c,"cursor-rules.md"),S(o,a),i),f(s.join(c,"quick-restore.md"),R(o,a),i),f(s.join(c,"naming-guide.md"),_(o),i),f(s.join(c,"feature-scaffold.md"),I(o,a),i),r){const d=s.join(n,".cursor","rules");l.mkdirSync(d,{recursive:!0});const h=s.join(c,"cursor-rules.md"),g=s.join(d,"infernoflow.md");l.copyFileSync(h,g),w("Installed to: .cursor/rules/infernoflow.md")}const u=[o.namingStyle!=="unknown"?`naming: ${o.namingStyle}`:null,o.stack?.framework!=="unknown"?`stack: ${o.stack.framework}`:null,o.sessionCount>0?`sessions: ${o.sessionCount}`:null].filter(Boolean).join(" \xB7 ");$(`Skills generated${u?` (${u})`:""}`),C([`Review files in ${j(p+"/")}`,`Copy to Cursor: ${m("infernoflow generate-skills --cursor")}`,`Re-run any time to refresh after more sessions: ${m("infernoflow generate-skills --force")}`,o.sessionCount<5?`Run more commands to improve personalisation (${o.sessionCount} sessions so far)`:`Profile has ${o.sessionCount} sessions \u2014 personalisation is well-trained`])}export{A as generateSkillsCommand};
