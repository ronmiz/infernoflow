import{readProfile as r,summarizeProfile as i}from"./profile.mjs";function o(t){let e;try{e=r(t)}catch{return""}const n=[];if(!(e.namingStyle!=="unknown"||e.preferredVerbs.length>0||e.stack.framework!=="unknown"))return"";if(n.push("## Developer profile (personalise your response to match these preferences)"),e.namingStyle!=="unknown"&&n.push(`- Capability naming style: **${e.namingStyle}** \u2014 use this for all new capability IDs`),e.preferredVerbs.length>0&&n.push(`- Preferred action verbs: ${e.preferredVerbs.slice(0,5).join(", ")} \u2014 prefer these when naming new capabilities`),e.stack.framework!=="unknown"&&n.push(`- Stack: ${e.stack.framework} / ${e.stack.language} (${e.stack.projectType})`),e.changelogVerbosity!=="unknown"){const s=e.changelogVerbosity==="brief"?"Keep changelog entries short (one line, action-focused)":"Write detailed changelog entries (include context and impact)";n.push(`- Changelog style: ${s}`)}if(e.featureClusters.length>0){const s=e.featureClusters[0];s.length>=2&&n.push(`- Common capability cluster: [${s.slice(0,4).join(", ")}] \u2014 if the task touches one of these, consider whether others need updating too`)}return e.sessionCount>=10&&n.push(`- Experienced user (${e.sessionCount} sessions) \u2014 skip basic explanations, be direct`),n.join(`
`)}function c(t,e){const n=o(e);return n?t.includes("## Instructions")?t.replace("## Instructions",n+`

## Instructions`):t.includes("Respond with ONLY")?t.replace("Respond with ONLY",n+`

---
Respond with ONLY`):t+`

`+n:t}function u(t){try{const e=r(t);return i(e)||null}catch{return null}}export{o as buildPersonalisationBlock,c as personalisePrompt,u as profileStatusLine};
