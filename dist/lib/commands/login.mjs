import*as k from"node:http";import*as L from"node:crypto";import"node:fs";import"node:path";import{bold as i,cyan as r,gray as t,green as g,red as y,yellow as x}from"../ui/output.mjs";import{readCredentials as _,writeCredentials as A,deleteCredentials as O,isLoggedIn as $}from"../cloud/credentials.mjs";import{getOAuthUrl as C,getUser as P,SUPABASE_URL as T}from"../cloud/supabase.mjs";const u=9242,w="/auth/callback",v=`http://localhost:${u}${w}`;function E(e){try{const{execSync:s}=require("child_process"),l=process.platform==="win32"?`start "" "${e}"`:process.platform==="darwin"?`open "${e}"`:`xdg-open "${e}"`;s(l,{stdio:"ignore"})}catch{}}async function U(){if(T.includes("YOUR_PROJECT")&&(console.log(),console.log(`  ${y("\u2718")} Supabase not configured yet.`),console.log(),console.log("  Set up your Supabase project first:"),console.log(`  ${t("1.")} Create a project at ${r("https://supabase.com")}`),console.log(`  ${t("2.")} Run ${r("scripts/supabase-schema.sql")} in the SQL editor`),console.log(`  ${t("3.")} Enable GitHub OAuth in Authentication \u2192 Providers`),console.log(`  ${t("4.")} Set ${r("INFERNOFLOW_SUPABASE_URL")} and ${r("INFERNOFLOW_SUPABASE_ANON_KEY")}`),console.log("     (or hardcode them in lib/cloud/supabase.mjs)"),console.log(),process.exit(1)),$()){const n=_()?.user;console.log(),console.log(`  ${g("\u2714")} Already logged in as ${i(n?.email||n?.user_metadata?.user_name||"unknown")}`),console.log(`  Run ${r("infernoflow logout")} to sign out.`),console.log();return}const e=L.randomBytes(16).toString("hex");console.log(),console.log(`  ${i("\u{1F525} infernoflow login")}`),console.log();let s,l;const d=new Promise((o,n)=>{s=o,l=n}),a=k.createServer((o,n)=>{if(new URL(o.url,`http://localhost:${u}`).pathname!==w){n.writeHead(404),n.end("Not found");return}if(o.method==="GET"){n.writeHead(200,{"Content-Type":"text/html"}),n.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>infernoflow login</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#f1f5f9}</style>
</head>
<body>
<script>
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const expires_in = params.get('expires_in');
  const error = params.get('error_description') || params.get('error');
  if (access_token) {
    fetch('/auth/callback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ access_token, refresh_token, expires_in })
    }).then(() => {
      document.body.innerHTML = '<div style="text-align:center"><div style="font-size:48px">\u{1F525}</div><h2>Logged in!</h2><p style="color:#94a3b8">You can close this tab and return to the terminal.</p></div>';
    });
  } else if (error) {
    document.body.innerHTML = '<div style="text-align:center"><h2>Login failed</h2><p style="color:#f87171">' + error + '</p></div>';
    fetch('/auth/callback', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ error }) });
  } else {
    document.body.innerHTML = '<div style="text-align:center"><p style="color:#94a3b8">Processing\u2026</p></div>';
  }
</script>
</body>
</html>`);return}if(o.method==="POST"){let h="";o.on("data",c=>h+=c),o.on("end",()=>{n.writeHead(200),n.end("ok"),a.close();try{const c=JSON.parse(h);c.error?l(new Error(c.error)):s(c)}catch(c){l(c)}})}});a.listen(u,"127.0.0.1",()=>{const o=C(e,v);console.log("  Opening browser for GitHub login\u2026"),console.log(),console.log(`  ${t("If the browser doesn't open, visit:")}`),console.log(`  ${r(o)}`),console.log(),E(o),console.log(`  ${t("Waiting for login\u2026")} ${t("(Ctrl+C to cancel)")}`)});const m=setTimeout(()=>{a.close(),l(new Error("Login timed out after 3 minutes"))},180*1e3);try{const o=await d;clearTimeout(m);const n=await P(o.access_token),f={access_token:o.access_token,refresh_token:o.refresh_token||null,expires_at:o.expires_in?new Date(Date.now()+parseInt(o.expires_in)*1e3).toISOString():null,user:n,logged_in_at:new Date().toISOString()};A(f);const p=n?.user_metadata?.user_name||n?.email||"unknown";console.log(),console.log(`  ${g("\u2714")} Logged in as ${i(p)}`),console.log(),console.log(`  ${t("Session memory will now sync to the cloud on every")} ${r("infernoflow log")}`),console.log()}catch(o){clearTimeout(m),a.close(),console.log(),console.log(`  ${y("\u2718")} Login failed: ${o.message}`),console.log(),process.exit(1)}}function S(){const e=O();console.log(),console.log(e?`  ${g("\u2714")} Logged out. Local credentials removed.`:`  ${t("Already logged out.")}`),console.log()}async function b(){const e=_();if(console.log(),!e?.access_token){console.log(`  ${t("Not logged in.")} Run ${r("infernoflow login")}`),console.log();return}const s=e.user?.user_metadata?.user_name||e.user?.email||"unknown",l=e.user?.email||t("(no email)"),d=e.logged_in_at?new Date(e.logged_in_at).toLocaleDateString():"unknown",a=!$();console.log(`  ${i("\u{1F525} infernoflow")} \u2014 logged in as:`),console.log(),console.log(`  User:      ${i(s)}`),console.log(`  Email:     ${l}`),console.log(`  Since:     ${t(d)}`),console.log(a?`  Status:    ${x("\u26A0 Token expired \u2014 run infernoflow login to refresh")}`:`  Status:    ${g("\u2714 Active")}`),console.log()}async function D(e){const s=e[1];return s==="logout"?S():s==="whoami"?b():U()}async function Y(){return S()}async function F(){return b()}export{D as loginCommand,Y as logoutCommand,F as whoamiCommand};
