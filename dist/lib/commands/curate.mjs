import*as d from"node:fs";import*as g from"node:path";import{readEntries as h,deleteEntry as w,toAmp as S,projectSlug as $}from"../amp/io.mjs";import{isNoise as j}from"../memoryView.mjs";import{findProjectRoot as k}from"../projectRoot.mjs";import{infernoflowHome as v}from"../personalConfig.mjs";import{bold as N,gray as l,green as b,yellow as A}from"../ui/output.mjs";const m=r=>(typeof r.ts=="number"?r.ts:Date.parse(r.ts||0))||0;function D(r){const i=h(r).sort((o,s)=>m(o)-m(s)),e={commitNotes:[],duplicates:[],oldFrustration:[]},n=new Map,c=Date.now()-14*864e5;for(const o of i){if(Array.isArray(o.tags)&&o.tags.includes("bookmark"))continue;if(j(o)){e.commitNotes.push(o);continue}if(o.source==="hook"&&/^User frustration:/.test(o.summary||"")&&m(o)<c){e.oldFrustration.push(o);continue}const s=`${o.type}\0${o.file||""}\0${String(o.summary||"").trim().toLowerCase()}`;n.has(s)?e.duplicates.push(o):n.set(s,o)}return e}async function M(r=[]){const i=process.cwd(),e=r.includes("--apply"),n=D(i),c=[["commit notes (duplicate git history)",n.commitNotes],["duplicates",n.duplicates],["raw frustration prompts > 14 days",n.oldFrustration]],o=c.reduce((t,[,a])=>t+a.length,0);console.log(`
  `+N("\u{1F525} infernoflow curate"));for(const[t,a]of c){console.log(`  ${String(a.length).padStart(4)}  ${t}`);for(const y of a.slice(0,3))console.log(l("        "+String(y.summary||"").slice(0,90)))}if(!o){console.log(l(`
  Nothing to curate.
`));return}if(!e){console.log(`
  `+A("Dry run.")+l(` Add --apply to remove them (archived first).
`));return}const s=k(i),f=g.join(v(),"backups");d.mkdirSync(f,{recursive:!0});const p=g.join(f,`${$(s)}-curated-${new Date().toISOString().replace(/[:.]/g,"-")}.jsonl`),u=c.flatMap(([,t])=>t);d.writeFileSync(p,u.map(t=>JSON.stringify(S(t))).join(`
`)+`
`,"utf8");for(const t of u)w(i,t.id);console.log(`
  `+b(`\u2714 removed ${u.length}`)+l(` \u2014 archived to ${p}
`))}export{D as curateCandidates,M as curateCommand};
