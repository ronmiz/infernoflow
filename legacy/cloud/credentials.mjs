/**
 * infernoflow cloud credentials manager
 *
 * Stores user auth at ~/.infernoflow/credentials.json. Never inside the project.
 *
 * v0.40+ schema:
 *   {
 *     mode: "supabase" | "device-flow" | undefined (legacy),
 *     access_token:  Supabase JWT (mode=supabase only),
 *     refresh_token: Supabase refresh token (mode=supabase only),
 *     expires_at:    ISO timestamp (mode=supabase only),
 *     github_access_token: GitHub OAuth token (mode=device-flow only),
 *     user: { provider, id, email, login, name, avatar_url, ... },
 *     logged_in_at: ISO timestamp,
 *   }
 *
 * Legacy schema (pre-v0.40) wrote `access_token` as a GitHub token directly,
 * with no `mode` field. We accept those for read but treat them as logged-in
 * with no Supabase JWT (fall back to anon-key writes).
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import * as os   from "node:os";

const CREDS_DIR  = path.join(os.homedir(), ".infernoflow");
const CREDS_FILE = path.join(CREDS_DIR, "credentials.json");

export function readCredentials() {
  try {
    if (!fs.existsSync(CREDS_FILE)) return null;
    return JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function writeCredentials(creds) {
  if (!fs.existsSync(CREDS_DIR)) {
    fs.mkdirSync(CREDS_DIR, { recursive: true });
  }
  fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
}

export function deleteCredentials() {
  try {
    if (fs.existsSync(CREDS_FILE)) fs.unlinkSync(CREDS_FILE);
    return true;
  } catch {
    return false;
  }
}

export function isLoggedIn() {
  const creds = readCredentials();
  if (!creds) return false;
  // v0.40+ supabase mode — needs a JWT (refresh logic handled elsewhere)
  if (creds.mode === "supabase" && creds.access_token) return true;
  // device-flow mode (identity only)
  if (creds.mode === "device-flow" && creds.github_access_token) return true;
  // Legacy schema (pre-v0.40 writes had no `mode` and used `access_token` for GitHub token)
  if (!creds.mode && creds.access_token) return true;
  return false;
}

/**
 * Returns the Supabase JWT if we have one and it isn't expired,
 * otherwise null. Used by pushEntry to choose between authenticated
 * and anon writes.
 *
 * Token refresh is intentionally NOT handled here — callers can call
 * `refreshSessionIfNeeded()` from supabase.mjs before this if they
 * want a guaranteed-fresh token. We keep this synchronous so log()
 * doesn't await unless it has to.
 */
export function getSupabaseAccessToken() {
  const creds = readCredentials();
  if (!creds || creds.mode !== "supabase" || !creds.access_token) return null;
  if (creds.expires_at) {
    const exp = Date.parse(creds.expires_at);
    if (!Number.isNaN(exp) && Date.now() > exp - 60_000) return null; // expired or within 1min
  }
  return creds.access_token;
}
