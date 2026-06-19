import{bold as y,cyan as g,gray as r,green as p,yellow as l,red as a}from"../ui/output.mjs";import{readEntries as x,deleteEntry as u}from"../amp/io.mjs";async function v(i=[]){const c=process.cwd(),f=i[0]==="forget"?i.slice(1):i,d=f.includes("--last"),n=f.find(o=>o&&!o.startsWith("-"));!d&&!n&&(console.error(r(`
  Usage: `)+g("infernoflow forget <id|prefix>")+r("  or  ")+g("infernoflow forget --last")+`
`),process.exit(1));const t=x(c);t.length===0&&(console.error(l(`
  No memory entries to forget.
`)),process.exit(1));let e;if(d)e=t[t.length-1];else{const o=t.filter(s=>s.id&&(s.id===n||s.id.startsWith(n)));if(o.length===0&&(console.error(a(`
  No entry matches id/prefix: ${n}
`)),process.exit(1)),o.length>1){console.error(l(`
  Ambiguous \u2014 ${o.length} entries match "${n}". Be more specific:`));for(const s of o.slice(0,8))console.error(r(`    ${s.id}  `)+(s.msg||s.summary||"").slice(0,60));console.error(""),process.exit(1)}e=o[0]}(!e||!e.id)&&(console.error(a(`
  That entry has no id (very old format) \u2014 edit .ai-memory/sessions.jsonl by hand.
`)),process.exit(1));const{removed:h,files:m}=u(c,e.id);console.log(),h>0?(console.log("  "+p("\u2714")+" Forgot "+y(e.type||"entry")+r(` ${e.id}`)),console.log("  "+r((e.msg||e.summary||"").slice(0,80))),console.log("  "+r(`Removed from ${m.length} file${m.length===1?"":"s"}.`))):console.log("  "+l("Nothing removed \u2014 the id wasn't found on disk.")),console.log()}export{v as forgetCommand};
