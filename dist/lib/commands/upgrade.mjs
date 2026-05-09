import*as n from"node:fs";import*as o from"node:path";import{bold as k,cyan as r,gray as c,green as g,yellow as x,red as O}from"../ui/output.mjs";const m="inferno";function N(l){try{return JSON.parse(n.readFileSync(l,"utf8"))}catch{return null}}async function F(l){const f=process.cwd(),i=l.includes("--dry-run"),v=l.includes("--yes")||l.includes("-y");console.log(`
  `+k("\u{1F525} infernoflow upgrade")),console.log("  "+"\u2500".repeat(50)+`
`);const a=o.join(f,m);n.existsSync(a)||(console.error(O(`  \u2718 inferno/ not found \u2014 run: infernoflow init --lite first
`)),process.exit(1));const y=o.join(a,".lite"),b=n.existsSync(y),s=N(o.join(a,"contract.json")),j=s?.policyId||o.basename(f),d=s?.capabilities||[];if(!b){console.log(x(`  \u26A0  This project is already on the full setup \u2014 nothing to upgrade.
`));return}console.log(c(`  Project: ${j}`)),console.log(c(`  Capabilities: ${d.length||0}`)),console.log(c(`  Mode: lite \u2192 full
`));const u=[],w=(e,t)=>{const p=o.join(f,e);if(n.existsSync(p)){console.log(c(`  skipped (exists): ${e}`));return}if(i){console.log(r(`  would create: ${e}`));return}n.mkdirSync(o.dirname(p),{recursive:!0}),n.writeFileSync(p,t,"utf8"),console.log(g(`  \u2714 Created: ${e}`)),u.push(e)};if(d.length){const e={scenarioId:"happy_path",description:"Basic happy-path covering all capabilities",capabilitiesCovered:d,steps:d.map(t=>({action:t,expect:`${t} works as expected`}))};w(o.join(m,"scenarios","happy_path.json"),JSON.stringify(e,null,2)+`
`)}else i||n.mkdirSync(o.join(a,"scenarios"),{recursive:!0}),console.log(c("  created: inferno/scenarios/ (empty \u2014 add scenarios as you define capabilities)"));w(o.join(m,"CHANGELOG.md"),`# Changelog \u2014 ${j}

## Unreleased

- Upgraded from lite setup

## 0.1.0 \u2014 Initial release

- Project initialized with infernoflow
`),!i&&s&&(s.rules={docsRequiredOnCapabilityChange:!0,requireScenarioForEachCapability:!1,requireChangelogOnCapabilityChange:!0},delete s.lite,n.writeFileSync(o.join(a,"contract.json"),JSON.stringify(s,null,2)+`
`),console.log(g("  \u2714 Updated: inferno/contract.json (added rules)")),u.push("inferno/contract.json"));const h=o.join(f,"package.json");if(n.existsSync(h)&&!i){const e=JSON.parse(n.readFileSync(h,"utf8"));e.scripts=e.scripts||{};let t=!1;const p={"inferno:check":"infernoflow check","inferno:context":"infernoflow context","inferno:theme":"infernoflow theme"};for(const[S,C]of Object.entries(p))e.scripts[S]||(e.scripts[S]=C,t=!0);t&&(n.writeFileSync(h,JSON.stringify(e,null,2)+`
`),console.log(g("  \u2714 Updated: package.json scripts (inferno:check, inferno:context, inferno:theme)")),u.push("package.json"))}else i&&console.log(r("  would update: package.json scripts"));if(!i&&n.existsSync(y)&&(n.unlinkSync(y),console.log(g("  \u2714 Removed .lite marker \u2014 now on full setup"))),console.log(),i){console.log(x(`  \u2691 Dry run \u2014 nothing written. Remove --dry-run to apply.
`));return}if(!u.length){console.log(c(`  Nothing new to create \u2014 already fully set up.
`));return}console.log("  "+k("Upgrade complete!")),console.log("  "+r("\u2192")+" Run "+r("infernoflow check")+" to validate the contract"),console.log("  "+r("\u2192")+" Run "+r("infernoflow vibe")+" to start auto-sync mode"),console.log()}export{F as upgradeCommand};
