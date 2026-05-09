import*as t from"node:fs";import*as n from"node:path";const d=`
# infernoflow: agent draft (IDE hooks \u2014 review before commit)
inferno/CONTEXT.draft.md
`.trimStart();function S(o,e,c){const s=n.join(o,"package.json");if(!t.existsSync(s)){e||c("No package.json \u2014 add script manually: inferno:promote-draft");return}const r=JSON.parse(t.readFileSync(s,"utf8"));r.scripts=r.scripts||{},r.scripts["inferno:promote-draft"]||(r.scripts["inferno:promote-draft"]="node scripts/inferno-promote-draft.mjs",t.writeFileSync(s,JSON.stringify(r,null,2)+`
`,"utf8"),e||c("Updated package.json script: inferno:promote-draft"))}function y(o){const{cwd:e,templatesRoot:c,force:s,silent:r}=o,f=o.logOk||(()=>{}),l=o.logWarn||(()=>{});function m(p,a){return t.existsSync(a)&&!s?(r||l("Skipped (exists): "+n.relative(e,a)),!1):(t.mkdirSync(n.dirname(a),{recursive:!0}),t.copyFileSync(p,a),r||f("Created: "+n.relative(e,a)),!0)}const u=n.join(c,"scripts","inferno-promote-draft.mjs"),g=n.join(e,"scripts","inferno-promote-draft.mjs");m(u,g),S(e,r,f);const i=n.join(e,".gitignore");t.existsSync(i)?t.readFileSync(i,"utf8").includes("CONTEXT.draft.md")?r||f(".gitignore already mentions CONTEXT.draft.md"):(t.appendFileSync(i,`
${d}
`,"utf8"),r||f("Updated: "+n.relative(e,i))):(t.writeFileSync(i,`${d}
`,"utf8"),r||f("Created: "+n.relative(e,i)))}export{y as installInfernoDraftTooling};
