/**
 * infernoflow cloud credentials manager
 *
 * Stores user auth token at ~/.infernoflow/credentials.json
 * Never stores credentials inside the project repo.
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
  if (!creds?.access_token) return false;
  // Check expiry if present
  if (creds.expires_at) {
    const expiresAt = new Date(creds.expires_at).getTime();
    if (Date.now() > expiresAt - 60_000) return false; // expired or within 1 min
  }
  return true;
}
