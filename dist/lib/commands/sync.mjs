import*as s from"node:fs";import*as u from"node:path";import{ampPaths as h,projectSlug as O}from"../amp/io.mjs";import{findProjectRoot as x}from"../projectRoot.mjs";import{bold as y,cyan as a,gray as e,green as p,yellow as D,red as v}from"../ui/output.mjs";function S(o){try{return JSON.parse(s.readFileSync(u.join(o,"amp.json"),"utf8"))}catch{return null}}function j(o,t){s.mkdirSync(o,{recursive:!0}),s.writeFileSync(u.join(o,"amp.json"),JSON.stringify(t,null,2)+`
`,"utf8")}function F(o){try{return s.readFileSync(o,"utf8").split(`
`).filter(r=>r.trim().length>0).length}catch{return 0}}function N(o,t){return o?{source:"env (INFERNOFLOW_GLOBAL_DIR)",value:o}:t?{source:"amp.json (globalDir)",value:t}:{source:"default (in-project)",value:null}}function R({jsonOut:o}={}){const t=x(process.cwd()),r=h(process.cwd()),n=S(r.root)||{},l=N(process.env.INFERNOFLOW_GLOBAL_DIR,n.globalDir),i=O(t),m=s.existsSync(r.globalFile),g=m?F(r.globalFile):0,f=u.join(r.root,"global.jsonl"),c=l.value&&f!==r.globalFile&&s.existsSync(f),d=c?F(f):0;if(o){console.log(JSON.stringify({projectRoot:t,projectSlug:i,configured:!!l.value,source:l.source,configuredPath:l.value,resolvedFile:r.globalFile,exists:m,entries:g,orphan:c,orphanLines:d},null,2));return}console.log(`
  `+y("\u{1F525} infernoflow sync \u2014 status")),console.log("  "+"\u2500".repeat(58)),console.log("  "+e("Project           ")+a(i)),console.log("  "+e("Source            ")+l.source),l.value&&console.log("  "+e("Configured path   ")+a(l.value)),console.log("  "+e("Resolved file     ")+a(r.globalFile)),console.log("  "+e("Status            ")+(m?p(`${g} entries`):e("not yet created"))),c&&(console.log(""),console.log("  "+D("\u26A0 Orphan local file detected")),console.log("  "+e("  "+f+"  ("+d+" entries)")),console.log("  "+e("  Run ")+a("infernoflow sync migrate")+e(" to merge it into the synced location."))),console.log(""),l.value||(console.log("  "+e("Tip: point at a synced folder (iCloud/Dropbox/etc.) to share personal")),console.log("  "+e("     preferences across your own machines:")),console.log("  "+a("  infernoflow sync set ~/Dropbox/infernoflow-memory")),console.log(""))}function J(o,{jsonOut:t}={}){o||(console.error(v(`
  \u2718 usage: infernoflow sync set <path>
`)),process.exit(1));const r=h(process.cwd(),{forWrite:!0}),n=S(r.root)||{},l=n.globalDir||null;if(n.globalDir=o,j(r.root,n),t){console.log(JSON.stringify({ok:!0,previous:l,current:o,file:u.join(r.root,"amp.json")},null,2));return}console.log(`
  `+p("\u2714 ")+"globalDir set to "+a(o)),l&&l!==o&&console.log("  "+e("  (was: "+l+")")),console.log("  "+e("  Run ")+a("infernoflow sync migrate")+e(` to move existing entries.
`))}function L({jsonOut:o}={}){const t=h(process.cwd(),{forWrite:!0}),r=S(t.root)||{},n=r.globalDir||null;if(!n){if(o){console.log(JSON.stringify({ok:!0,changed:!1},null,2));return}console.log(`
  `+e(`globalDir was not set \u2014 nothing to clear.
`));return}if(delete r.globalDir,j(t.root,r),o){console.log(JSON.stringify({ok:!0,changed:!0,previous:n},null,2));return}console.log(`
  `+p("\u2714 ")+"globalDir cleared "+e("(was "+n+")")),console.log("  "+e(`  global.jsonl is now in-project again. Old synced file is left in place.
`))}function k({jsonOut:o,dryRun:t}={}){const r=h(process.cwd()),n=u.join(r.root,"global.jsonl"),l=r.globalFile;if(n===l){if(o){console.log(JSON.stringify({ok:!0,migrated:0,reason:"sync not configured"},null,2));return}console.log(`
  `+e(`Sync not configured \u2014 nothing to migrate.
`));return}if(!s.existsSync(n)){if(o){console.log(JSON.stringify({ok:!0,migrated:0,reason:"no local global.jsonl"},null,2));return}console.log(`
  `+e(`No local global.jsonl to migrate.
`));return}const i=s.readFileSync(n,"utf8").split(`
`).filter(Boolean),g=s.existsSync(l)?s.readFileSync(l,"utf8").split(`
`).filter(Boolean):[],f=new Set,c=[];for(const w of[...g,...i])try{const b=JSON.parse(w).id||w;if(f.has(b))continue;f.add(b),c.push(w)}catch{}if(t){if(o){console.log(JSON.stringify({ok:!0,dryRun:!0,wouldWrite:l,fromLocal:i.length,existingTarget:g.length,afterMerge:c.length},null,2));return}console.log(`
  `+y("\u{1F525} infernoflow sync migrate")+e(" \u2014 dry run")),console.log("  "+e("From   ")+a(n)+e("  ("+i.length+" entries)")),console.log("  "+e("To     ")+a(l)+e("  ("+g.length+" existing)")),console.log("  "+e("After  ")+p(c.length+" entries (deduped by id)")),console.log("");return}s.mkdirSync(u.dirname(l),{recursive:!0}),s.writeFileSync(l,c.join(`
`)+(c.length?`
`:""),"utf8");const d=n.replace(/\.jsonl$/,`-archive-${Date.now()}.jsonl`);if(s.renameSync(n,d),o){console.log(JSON.stringify({ok:!0,migrated:i.length,afterMerge:c.length,target:l,archivedAs:d},null,2));return}console.log(`
  `+p("\u2714 ")+"Migrated "+c.length+" entries to "+a(l)),console.log("  "+e("  Local file archived \u2192 "+u.basename(d)+`
`))}async function B(o){const t=o.includes("--json"),r=o.includes("--dry-run")||o.includes("-n"),n=o.slice(1).find(i=>!i.startsWith("-"));if(!n||n==="status"||n==="--help"||n==="-h"){if(n==="--help"||n==="-h"){console.log(`
  ${y("\u{1F525} infernoflow sync")} ${e("\u2014 cross-machine personal memory")}

  ${y("Usage:")}
    infernoflow sync                       Show current setup
    infernoflow sync status                Same as bare invocation
    infernoflow sync set <path>            Configure synced directory
    infernoflow sync clear                 Remove configuration
    infernoflow sync migrate [--dry-run]   Move local global.jsonl into sync

  ${y("Recommended:")}
    point at an OS-synced folder (iCloud / Dropbox / OneDrive / Syncthing).
    Zero new infrastructure; the OS handles sync.

    ${a("infernoflow sync set ~/Dropbox/infernoflow-memory")}
`);return}return R({jsonOut:t})}const l=o.slice(1).filter(i=>!i.startsWith("-"));if(n==="set")return J(l[1],{jsonOut:t});if(n==="clear")return L({jsonOut:t});if(n==="migrate")return k({jsonOut:t,dryRun:r});console.error(v(`
  \u2718 Unknown sync verb: ${n}
`)),console.error(e(`  Run: infernoflow sync --help
`)),process.exit(1)}export{B as syncCommand};
