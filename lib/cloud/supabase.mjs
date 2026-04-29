/**
 * infernoflow — Supabase REST client
 *
 * Zero external dependencies. Uses Node's built-in https module.
 * All calls are fire-and-forget safe — callers should catch errors.
 *
 * Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values
 * after running the schema in scripts/supabase-schema.sql.
 */

import * as https from "node:https";

// ── YOUR Supabase project config ──────────────────────────────────────────────
// Set these after creating your Supabase project
export const SUPABASE_URL      = process.env.INFERNOFLOW_SUPABASE_URL      || "https://vscesbbtmrsctfroigyx.supabase.co";
export const SUPABASE_ANON_KEY = process.env.INFERNOFLOW_SUPABASE_ANON_KEY || "sb_publishable_yThoZzOisgqLxrH8BOli-Q_yHVqEhUk";
// ─────────────────────────────────────────────────────────────────────────────

function httpsRequest(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "User-Agent":    "infernoflow-cli",
        "apikey":        SUPABASE_ANON_KEY,
        ...headers,
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(opts, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode, body: buf });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(new Error("timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Push a single session entry to Supabase.
 * Called silently after every `infernoflow log`.
 * Never throws — swallows all errors.
 */
export async function pushEntry(entry, userToken, projectId) {
  try {
    const row = {
      project_id:  projectId,
      user_token:  userToken,
      ts:          entry.ts,
      type:        entry.type    || "note",
      summary:     entry.summary,
      result:      entry.result  || null,
      source:      entry.source  || null,
      auto:        entry.auto    || false,
      agent:       entry.agent   || null,
    };

    await httpsRequest(
      "POST",
      `${SUPABASE_URL}/rest/v1/entries`,
      row,
      {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "apikey":        SUPABASE_ANON_KEY,
        "Prefer":        "return=minimal",
      }
    );
  } catch {
    // Silently swallow — cloud push is best-effort, never blocks local work
  }
}

/**
 * Exchange a login code for a Supabase session.
 * Used by the CLI login callback.
 */
export async function exchangeCodeForSession(code) {
  const res = await httpsRequest(
    "POST",
    `${SUPABASE_URL}/auth/v1/token?grant_type=pkce`,
    { auth_code: code },
    {}
  );
  return res;
}

/**
 * Get the GitHub OAuth URL to start the login flow.
 * The redirect_uri is our local callback server.
 */
export function getOAuthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    provider:    "github",
    redirect_to: redirectUri,
    state,
  });
  return `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;
}

/**
 * Fetch the current user's profile from Supabase.
 */
export async function getUser(accessToken) {
  const res = await httpsRequest(
    "GET",
    `${SUPABASE_URL}/auth/v1/user`,
    null,
    { "Authorization": `Bearer ${accessToken}` }
  );
  if (res.status === 200) return res.body;
  return null;
}

/**
 * Pull all entries for this project from Supabase.
 */
export async function pullEntries(accessToken, projectId) {
  const params = new URLSearchParams({
    project_id: `eq.${projectId}`,
    order:      "ts.asc",
    limit:      "10000",
  });

  const res = await httpsRequest(
    "GET",
    `${SUPABASE_URL}/rest/v1/entries?${params.toString()}`,
    null,
    { "Authorization": `Bearer ${accessToken}` }
  );

  if (res.status === 200 && Array.isArray(res.body)) return res.body;
  return [];
}
