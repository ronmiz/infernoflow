import{readPersonalConfig as w,writePersonalConfig as b,personalConfigPath as O,expandUserPath as x}from"../personalConfig.mjs";import*as i from"node:fs";import*as d from"node:path";import{ampPaths as v,projectSlug as N}from"../amp/io.mjs";import{findProjectRoot as R}from"../projectRoot.mjs";import{bold as p,cyan as a,gray as o,green as m,yellow as j,red as F}from"../ui/output.mjs";function J(e){try{return JSON.parse(i.readFileSync(d.join(e,"amp.json"),"utf8"))}catch{return null}}function E(e,r){i.mkdirSync(e,{recursive:!0}),i.writeFileSync(d.join(e,"amp.json"),JSON.stringify(r,null,2)+`
`,"utf8")}function D(e){try{return i.readFileSync(e,"utf8").split(`
`).filter(l=>l.trim().length>0).length}catch{return 0}}function k(e,r){return e?{source:"env (INFERNOFLOW_GLOBAL_DIR)",value:e}:r?{source:"personal config (~/.infernoflow/config.json)",value:r}:{source:"default (in-project)",value:null}}function L({jsonOut:e}={}){const r=R(process.cwd()),l=v(process.cwd()),n=J(l.root)||{},t=k(process.env.INFERNOFLOW_GLOBAL_DIR,w().globalDir),s=n.globalDir||null,h=N(r),g=i.existsSync(l.globalFile),y=g?D(l.globalFile):0,c=d.join(l.root,"global.jsonl"),f=t.value&&c!==l.globalFile&&i.existsSync(c),u=f?D(c):0;if(e){console.log(JSON.stringify({projectRoot:r,projectSlug:h,configured:!!t.value,source:t.source,configuredPath:t.value,resolvedFile:l.globalFile,exists:g,entries:y,orphan:f,orphanLines:u,ignoredRepoGlobalDir:s},null,2));return}console.log(`
  `+p("\u{1F525} infernoflow sync \u2014 status")),console.log("  "+"\u2500".repeat(58)),console.log("  "+o("Project           ")+a(h)),console.log("  "+o("Source            ")+t.source),t.value&&console.log("  "+o("Configured path   ")+a(t.value)),console.log("  "+o("Resolved file     ")+a(l.globalFile)),console.log("  "+o("Status            ")+(g?m(`${y} entries`):o("not yet created"))),s&&(console.log(""),console.log("  "+j("\u26A0 .ai-memory/amp.json sets globalDir = "+s+" \u2014 ignored since 0.46.0")),console.log("  "+o("  That file is committed, so it can't decide where personal memory goes.")),console.log("  "+o("  To keep using it: ")+a("infernoflow sync set "+s)+o("  (then remove it from amp.json)"))),f&&(console.log(""),console.log("  "+j("\u26A0 Orphan local file detected")),console.log("  "+o("  "+c+"  ("+u+" entries)")),console.log("  "+o("  Run ")+a("infernoflow sync migrate")+o(" to merge it into the synced location."))),console.log(""),t.value||(console.log("  "+o("Tip: point at a synced folder (iCloud/Dropbox/etc.) to share personal")),console.log("  "+o("     preferences across your own machines:")),console.log("  "+a("  infernoflow sync set ~/Dropbox/infernoflow-memory")),console.log(""))}function C(e,{jsonOut:r}={}){e||(console.error(F(`
  \u2718 usage: infernoflow sync set <path>
`)),process.exit(1));const l=w(),n=l.globalDir||null;if(l.globalDir=x(e),b(l),r){console.log(JSON.stringify({ok:!0,previous:n,current:l.globalDir,file:O()},null,2));return}console.log(`
  `+m("\u2714 ")+"globalDir set to "+a(e)),n&&n!==e&&console.log("  "+o("  (was: "+n+")")),console.log("  "+o("  Run ")+a("infernoflow sync migrate")+o(` to move existing entries.
`))}function $({jsonOut:e}={}){const r=w(),l=r.globalDir||null;if(!l){if(e){console.log(JSON.stringify({ok:!0,changed:!1},null,2));return}console.log(`
  `+o(`globalDir was not set \u2014 nothing to clear.
`));return}if(delete r.globalDir,b(r),e){console.log(JSON.stringify({ok:!0,changed:!0,previous:l},null,2));return}console.log(`
  `+m("\u2714 ")+"globalDir cleared "+o("(was "+l+")")),console.log("  "+o(`  global.jsonl is now in-project again. Old synced file is left in place.
`))}function P({jsonOut:e,dryRun:r}={}){const l=v(process.cwd()),n=d.join(l.root,"global.jsonl"),t=l.globalFile;if(n===t){if(e){console.log(JSON.stringify({ok:!0,migrated:0,reason:"sync not configured"},null,2));return}console.log(`
  `+o(`Sync not configured \u2014 nothing to migrate.
`));return}if(!i.existsSync(n)){if(e){console.log(JSON.stringify({ok:!0,migrated:0,reason:"no local global.jsonl"},null,2));return}console.log(`
  `+o(`No local global.jsonl to migrate.
`));return}const s=i.readFileSync(n,"utf8").split(`
`).filter(Boolean),g=i.existsSync(t)?i.readFileSync(t,"utf8").split(`
`).filter(Boolean):[],y=new Set,c=[];for(const u of[...g,...s])try{const S=JSON.parse(u).id||u;if(y.has(S))continue;y.add(S),c.push(u)}catch{}if(r){if(e){console.log(JSON.stringify({ok:!0,dryRun:!0,wouldWrite:t,fromLocal:s.length,existingTarget:g.length,afterMerge:c.length},null,2));return}console.log(`
  `+p("\u{1F525} infernoflow sync migrate")+o(" \u2014 dry run")),console.log("  "+o("From   ")+a(n)+o("  ("+s.length+" entries)")),console.log("  "+o("To     ")+a(t)+o("  ("+g.length+" existing)")),console.log("  "+o("After  ")+m(c.length+" entries (deduped by id)")),console.log("");return}i.mkdirSync(d.dirname(t),{recursive:!0}),i.writeFileSync(t,c.join(`
`)+(c.length?`
`:""),"utf8");const f=n.replace(/\.jsonl$/,`-archive-${Date.now()}.jsonl`);if(i.renameSync(n,f),e){console.log(JSON.stringify({ok:!0,migrated:s.length,afterMerge:c.length,target:t,archivedAs:f},null,2));return}console.log(`
  `+m("\u2714 ")+"Migrated "+c.length+" entries to "+a(t)),console.log("  "+o("  Local file archived \u2192 "+d.basename(f)+`
`))}async function I(e){const r=e.includes("--json"),l=e.includes("--dry-run")||e.includes("-n"),n=e.slice(1).find(s=>!s.startsWith("-"));if(!n||n==="status"||n==="--help"||n==="-h"){if(n==="--help"||n==="-h"){console.log(`
  ${p("\u{1F525} infernoflow sync")} ${o("\u2014 cross-machine personal memory")}

  ${p("Usage:")}
    infernoflow sync                       Show current setup
    infernoflow sync status                Same as bare invocation
    infernoflow sync set <path>            Configure synced directory
    infernoflow sync clear                 Remove configuration
    infernoflow sync migrate [--dry-run]   Move local global.jsonl into sync

  ${p("Recommended:")}
    point at an OS-synced folder (iCloud / Dropbox / OneDrive / Syncthing).
    Zero new infrastructure; the OS handles sync.

    ${a("infernoflow sync set ~/Dropbox/infernoflow-memory")}
`);return}return L({jsonOut:r})}const t=e.slice(1).filter(s=>!s.startsWith("-"));if(n==="set")return C(t[1],{jsonOut:r});if(n==="clear")return $({jsonOut:r});if(n==="migrate")return P({jsonOut:r,dryRun:l});console.error(F(`
  \u2718 Unknown sync verb: ${n}
`)),console.error(o(`  Run: infernoflow sync --help
`)),process.exit(1)}export{I as syncCommand};
