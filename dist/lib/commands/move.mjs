import*as E from"node:fs";import*as n from"node:path";import{readEntries as v,readDetail as S,appendEntry as b,deleteEntry as L}from"../amp/io.mjs";import{findProjectRoot as w}from"../projectRoot.mjs";import{bold as R,cyan as W,gray as s,green as A,red as d,yellow as D}from"../ui/output.mjs";async function N(i=[]){const l=process.cwd(),m=e=>{const o=i.indexOf(e);return o!==-1?i[o+1]:null},c=m("--to"),a=m("--query"),f=i.includes("--apply"),x=new Set([c,a].filter(Boolean)),p=i.slice(1).filter(e=>!e.startsWith("--")&&!x.has(e));if(!c||!a&&!p.length){console.error(d(`
  \u2718 usage: infernoflow move <id-prefix\u2026> | --query "text"  --to <project-dir> [--apply]
`)),process.exitCode=1;return}let t;try{t=w(n.resolve(c))}catch{t=n.resolve(c)}const y=w(l);if(!E.existsSync(n.join(t,".ai-memory"))){console.error(d(`
  \u2718 ${t} has no .ai-memory/ \u2014 run infernoflow init there first
`)),process.exitCode=1;return}if(n.resolve(t)===n.resolve(y)){console.error(d(`
  \u2718 --to is this project
`)),process.exitCode=1;return}const $=v(l),u=a?a.toLowerCase():null,r=$.filter(e=>e.id&&(p.some(o=>o.length>=6&&e.id.startsWith(o))||u&&`${e.summary||""} ${e.file||""} ${(e.tags||[]).join(" ")}`.toLowerCase().includes(u)));if(!r.length){console.log(s(`
  Nothing matched.
`));return}const h=new Set(v(t).map(e=>e.id));console.log(`
  `+R(`${f?"Moving":"Would move"} ${r.length} entr${r.length===1?"y":"ies"}`)+s(` \u2192 ${t}`));for(const e of r)console.log("  "+W(e.id.slice(0,14))+" "+(e.type||"note").padEnd(9)+" "+String(e.summary||"").slice(0,80)+(h.has(e.id)?s("  (already there)"):""));if(!f){console.log(`
  `+D("Dry run.")+s(` Add --apply to move them.
`));return}let g=0;for(const e of r){if(!h.has(e.id)){let o=null;try{o=S(l,e)}catch{}const j=e.detailRef==="details.local.jsonl",{detailRef:k,...C}=e;b(t,{...C,id:e.id,ts:e.ts,meta:(({commit:B,...q})=>({...q,movedFrom:n.basename(y)}))(e.meta||{}),...o?{detail:o,detailLocal:j}:{}})}L(l,e.id),g++}console.log(`
  `+A(`\u2714 moved ${g}`)+s(` \u2014 commit both repos' .ai-memory/ changes.
`))}export{N as moveCommand};
