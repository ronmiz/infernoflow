/**
 * infernoflow login / logout / whoami
 *
 * Uses GitHub Device Flow — no browser redirects, no PKCE complexity.
 * User gets a short code, visits github.com/login/device, types it in.
 * CLI polls until authorized, then saves the GitHub token.
 *
 * Usage:
 *   infernoflow login
 *   infernoflow logout
 *   infernoflow whoami
 */

import * as https  from "node:https";
import { bold, cyan, gray, green, red, yellow } from "../ui/output.mjs";
import {
  readCredentials,
  writeCredentials,
  deleteCredentials,
  isLoggedIn,
} from "../cloud/credentials.mjs";

// GitHub OAuth App Client ID (public — safe to embed)
// This is the infernoflow GitHub OAuth app
const GITHUB_CLIENT_ID = "Ov23liYuUKwDRTzrywsa";

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function post(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const opts = {
      hostname,
      port: 443,
      path,
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Accept":        "application/json",
        "User-Agent":    "infernoflow-cli",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); }
        catch { resolve(buf); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    req.write(payload);
    req.end();
  });
}

function get(hostname, path, token) {
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
        try { resolve(JSON.parse(buf)); }
        catch { resolve(buf); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function openBrowser(url) {
  try {
    const { execSync } = require("child_process");
    const cmd = process.platform === "win32"  ? `start "" "${url}"`
              : process.platform === "darwin" ? `open "${url}"`
              :                                 `xdg-open "${url}"`;
    execSync(cmd, { stdio: "ignore" });
  } catch {}
}

// ── login ──────────────────────────────────────────────────────────────────────

async function doLogin() {
  if (isLoggedIn()) {
    const creds = readCredentials();
    const name  = creds?.user?.login || creds?.user?.name || "unknown";
    console.log();
    console.log(`  ${green("✔")} Already logged in as ${bold(name)}`);
    console.log(`  Run ${cyan("infernoflow logout")} to sign out.`);
    console.log();
    return;
  }

  console.log();
  console.log(`  ${bold("🔥 infernoflow login")}`);
  console.log();

  // Step 1 — request device code
  let deviceData;
  try {
    deviceData = await post("github.com", "/login/device/code", {
      client_id: GITHUB_CLIENT_ID,
      scope:     "read:user user:email",
    });
  } catch (err) {
    console.log(`  ${red("✘")} Could not reach GitHub: ${err.message}`);
    console.log();
    process.exit(1);
  }

  if (!deviceData.device_code) {
    console.log(`  ${red("✘")} GitHub error: ${JSON.stringify(deviceData)}`);
    console.log();
    process.exit(1);
  }

  const { device_code, user_code, verification_uri, expires_in, interval } = deviceData;
  const pollInterval = (interval || 5) * 1000;

  // Step 2 — show the code to the user
  console.log(`  ${bold("Open this URL in your browser:")}`);
  console.log(`  ${cyan(verification_uri)}`);
  console.log();
  console.log(`  ${bold("Enter this code:")}`);
  console.log(`  ${bold(cyan(user_code))}`);
  console.log();

  openBrowser(verification_uri);

  console.log(`  ${gray("Waiting for you to authorize…")} ${gray("(Ctrl+C to cancel)")}`);
  console.log();

  // Step 3 — poll until authorized
  const deadline = Date.now() + (expires_in || 900) * 1000;

  while (Date.now() < deadline) {
    await sleep(pollInterval);

    let poll;
    try {
      poll = await post("github.com", "/login/oauth/access_token", {
        client_id:   GITHUB_CLIENT_ID,
        device_code,
        grant_type:  "urn:ietf:params:oauth:grant-type:device_code",
      });
    } catch {
      continue; // network blip — keep polling
    }

    if (poll.error === "authorization_pending") continue;
    if (poll.error === "slow_down") { await sleep(5000); continue; }
    if (poll.error === "expired_token") {
      console.log(`  ${red("✘")} Code expired. Run infernoflow login again.`);
      process.exit(1);
    }
    if (poll.error === "access_denied") {
      console.log(`  ${red("✘")} Access denied.`);
      process.exit(1);
    }

    if (poll.access_token) {
      // Step 4 — fetch GitHub user profile
      const user = await get("api.github.com", "/user", poll.access_token);
      const name = user?.login || user?.name || "unknown";

      const creds = {
        access_token:  poll.access_token,
        refresh_token: null,
        expires_at:    null, // GitHub tokens don't expire by default
        user,
        logged_in_at:  new Date().toISOString(),
      };

      writeCredentials(creds);

      console.log(`  ${green("✔")} Logged in as ${bold(name)}`);
      console.log();
      console.log(`  ${gray("Session memory will now sync to the cloud on every")} ${cyan("infernoflow log")}`);
      console.log();
      return;
    }
  }

  console.log(`  ${red("✘")} Login timed out. Run infernoflow login to try again.`);
  process.exit(1);
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
  if (!creds?.access_token) {
    console.log(`  ${gray("Not logged in.")} Run ${cyan("infernoflow login")}`);
    console.log();
    return;
  }

  const name     = creds.user?.login || creds.user?.name || "unknown";
  const email    = creds.user?.email || gray("(no email)");
  const loggedIn = creds.logged_in_at ? new Date(creds.logged_in_at).toLocaleDateString() : "unknown";

  console.log(`  ${bold("🔥 infernoflow")} — logged in as:`);
  console.log();
  console.log(`  User:    ${bold(name)}`);
  console.log(`  Email:   ${email}`);
  console.log(`  Since:   ${gray(loggedIn)}`);
  console.log(`  Status:  ${green("✔ Active")}`);
  console.log();
}

// ── Entry point ────────────────────────────────────────────────────────────────

export async function loginCommand(rawArgs) {
  const sub = rawArgs[1];
  if (sub === "logout") return doLogout();
  if (sub === "whoami") return doWhoami();
  return doLogin();
}

export async function logoutCommand() { return doLogout(); }
export async function whoamiCommand()  { return doWhoami(); }
