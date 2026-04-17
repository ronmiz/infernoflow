import*as c from"node:fs";import*as l from"node:path";import*as J from"node:readline";import{header as V,ok as E,warn as F,info as U,done as R,section as D,nextSteps as W,bold as H,cyan as C,gray as A,yellow as Y,green as L,red as G,errorAndExit as I}from"../ui/output.mjs";function v(n){try{return JSON.parse(c.readFileSync(n,"utf8"))}catch{return null}}function T(n,e){return new Promise(i=>{n.question(e,d=>i(d.trim()))})}function q(n){return n.replace(/[-_]+/g," ").split(" ").map(e=>e.charAt(0).toUpperCase()+e.slice(1).toLowerCase()).join("")}function z({description:n,contract:e,capabilities:i,scenarios:d}){const g=e.capabilities||[],f=(i?.capabilities||[]).map(u=>`  - ${u.id}: ${u.title||u.id}`).join(`
`),s=d.map(u=>{const w=(u.capabilitiesCovered||[]).join(", "),y=(u.steps||[]).map(h=>`      {action: "${h.action}", expect: "${h.expect}"}`).join(`
`);return`  File: ${u._file}
  capabilitiesCovered: [${w}]
  steps:
${y}`}).join(`

`);return`You are a developer assistant for the infernoflow CLI tool.

Your job is to analyze a code change description and suggest updates to the infernoflow contract files.

## Current contract state

policyId: ${e.policyId}
policyVersion: ${e.policyVersion}
capabilities: [${g.join(", ")}]

## Current capabilities registry
${f||"  (none)"}

## Current scenarios
${s||"  (none)"}

## Developer's description of what changed
"${n}"

## Your task

Respond with ONLY a valid JSON object (no markdown, no explanation) in this exact format:

{
  "summary": "one-line summary of what changed",
  "newCapabilities": [
    { "id": "CapabilityName", "title": "Human readable title", "reason": "why this is a new capability" }
  ],
  "removedCapabilities": ["CapabilityId"],
  "updatedScenarios": [
    {
      "file": "existing_scenario_filename.json or new_scenario_name.json",
      "isNew": false,
      "capabilitiesCovered": ["CapabilityId1", "CapabilityId2"],
      "stepsToAdd": [
        { "action": "CapabilityId", "expect": "what should happen" }
      ]
    }
  ],
  "changelogEntry": "- Short description of the change for CHANGELOG.md"
}

Rules:
- Only suggest capabilities that are genuinely new behaviors the system gains
- Capability IDs must be PascalCase (e.g. SendEmail, not send_email)
- If nothing changed capability-wise, return empty arrays
- changelogEntry should start with "- "
- Keep it minimal and accurate`}function M(n){const e=[];if(!n||typeof n!="object")return["AI response must be a JSON object."];n.summary!=null&&typeof n.summary!="string"&&e.push('"summary" must be a string.'),Array.isArray(n.newCapabilities)||e.push('"newCapabilities" must be an array.'),Array.isArray(n.removedCapabilities)||e.push('"removedCapabilities" must be an array.'),Array.isArray(n.updatedScenarios)||e.push('"updatedScenarios" must be an array.'),n.changelogEntry!=null&&typeof n.changelogEntry!="string"&&e.push('"changelogEntry" must be a string.');for(const i of n.newCapabilities||[]){if(!i||typeof i!="object"){e.push('Each item in "newCapabilities" must be an object.');continue}(typeof i.id!="string"||!/^[A-Z][A-Za-z0-9]*$/.test(i.id))&&e.push("newCapabilities[].id must be PascalCase (example: SendEmail)."),(typeof i.title!="string"||!i.title.trim())&&e.push("newCapabilities[].title must be a non-empty string.")}for(const i of n.removedCapabilities||[])(typeof i!="string"||!i.trim())&&e.push("removedCapabilities[] must contain non-empty strings.");for(const i of n.updatedScenarios||[]){if(!i||typeof i!="object"){e.push('Each item in "updatedScenarios" must be an object.');continue}(typeof i.file!="string"||!i.file.endsWith(".json"))&&e.push("updatedScenarios[].file must be a .json filename."),typeof i.isNew!="boolean"&&e.push("updatedScenarios[].isNew must be boolean."),(!Array.isArray(i.capabilitiesCovered)||!Array.isArray(i.stepsToAdd))&&e.push("updatedScenarios[].capabilitiesCovered and stepsToAdd must be arrays.")}return e}function Z(n,e){const i=[],d=new Set(n.capabilities||[]),g=new Set((e.newCapabilities||[]).map(s=>s.id)),f=new Set(e.removedCapabilities||[]);for(const s of g)f.has(s)&&i.push(`Capability "${s}" appears in both newCapabilities and removedCapabilities.`),d.has(s)&&i.push(`Capability "${s}" already exists in contract capabilities.`);for(const s of f)d.has(s)||i.push(`Capability "${s}" cannot be removed because it does not exist in contract.`);return i}function K({cwd:n,contract:e,capabilities:i,suggestion:d,version:g,quiet:f=!1}){const s=l.join(n,"inferno"),u=l.join(s,"contract.json"),w=l.join(s,"capabilities.json"),y=l.join(s,"CHANGELOG.md"),h=l.join(s,"scenarios"),m=d.newCapabilities||[],S=d.removedCapabilities||[],k=d.updatedScenarios||[],P=d.changelogEntry||"";let $=!1;const N=[],p=(t,o)=>N.push({filePath:t,content:o});if(m.length>0||S.length>0){const t=[...e.capabilities.filter(b=>!S.includes(b)),...m.map(b=>b.id)],o=Number(e.policyVersion||1)+1,r={...e,capabilities:t,policyVersion:o};p(u,JSON.stringify(r,null,2)+`
`),f||E(`contract.json updated \u2192 policyVersion: v${o}`),$=!0}if(m.length>0||S.length>0){const t=i?{...i}:{schemaVersion:1,capabilities:[]};t.capabilities=(t.capabilities||[]).filter(o=>!S.includes(o.id));for(const o of m)t.capabilities.find(r=>r.id===o.id)||t.capabilities.push({id:o.id,title:o.title,since:g});p(w,JSON.stringify(t,null,2)+`
`),f||E("capabilities.json updated")}for(const t of k){const o=l.join(h,t.file);let r;if(t.isNew||!c.existsSync(o))r={scenarioId:t.file.replace(".json",""),description:d.summary||"",capabilitiesCovered:t.capabilitiesCovered||[],steps:t.stepsToAdd||[]},p(o,JSON.stringify(r,null,2)+`
`),f||E(`Created scenario: ${C(t.file)}`);else{r=v(o);const b=new Set(r.capabilitiesCovered||[]);(t.capabilitiesCovered||[]).forEach(O=>b.add(O)),r.capabilitiesCovered=[...b],r.steps=[...r.steps||[],...t.stepsToAdd||[]],p(o,JSON.stringify(r,null,2)+`
`),f||E(`Updated scenario: ${C(t.file)}`)}$=!0}if(P&&c.existsSync(y)){let t=c.readFileSync(y,"utf8");/##\s+Unreleased/i.test(t)&&(t=t.replace(/(##\s+Unreleased[^\n]*\n)/i,`$1
${P}
`),p(y,t),f||E("CHANGELOG.md updated"),$=!0)}const x=new Map;try{for(const t of N){c.existsSync(t.filePath)?x.set(t.filePath,c.readFileSync(t.filePath,"utf8")):x.set(t.filePath,null);const o=`${t.filePath}.tmp`;c.writeFileSync(o,t.content),c.renameSync(o,t.filePath)}}catch(t){for(const[o,r]of x.entries())r===null?c.existsSync(o)&&c.unlinkSync(o):c.writeFileSync(o,r);throw new Error(`Failed applying changes. Rolled back. Details: ${t.message}`)}return $}function B(n){const e=String(n||"").trim().replace(/^```json?\n?/,"").replace(/\n?```$/,"");return JSON.parse(e)}function ee(n){const e=l.join(n,"inferno"),i=l.join(e,"contract.json"),d=l.join(e,"capabilities.json"),g=l.join(e,"scenarios"),f=v(i),s=v(d),u=[];if(c.existsSync(g))for(const h of c.readdirSync(g).filter(m=>m.endsWith(".json"))){const m=v(l.join(g,h));m&&u.push({...m,_file:h})}let w="0.1.0";const y=l.join(n,"package.json");if(c.existsSync(y)){const h=v(y);h?.version&&(w=h.version)}return{contract:f,capabilities:s,scenarios:u,version:w}}async function te(n){const e=process.cwd(),i=l.join(e,"inferno");V("suggest"),c.existsSync(i)||I("inferno/ not found","Run: infernoflow init");const d=l.join(i,"contract.json"),g=l.join(i,"capabilities.json"),f=l.join(i,"scenarios"),s=v(d);s||I("contract.json not found or invalid");const u=v(g),w=[];if(c.existsSync(f))for(const a of c.readdirSync(f).filter(j=>j.endsWith(".json"))){const j=v(l.join(f,a));j&&w.push({...j,_file:a})}let y="0.1.0";const h=l.join(e,"package.json");if(c.existsSync(h)){const a=v(h);a?.version&&(y=a.version)}let S=n.filter(a=>!a.startsWith("-")).slice(1).join(" ");if(!S){const a=J.createInterface({input:process.stdin,output:process.stdout});console.log(A("  Describe what changed in your code (e.g. 'added email notifications'):")),S=await T(a,`  ${C(">")} `),a.close(),console.log()}S||I("No description provided",'Usage: infernoflow suggest "what changed"');const k=z({description:S,contract:s,capabilities:u,scenarios:w});D("Generated Prompt"),console.log(),console.log(A("\u2500".repeat(50))),console.log(k),console.log(A("\u2500".repeat(50))),console.log(),U("Copy the prompt above and paste it into:"),console.log(`  ${C("\u2022")} Claude  \u2192 https://claude.ai`),console.log(`  ${C("\u2022")} ChatGPT \u2192 https://chatgpt.com`),console.log(`  ${C("\u2022")} Copilot, Cursor, or any AI you use`),console.log(),F("The AI will respond with a JSON object."),console.log();const P=J.createInterface({input:process.stdin,output:process.stdout});console.log(A("  Paste the AI's JSON response below, then press Enter twice:")),console.log();let $="",N=0;await new Promise(a=>{P.on("line",j=>{j.trim()===""?(N++,N>=2&&$.trim()&&a()):(N=0,$+=j+`
`)}),P.on("close",a)}),P.close();let p;try{p=B($)}catch{I("Could not parse the AI response as JSON","Make sure you copied the full JSON response from the AI")}const x=M(p);x.length>0&&I("AI response schema is invalid",x[0]+(x.length>1?` (+${x.length-1} more)`:""));const t=Z(s,p);t.length>0&&I("AI response contains conflicting capability operations",t[0]+(t.length>1?` (+${t.length-1} more)`:"")),D("Proposed Changes"),console.log(),p.summary&&(console.log(`  ${H("Summary:")} ${p.summary}`),console.log());const o=p.newCapabilities||[],r=p.removedCapabilities||[],b=p.updatedScenarios||[];o.length===0&&r.length===0&&b.length===0&&(E("No capability changes detected \u2014 nothing to apply."),console.log(),process.exit(0)),o.length>0&&(console.log(`  ${L("+")} New capabilities:`),o.forEach(a=>console.log(`      ${L(a.id)} \u2014 ${A(a.title)}`)),console.log()),r.length>0&&(console.log(`  ${G("-")} Removed capabilities:`),r.forEach(a=>console.log(`      ${G(a)}`)),console.log()),b.length>0&&(console.log(`  ${C("~")} Scenario updates:`),b.forEach(a=>{const j=a.isNew?L("[new]"):C("[update]");console.log(`      ${j} ${a.file}`)}),console.log()),p.changelogEntry&&(console.log(`  ${Y("\u{1F4DD}")} Changelog: ${A(p.changelogEntry)}`),console.log());const O=J.createInterface({input:process.stdin,output:process.stdout}),_=await T(O,`  Apply these changes? ${A("(y/n)")} `);O.close(),console.log(),_.toLowerCase()!=="y"&&_.toLowerCase()!=="yes"&&(F("Cancelled \u2014 no changes made."),console.log(),process.exit(0)),D("Applying Changes"),console.log(),K({cwd:e,contract:s,capabilities:u,suggestion:p,version:y}),R("suggest complete!"),W([C("infernoflow status")+"  \u2014 verify the updated contract",C("infernoflow check")+"   \u2014 validate everything"])}export{K as applyChanges,z as buildPrompt,Z as detectSuggestionConflicts,ee as loadSuggestContext,B as parseSuggestionJson,v as readJson,te as suggestCommand,M as validateSuggestion};
