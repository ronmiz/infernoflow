/**
 * infernoflow login / logout / whoami
 *
 * Default flow (v0.38+): GitHub Device Flow — short code, github.com/login/device.
 * Saves the GitHub identity. Cloud writes go through anon-key dev mode.
 *
 * --browser flow (experimental, v0.40+): Supabase GitHub OAuth via a one-shot
 * localhost callback server. The CLI opens your browser to Supabase's
 * /auth/v1/authorize endpoint, you sign in once, Supabase redirects back to
 * http://localhost:<port>/callback with the session in the URL fragment, a
 * tiny JS shim in our HTML response forwards the tokens back to the CLI, and
 * we save the Supabase JWT + refresh_token. After this, cloud writes are
 * authenticated under auth.uid() and per-user RLS is enforced.
 *
 * The browser flow requires Supabase project setup (GitHub provider enabled,
 * localhost:47655..47659 in the redirect URL allow-list, schema reapplied).
 * Until that is verified end-to-end, --browser is opt-in only.
 *
 * Usage:
 *   infernoflow login                  default — device flow, identity only
 *   infernoflow login --browser        Supabase OAuth, authenticated cloud writes
 *   infernoflow logout
 *   infernoflow whoami
 */

import * as https      from "node:https";
import * as http       from "node:http";
import * as crypto     from "node:crypto";
import { execSync }    from "node:child_process";
import { bold, cyan, gray, green, red, yellow } from "../ui/output.mjs";
import {
  readCredentials,
  writeCredentials,
  deleteCredentials,
  isLoggedIn,
} from "../cloud/credentials.mjs";
import { SUPABASE_URL, getUser } from "../cloud/supabase.mjs";

// GitHub OAuth App Client ID (public — safe to embed)
const GITHUB_CLIENT_ID = "Ov23liYuUKwDRTzrywsa";

// Loopback port range we'll search through for the callback server.
// Picking a random port avoids collisions with apps that have specific
// allow-list redirect rules in their OAuth providers.
const PORT_RANGE = [47655, 47656, 47657, 47658, 47659];
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for the user to complete browser auth

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function postUrlencoded(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const opts = {
      hostname, port: 443, path, method: "POST",
      headers: {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Accept":         "application/json",
        "User-Agent":     "infernoflow-cli",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("timeout")));
    req.write(payload);
    req.end();
  });
}

function getJson(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, port: 443, path, method: "GET",
      headers: {
        "Accept":        "application/json",
        "User-Agent":    "infernoflow-cli",
        "Authorization": `Bearer ${token}`,
      },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function openBrowser(url) {
  try {
    const cmd = process.platform === "win32"  ? `start "" "${url}"`
              : process.platform === "darwin" ? `open "${url}"`
              :                                 `xdg-open "${url}"`;
    execSync(cmd, { stdio: "ignore" });
  } catch { /* user can copy/paste the URL manually */ }
}

function findAvailablePort(ports) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= ports.length) return reject(new Error("no available local port for callback"));
      const port = ports[i++];
      const probe = http.createServer();
      probe.on("error", () => tryNext());
      probe.listen(port, "127.0.0.1", () => {
        probe.close(() => resolve(port));
      });
    };
    tryNext();
  });
}

// ── Browser-based Supabase OAuth ───────────────────────────────────────────────

const CALLBACK_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>infernoflow login</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 24px; color: #0f1117; }
  .ok { color: #16a34a; }
  .err { color: #dc2626; }
  code { background: #f4f4f5; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
</style></head>
<body>
  <h2>🔥 infernoflow</h2>
  <p id="status">Completing login…</p>
  <script>
    (async () => {
      const status = document.getElementById('status');
      const hash = window.location.hash.substring(1);
      if (!hash) {
        const params = new URLSearchParams(window.location.search);
        const errMsg = params.get('error_description') || params.get('error') || 'No tokens received.';
        status.innerHTML = '<span class="err">✘ Login failed: ' + errMsg + '</span>';
        try { await fetch('/error?msg=' + encodeURIComponent(errMsg)); } catch (_) {}
        return;
      }
      try {
        const r = await fetch('/token', { method: 'POST', body: hash, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (r.ok) {
          status.innerHTML = '<span class="ok">✔ Logged in.</span> You can close this tab and return to your terminal.';
        } else {
          status.innerHTML = '<span class="err">✘ Forwarding failed (HTTP ' + r.status + ').</span>';
        }
      } catch (e) {
        status.innerHTML = '<span class="err">✘ Could not reach the local CLI: ' + e.message + '</span>';
      }
    })();
  </script>
</body></html>`;

async function browserLogin() {
  const port = await findAvailablePort(PORT_RANGE);
  const redirectUri = `http://localhost:${port}/callback`;
  const state       = crypto.randomBytes(16).toString("hex");

  const oauthUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  oauthUrl.searchParams.set("provider",    "github");
  oauthUrl.searchParams.set("redirect_to", redirectUri);
  oauthUrl.searchParams.set("scopes",      "read:user user:email");
  // We rely on Supabase's default implicit flow (tokens delivered in URL fragment).

  return new Promise((resolve, reject) => {
    let resolved = false;
    let server;

    const finish = (fn) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      try { server?.close(); } catch {}
      fn();
    };

    const timeoutHandle = setTimeout(() => {
      finish(() => reject(new Error("login timed out — close the browser tab and try again")));
    }, LOGIN_TIMEOUT_MS);

    server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${port}`);

      if (req.method === "GET" && u.pathname === "/callback") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(CALLBACK_HTML);
        return;
      }

      if (req.method === "POST" && u.pathname === "/token") {
        let body = "";
        req.on("data", c => body += c);
        req.on("end", () => {
          const params = new URLSearchParams(body);
          const access_token  = params.get("access_token");
          const refresh_token = params.get("refresh_token");
          const expires_in    = parseInt(params.get("expires_in") || "0", 10);
          const provider_token         = params.get("provider_token");
          const provider_refresh_token = params.get("provider_refresh_token");

          if (!access_token) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "no access_token in fragment" }));
            return;
          }

          res.writeHead(204);
          res.end();

          finish(() => resolve({
            access_token,
            refresh_token,
            expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
            provider_token,
            provider_refresh_token,
          }));
        });
        return;
      }

      if (req.method === "GET" && u.pathname === "/error") {
        const msg = u.searchParams.get("msg") || "unknown error";
        res.writeHead(204);
        res.end();
        finish(() => reject(new Error(msg)));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.on("error", err => finish(() => reject(err)));
    server.listen(port, "127.0.0.1", () => {
      console.log();
      console.log(`  ${bold("🔥 infernoflow login")}`);
      console.log();
      console.log(`  ${gray("Opening your browser to sign in with GitHub via Supabase…")}`);
      console.log();
      console.log(`  ${bold("If the browser doesn't open, paste this URL:")}`);
      console.log(`  ${cyan(oauthUrl.toString())}`);
      console.log();
      console.log(`  ${gray(`Listening for the callback on http://localhost:${port}/callback`)}`);
      console.log(`  ${gray("(this prompt will close automatically when you finish)")}`);
      console.log();
      openBrowser(oauthUrl.toString());
    });
  });
}

// ── Legacy GitHub Device Flow (identity-only fallback) ─────────────────────────

async function deviceFlowLogin() {
  console.log();
  console.log(`  ${bold("🔥 infernoflow login")} ${gray("(device-flow / identity-only)")}`);
  console.log();
  console.log(`  ${yellow("⚠")} ${gray("Device flow gives us your GitHub identity but no Supabase JWT.")}`);
  console.log(`  ${gray("Cloud writes will fall back to anon-key dev mode. Run without --device-flow")}`);
  console.log(`  ${gray("for the proper authenticated flow.")}`);
  console.log();

  let deviceData;
  try {
    deviceData = await postUrlencoded("github.com", "/login/device/code", {
      client_id: GITHUB_CLIENT_ID,
      scope:     "read:user user:email",
    });
  } catch (err) {
    throw new Error(`could not reach GitHub: ${err.message}`);
  }
  if (!deviceData.device_code) throw new Error(`GitHub error: ${JSON.stringify(deviceData)}`);

  const { device_code, user_code, verification_uri, expires_in, interval } = deviceData;
  const pollInterval = (interval || 5) * 1000;

  console.log(`  ${bold("Open:")} ${cyan(verification_uri)}`);
  console.log(`  ${bold("Code:")} ${bold(cyan(user_code))}`);
  console.log();
  openBrowser(verification_uri);
  console.log(`  ${gray("Waiting for you to authorize…")} ${gray("(Ctrl+C to cancel)")}`);
  console.log();

  const deadline = Date.now() + (expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(pollInterval);
    let poll;
    try {
      poll = await postUrlencoded("github.com", "/login/oauth/access_token", {
        client_id: GITHUB_CLIENT_ID,
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
    } catch { continue; }

    if (poll.error === "authorization_pending") continue;
    if (poll.error === "slow_down") { await sleep(5000); continue; }
    if (poll.error === "expired_token") throw new Error("code expired — run infernoflow login again");
    if (poll.error === "access_denied") throw new Error("access denied");
    if (poll.access_token) {
      const user = await getJson("api.github.com", "/user", poll.access_token);
      return {
        mode: "device-flow",
        github_access_token: poll.access_token,
        user: {
          provider: "github",
          login: user?.login || null,
          name:  user?.name  || null,
          email: user?.email || null,
          id:    user?.id    || null,
          avatar_url: user?.avatar_url || null,
        },
      };
    }
  }
  throw new Error("login timed out");
}

// ── Top-level login orchestrator ───────────────────────────────────────────────

async function doLogin(args) {
  if (isLoggedIn()) {
    const creds = readCredentials();
    const name  = creds?.user?.login || creds?.user?.name || creds?.user?.email || "unknown";
    console.log();
    console.log(`  ${green("✔")} Already logged in as ${bold(name)}`);
    console.log(`  Run ${cyan("infernoflow logout")} to sign out.`);
    console.log();
    return;
  }

  // Default flow: known-good GitHub Device Flow (identity-only, anon-key cloud writes).
  // Opt-in: --browser uses the new Supabase OAuth callback flow for authenticated cloud writes.
  // Note: --device-flow is also accepted as an explicit alias.
  const useBrowser = args.includes("--browser");
  const useDeviceFlow = !useBrowser; // default to device-flow until browser flow is proven

  let creds;
  try {
    if (useDeviceFlow) {
      const result = await deviceFlowLogin();
      creds = {
        mode: "device-flow",
        github_access_token: result.github_access_token,
        user: result.user,
        logged_in_at: new Date().toISOString(),
      };
    } else {
      const tokens = await browserLogin();
      // Get the Supabase user profile to enrich credentials
      const sbUser = await getUser(tokens.access_token).catch(() => null);
      creds = {
        mode: "supabase",
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at:    tokens.expires_at,
        provider_token: tokens.provider_token,
        provider_refresh_token: tokens.provider_refresh_token,
        user: sbUser ? {
          provider: "github",
          id:    sbUser.id || null,                            // Supabase auth.uid()
          email: sbUser.email || null,
          login: sbUser.user_metadata?.user_name
              || sbUser.user_metadata?.preferred_username
              || sbUser.identities?.[0]?.identity_data?.user_name
              || null,
          name:  sbUser.user_metadata?.full_name || sbUser.user_metadata?.name || null,
          avatar_url: sbUser.user_metadata?.avatar_url || null,
        } : { provider: "github" },
        logged_in_at: new Date().toISOString(),
      };
    }
  } catch (err) {
    console.log();
    console.log(`  ${red("✘")} Login failed: ${err.message}`);
    if (useBrowser) {
      console.log(`  ${gray("If --browser fails, fall back to the default flow:")} ${cyan("infernoflow login")}`);
    } else {
      console.log(`  ${gray("To try the experimental authenticated browser flow:")} ${cyan("infernoflow login --browser")}`);
    }
    console.log();
    process.exit(1);
  }

  writeCredentials(creds);

  const name = creds.user?.login || creds.user?.name || creds.user?.email || "unknown";
  console.log();
  console.log(`  ${green("✔")} Logged in as ${bold(name)}`);
  console.log();
  if (creds.mode === "supabase") {
    console.log(`  ${gray("Cloud sync is now authenticated. Every")} ${cyan("infernoflow log")} ${gray("writes under your auth.uid().")}`);
  } else {
    console.log(`  ${gray("Identity-only login (device flow). Cloud writes still use the anon-key dev mode.")}`);
  }
  console.log();
}

// ── logout ─────────────────────────────────────────────────────────────────────

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

// ── whoami ─────────────────────────────────────────────────────────────────────

function doWhoami() {
  const creds = readCredentials();
  console.log();
  if (!creds?.access_token && !creds?.github_access_token) {
    console.log(`  ${gray("Not logged in.")} Run ${cyan("infernoflow login")}`);
    console.log();
    return;
  }

  const name     = creds.user?.login || creds.user?.name || creds.user?.email || "unknown";
  const email    = creds.user?.email || gray("(no email)");
  const loggedIn = creds.logged_in_at ? new Date(creds.logged_in_at).toLocaleDateString() : "unknown";
  const mode     = creds.mode === "supabase" ? green("✔ authenticated (Supabase JWT)")
                  : creds.mode === "device-flow" ? yellow("⚠ identity-only (device flow)")
                  : gray("legacy");

  console.log(`  ${bold("🔥 infernoflow")} — logged in as:`);
  console.log();
  console.log(`  User:    ${bold(name)}`);
  console.log(`  Email:   ${email}`);
  console.log(`  Since:   ${gray(loggedIn)}`);
  console.log(`  Mode:    ${mode}`);
  if (creds.expires_at) {
    const expDate = new Date(creds.expires_at);
    const expired = Date.now() > expDate.getTime();
    console.log(`  Expires: ${gray(expDate.toLocaleString())}${expired ? " " + red("(expired — run login again)") : ""}`);
  }
  console.log();
}

// ── Entry point ────────────────────────────────────────────────────────────────

export async function loginCommand(rawArgs) {
  const sub = rawArgs[1];
  if (sub === "logout") return doLogout();
  if (sub === "whoami") return doWhoami();
  return doLogin(rawArgs);
}

export async function logoutCommand() { return doLogout(); }
export async function whoamiCommand()  { return doWhoami(); }
