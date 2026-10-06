import*as m from"node:fs";import*as u from"node:path";const d="# >>> infernoflow:start",s="# <<< infernoflow:end",g=["",d,"# Personal memory (per-developer, per-machine). Sync via cloud folder","# or `infernoflow sync`, not git.",".ai-memory/global.jsonl",".ai-memory/sessions.jsonl","# Regenerated artifacts \u2014 never commit these.",".ai-memory/handoff.md",".ai-memory/CONTEXT.draft.md",".ai-memory/HANDOFF.md",".ai-memory/.last-cli-version","# Automatic bookmark transcript snapshots \u2014 local only, never committed.",".ai-memory/details.local.jsonl","# AI provider settings \u2014 older versions stored API keys here.","inferno/integrations.json","# MCP runtime stamp (machine-specific).",".ai-memory/.mcp-runtime.json","# Build/publish hygiene \u2014 don't ship memory in published .NET / monorepo bundles.","**/publish/.ai-memory/","**/publish/inferno/","**/dist/.ai-memory/","**/dist/inferno/",s,""].join(`
`),A=["",d,"# Branch-local memory: append-only JSONL files. Auto-merge concurrent","# additions from different machines/branches as union of lines so","# `home \u2192 work \u2192 home` syncs don't produce conflicts.",".ai-memory/branches/*.jsonl merge=union",s,""].join(`
`),I="# --- infernoflow (developer-local AI memory; do not commit) ---",y="# --- /infernoflow ---";function T(n){const r=n.indexOf(I),i=n.indexOf(y);if(r===-1||i===-1||i<=r)return n;const o=n.slice(0,r).replace(/\s+$/,""),e=n.slice(i+y.length).replace(/^\s+/,"");return(o?o+`
`:"")+(e||"")}function h(n,r,i){const o=u.join(n,r);let e="";try{e=m.readFileSync(o,"utf8")}catch{}e=T(e);const c=e.indexOf(d),a=e.indexOf(s),l=i.trim();let t;if(c!==-1&&a!==-1&&a>c){const f=e.slice(0,c).replace(/\s+$/,""),p=e.slice(a+s.length).replace(/^\s+/,"");t=(f?f+`

`:"")+l+`
`+(p?`
`+p:"")}else e?t=e.replace(/\s+$/,"")+`

`+l+`
`:t=l+`
`;return t===e?"unchanged":(m.mkdirSync(u.dirname(o),{recursive:!0}),m.writeFileSync(o,t,"utf8"),e?"updated":"created")}function E(n){return{gitignore:h(n,".gitignore",g),gitattributes:h(n,".gitattributes",A)}}export{s as GITIGNORE_END,d as GITIGNORE_START,E as applyCleanTreePolicy,h as ensureManagedBlock};
