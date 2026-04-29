/**
 * infernoflow login / logout / whoami
 *
 * login   — GitHub OAuth via Supabase. Opens browser, waits for callback,
 *           saves token to ~/.infernoflow/credentials.json
 * logout  — Deletes ~/.infernoflow/credentials.json
 * whoami  — Prints the currently logged-in user
 *
 * Usage:
 *   infernoflow login
 *   infernoflow logout
 *   infernoflow whoami
 */

import * as http   from "node:http";
import * as crypto from "node:crypto";
import * as https  from "node:https";
import * as fs     from "node:fs";
import * as path   from "node:path";
import { bold, cyan, gray, green, red, yellow } from "../ui/output.mjs";
import {
  readCredentials,
  writeCredentials,
  deleteCredentials,
  isLoggedIn,
} from "../cloud/credentials.mjs";
import { getUser, SUPABASE_URL, SUPABASE_ANON_KEY } from "../cloud/supabase.mjs";

const PORT = 9242;
const CALLBACK_PATH = "/auth/callback";
const CALLBACK_URI  = `http://localhost:${PORT}${CALLBACK_PATH}`;

function openBrowser(url) {
  try {
    const { execSync } = require("child_process");
    const cmd = process.platform === "win32"   ? `start "" "${url}"`
              : process.platform === "darwin"  ? `open "${url}"`
              :                                  `xdg-open "${url}"`;
    execSync(cmd, { stdio: "ignore" });
  } catch {
    // If we can't open the browser, the user can copy the URL manually
  }
}

// ── login ─────────────────────────────────────────────────────────────────────

async function doLogin() {
  if (SUPABASE_URL.includes("YOUR_PROJECT")) {
    console.log();
    console.log(`  ${red("✘")} Supabase not configured yet.`);
    console.log();
    process.exit(1);
  }

  if (isLoggedIn()) {
    const creds = readCredentials();
    const user  = creds?.user;
    console.log();
    console.log(`  ${green("✔")} Already logged in as ${bold(user?.email || user?.user_metadata?.user_name || "unknown")}`);
    console.log(`  Run ${cyan("infernoflow logout")} to sign out.`);
    console.log();
    return;
  }

  console.log();
  console.log(`  ${bold("🔥 infernoflow login")}`);
  console.log();

  let resolve_token, reject_token;
  const tokenPromise = new Promise((res, rej) => {
    resolve_token = res;
    reject_token  = rej;
  });

  const server = http.createServer((req, res) => {
    const url    = new URL(req.url, `http://localhost:${PORT}`);
    const cbPath = url.pathname;

    if (cbPath !== CALLBACK_PATH) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Implicit flow: Supabase sends tokens in the URL hash fragment (#access_token=...)
    // Browser JS reads the fragment and POSTs it back to us
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>infernoflow login</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#f1f5f9}</style>
</head>
<body>
<script>
  const hash   = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const access_token  = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const expires_in    = params.get('expires_in');
  const error         = params.get('error_description') || params.get('error');
  if (access_token) {
    fetch('/auth/callback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ access_token, refresh_token, expires_in })
    }).then(() => {
      document.body.innerHTML = '<div style="text-align:center"><div style="font-size:48px">🔥</div><h2>Logged in!</h2><p style="color:#94a3b8">You can close this tab and return to the terminal.</p></div>';
    });
  } else if (error) {
    document.body.innerHTML = '<div style="text-align:center"><h2>Login failed</h2><p style="color:#f87171">' + error + '</p></div>';
    fetch('/auth/callback', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ error }) });
  } else {
    document.body.innerHTML = '<div style="text-align:center"><p style="color:#94a3b8">Processing…</p></div>';
  }
</script>
</body>
</html>`);
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        res.writeHead(200);
        res.end("ok");
        server.close();
        try {
          const data = JSON.parse(body);
          if (data.error) reject_token(new Error(data.error));
          else resolve_token(data);
        } catch (e) {
          reject_token(e);
        }
      });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    const params = new URLSearchParams({
      provider:    "github",
      redirect_to: CALLBACK_URI,
    });
    const oauthUrl = `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;

    console.log(`  Opening browser for GitHub login…`);
    console.log();
    console.log(`  ${gray("If the browser doesn't open, visit:")}`);
    console.log(`  ${cyan(oauthUrl)}`);
    console.log();
    openBrowser(oauthUrl);
    console.log(`  ${gray("Waiting for login…")} ${gray("(Ctrl+C to cancel)")}`);
  });

  const timeout = setTimeout(() => {
    server.close();
    reject_token(new Error("Login timed out after 3 minutes"));
  }, 3 * 60 * 1000);

  try {
    const tokenData = await tokenPromise;
    clearTimeout(timeout);

    const user = await getUser(tokenData.access_token);

    const creds = {
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at:    tokenData.expires_in
        ? new Date(Date.now() + parseInt(tokenData.expires_in) * 1000).toISOString()
        : null,
      user,
      logged_in_at: new Date().toISOString(),
    };

    writeCredentials(creds);

    const name = user?.user_metadata?.user_name || user?.email || "unknown";

    console.log();
    console.log(`  ${green("✔")} Logged in as ${bold(name)}`);
    console.log();
    console.log(`  ${gray("Session memory will now sync to the cloud on every")} ${cyan("infernoflow log")}`);
    console.log();

  } catch (err) {
    clearTimeout(timeout);
    try { server.close(); } catch {}
    console.log();
    console.log(`  ${red("✘")} Login failed: ${err.message}`);
    console.log();
    process.exit(1);
  }
}

// ── logout ────────────────────────────────────────────────────────────────────

function doLogout() {
  const deleted = deleteCredentials();
  console.log();
  if (deleted) {
    console.log(`  ${green("✔")} Logged out. Local credentials removed.`);
  } else {
    console.log(`  ${gray("Already logged out.")}`);
  }
  console.log();
}

// ── whoami ────────────────────────────────────────────────────────────────────

async function doWhoami() {
  const creds = readCredentials();
  console.log();
  if (!creds?.access_token) {
    console.log(`  ${gray("Not logged in.")} Run ${cyan("infernoflow login")}`);
    console.log();
    return;
  }

  const name    = creds.user?.user_metadata?.user_name || creds.user?.email || "unknown";
  const email   = creds.user?.email || gray("(no email)");
  const loggedIn = creds.logged_in_at ? new Date(creds.logged_in_at).toLocaleDateString() : "unknown";
  const expired  = !isLoggedIn();

  console.log(`  ${bold("🔥 infernoflow")} — logged in as:`);
  console.log();
  console.log(`  User:      ${bold(name)}`);
  console.log(`  Email:     ${email}`);
  console.log(`  Since:     ${gray(loggedIn)}`);
  if (expired) {
    console.log(`  Status:    ${yellow("⚠ Token expired — run infernoflow login to refresh")}`);
  } else {
    console.log(`  Status:    ${green("✔ Active")}`);
  }
  console.log();
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function loginCommand(rawArgs) {
  const sub = rawArgs[1]; // login | logout | whoami
  if (sub === "logout") return doLogout();
  if (sub === "whoami") return doWhoami();
  return doLogin();
}

export async function logoutCommand() {
  return doLogout();
}

export async function whoamiCommand() {
  return doWhoami();
}
