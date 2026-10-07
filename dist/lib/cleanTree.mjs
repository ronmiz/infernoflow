import*as l from"node:fs";import*as u from"node:path";const d="# >>> infernoflow:start",s="# <<< infernoflow:end",g=["",d,"# Personal memory (per-developer, per-machine). Sync via cloud folder","# or `infernoflow sync`, not git.",".ai-memory/global.jsonl",".ai-memory/sessions.jsonl","# Regenerated artifacts \u2014 never commit these.",".ai-memory/handoff.md",".ai-memory/CONTEXT.draft.md",".ai-memory/HANDOFF.md",".ai-memory/.last-cli-version","# Automatic bookmark transcript snapshots \u2014 local only, never committed.",".ai-memory/details.local.jsonl","# AI provider settings \u2014 older versions stored API keys here.","inferno/integrations.json","# Hook state (machine-specific).",".ai-memory/.hook-state.json",".ai-memory/.trigger-state.json",".ai-memory/.review-seen.log","# MCP runtime stamp (machine-specific).",".ai-memory/.mcp-runtime.json","# Build/publish hygiene \u2014 don't ship memory in published .NET / monorepo bundles.","**/publish/.ai-memory/","**/publish/inferno/","**/dist/.ai-memory/","**/dist/inferno/",s,""].join(`
`),A=["",d,"# Branch-local memory: append-only JSONL files. Auto-merge concurrent","# additions from different machines/branches as union of lines so","# `home \u2192 work \u2192 home` syncs don't produce conflicts.",".ai-memory/branches/*.jsonl merge=union",s,""].join(`
`),I="# --- infernoflow (developer-local AI memory; do not commit) ---",y="# --- /infernoflow ---";function T(n){const r=n.indexOf(I),i=n.indexOf(y);if(r===-1||i===-1||i<=r)return n;const o=n.slice(0,r).replace(/\s+$/,""),e=n.slice(i+y.length).replace(/^\s+/,"");return(o?o+`
`:"")+(e||"")}function h(n,r,i){const o=u.join(n,r);let e="";try{e=l.readFileSync(o,"utf8")}catch{}e=T(e);const a=e.indexOf(d),c=e.indexOf(s),m=i.trim();let t;if(a!==-1&&c!==-1&&c>a){const f=e.slice(0,a).replace(/\s+$/,""),p=e.slice(c+s.length).replace(/^\s+/,"");t=(f?f+`

`:"")+m+`
`+(p?`
`+p:"")}else e?t=e.replace(/\s+$/,"")+`

`+m+`
`:t=m+`
`;return t===e?"unchanged":(l.mkdirSync(u.dirname(o),{recursive:!0}),l.writeFileSync(o,t,"utf8"),e?"updated":"created")}function E(n){return{gitignore:h(n,".gitignore",g),gitattributes:h(n,".gitattributes",A)}}export{s as GITIGNORE_END,d as GITIGNORE_START,E as applyCleanTreePolicy,h as ensureManagedBlock};
