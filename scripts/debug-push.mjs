/**
 * infernoflow — cloud push debugger
 * Shows exactly what Supabase responds with, step by step.
 *
 * Usage:  node scripts/debug-push.mjs
 */

import * as https from "node:https";
import * as fs    from "node:fs";
import * as os    from "node:os";
import * as path  from "node:path";

const SUPABASE_URL      = "https://vscesbbtmrsctfroigyx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzY2VzYmJ0bXJzY3Rmcm9pZ3l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0ODAxMjcsImV4cCI6MjA5MzA1NjEyN30.4WCXr0aGBlqC2m29DnlCSu5qKl0L-fDQoaV9AGu8-68";
const CREDS_FILE        = path.join(os.homedir(), ".infernoflow", "credentials.json");

function httpsRequest(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname, port: 443,
      path: parsed.pathname + parsed.search, method,
      headers: {
        "Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": "infernoflow-cli", "apikey": SUPABASE_ANON_KEY,
        ...headers,
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
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
    req.setTimeout(10000, () => req.destroy(new Error("timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

console.log("\n  🔥 infernoflow cloud push debugger\n");
console.log("  ─────────────────────────────────────────\n");

// Step 1: Check credentials
console.log("  [1/4] Checking credentials...");
let userToken = "anonymous";
if (fs.existsSync(CREDS_FILE)) {
  try {
    const creds = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
    const name  = creds.user?.login || creds.user?.name || "unknown";
    const token = creds.access_token;
    userToken   = creds.user_token || creds.user?.id || creds.user?.login || "anonymous";
    console.log(`       ✔ Logged in as: ${name}`);
    console.log(`       ✔ user_token will be: ${userToken}`);
    console.log(`       ✔ access_token present: ${!!token}`);
  } catch (e) {
    console.log("       ✘ credentials.json exists but can't parse:", e.message);
  }
} else {
  console.log("       ✘ NOT logged in — ~/.infernoflow/credentials.json missing");
  console.log("       → Run: infernoflow login");
  console.log("       → NOTE: pushEntry only fires when logged in!\n");
  process.exit(1);
}

// Step 2: Check table is reachable
console.log("\n  [2/4] Checking entries table...");
try {
  const check = await httpsRequest("GET",
    `${SUPABASE_URL}/rest/v1/entries?limit=1`,
    null,
    { "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }
  );
  console.log(`       Status: ${check.status}`);
  if (check.status === 200) {
    console.log("       ✔ Table reachable, RLS is OFF");
    console.log(`       Existing rows (up to 1): ${JSON.stringify(check.body)}`);
  } else {
    console.log("       ✘ Table error:", JSON.stringify(check.body));
    if (check.status === 401 || check.status === 403) {
      console.log("       → RLS is still ON — run fix-schema.mjs first!\n");
    }
  }
} catch (e) {
  console.log("       ✘ Network error:", e.message);
  process.exit(1);
}

// Step 3: Try inserting a test row
console.log("\n  [3/4] Inserting test row...");
const row = {
  project_id: "debug-test",
  user_token:  userToken,
  ts:          new Date().toISOString(),
  type:        "note",
  summary:     "DEBUG: cloud push test from debug-push.mjs",
  result:      null,
  source:      "debug",
  auto:        false,
  agent:       "debug",
};
console.log("       Row:", JSON.stringify(row, null, 7));

try {
  const res = await httpsRequest("POST",
    `${SUPABASE_URL}/rest/v1/entries`,
    row,
    {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey":        SUPABASE_ANON_KEY,
      "Prefer":        "return=representation",
    }
  );
  console.log(`\n       Status: ${res.status}`);
  console.log("       Body:", JSON.stringify(res.body, null, 7));
  if (res.status === 201 || res.status === 200) {
    console.log("\n  [4/4] ✔ SUCCESS — row inserted!\n");
    console.log("       Check: https://supabase.com/dashboard/project/vscesbbtmrsctfroigyx/editor\n");
  } else {
    console.log("\n  [4/4] ✘ INSERT FAILED — see error above");
    console.log("\n  What to do:");
    if (JSON.stringify(res.body).includes("user_id")) {
      console.log("  → Schema not fixed yet. Run:  node scripts/fix-schema.mjs YOUR_PAT");
      console.log("  → Get PAT at: https://supabase.com/dashboard/account/tokens\n");
    } else if (JSON.stringify(res.body).includes("RLS") || res.status === 403) {
      console.log("  → RLS is still enabled. Run:  node scripts/fix-schema.mjs YOUR_PAT\n");
    } else {
      console.log("  → Unknown error — share the output above\n");
    }
    process.exit(1);
  }
} catch (e) {
  console.log("       ✘ Network error:", e.message, "\n");
  process.exit(1);
}
