/**
 * infernoflow — one-time Supabase schema fix
 * Drops user_id NOT NULL, adds user_token column, disables RLS.
 *
 * Usage:
 *   node scripts/fix-schema.mjs YOUR_SUPABASE_PERSONAL_ACCESS_TOKEN
 *
 * Get your token at: https://supabase.com/dashboard/account/tokens
 */

import * as https from "node:https";

const PROJECT_REF = "vscesbbtmrsctfroigyx";
const token = process.argv[2];

if (!token) {
  console.error("\n  ✘ Usage: node scripts/fix-schema.mjs YOUR_PERSONAL_ACCESS_TOKEN");
  console.error("  Get token at: https://supabase.com/dashboard/account/tokens\n");
  process.exit(1);
}

const SQL = `
ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_user_id_fkey;
ALTER TABLE entries ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS user_token text;
ALTER TABLE entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE team_members DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS entries_user_token ON entries (user_token, project_id, ts DESC);
GRANT SELECT, INSERT ON public.entries TO anon;
GRANT SELECT, INSERT ON public.team_members TO anon;
`;

function post(url, body, token) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = JSON.stringify(body);
    const opts = {
      hostname: parsed.hostname, port: 443,
      path: parsed.pathname + parsed.search, method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "Authorization": `Bearer ${token}`,
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    req.write(payload);
    req.end();
  });
}

console.log("\n  🔥 infernoflow — fixing Supabase schema...\n");

try {
  const res = await post(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    { query: SQL },
    token
  );

  if (res.status === 200 || res.status === 201) {
    console.log("  ✔ Schema fixed successfully!\n");
    console.log("  You can now run:  infernoflow log \"test cloud push\"\n");
    console.log("  Then check:       https://supabase.com/dashboard/project/vscesbbtmrsctfroigyx/editor\n");
  } else {
    console.error("  ✘ Error (HTTP " + res.status + "):");
    console.error("  " + JSON.stringify(res.body, null, 2));
    console.error("\n  If you see 401: your token is wrong or expired.");
    console.error("  If you see 403: make sure it's a Personal Access Token, not the anon key.\n");
    process.exit(1);
  }
} catch (err) {
  console.error("  ✘ Network error:", err.message, "\n");
  process.exit(1);
}
