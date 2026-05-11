/**
 * infernoflow — Supabase REST client
 *
 * Zero external dependencies. Uses Node's built-in https module.
 * All calls are fire-and-forget safe — callers should catch errors.
 *
 * ── Auth model (v0.40+) ──────────────────────────────────────────────
 * Two write paths, transparently selected by pushEntry():
 *
 *   1. Authenticated (preferred): if ~/.infernoflow/credentials.json holds
 *      a non-expired Supabase JWT (mode=supabase), POST with that JWT in
 *      Authorization. user_id is set server-side from auth.uid() and the
 *      "Users own their entries" RLS policy is enforced.
 *
 *   2. Anon-token (fallback): legacy + device-flow path. POST with the
 *      public anon key, send a `user_token` text column derived from the
 *      GitHub identity. RLS bypassed via the "Anon can insert (dev mode)"
 *      policy. Fine for solo dev, not a security boundary.
 *
 * Tokens auto-refresh via /auth/v1/token?grant_type=refresh_token before
 * each authenticated push. If refresh fails we silently fall back to the
 * anon path so local logging never blocks.
 *
 * For self-hosters: replace SUPABASE_URL and SUPABASE_ANON_KEY with your
 * own project values after running scripts/supabase-schema.sql.
 */

import * as https from "node:https";
import {
  readCredentials,
  writeCredentials,
  getSupabaseAccessToken,
} from "./credentials.mjs";

// ── Supabase project config ──────────────────────────────────────────────────
export const SUPABASE_URL      = process.env.INFERNOFLOW_SUPABASE_URL      || "https://vscesbbtmrsctfroigyx.supabase.co";
export const SUPABASE_ANON_KEY = process.env.INFERNOFLOW_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzY2VzYmJ0bXJzY3Rmcm9pZ3l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0ODAxMjcsImV4cCI6MjA5MzA1NjEyN30.4WCXr0aGBlqC2m29DnlCSu5qKl0L-fDQoaV9AGu8-68";
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
    req.setTimeout(8_000, () => { req.destroy(new Error("timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Session refresh ──────────────────────────────────────────────────────────

/**
 * Refresh the Supabase JWT if it's within 5 minutes of expiry.
 * Mutates ~/.infernoflow/credentials.json on success.
 * Silently no-ops on any failure (caller will fall back to anon writes).
 */
export async function refreshSessionIfNeeded() {
  const creds = readCredentials();
  if (!creds || creds.mode !== "supabase" || !creds.refresh_token) return;

  const exp = creds.expires_at ? Date.parse(creds.expires_at) : 0;
  const fiveMin = 5 * 60 * 1000;
  if (Number.isFinite(exp) && Date.now() < exp - fiveMin) return; // still fresh

  try {
    const res = await httpsRequest(
      "POST",
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      { refresh_token: creds.refresh_token },
      { "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }
    );
    if (res.status !== 200 || !res.body?.access_token) return;
    const next = {
      ...creds,
      access_token:  res.body.access_token,
      refresh_token: res.body.refresh_token || creds.refresh_token,
      expires_at: res.body.expires_in
        ? new Date(Date.now() + res.body.expires_in * 1000).toISOString()
        : creds.expires_at,
    };
    writeCredentials(next);
  } catch {
    // Silently ignore — fall back to anon mode on next push
  }
}

// ── Push ─────────────────────────────────────────────────────────────────────

/**
 * Push a single session entry to Supabase.
 * Called silently after every `infernoflow log`. Never throws.
 *
 * Selects the auth path automatically:
 *   - JWT in credentials.json → authenticated write (user_id from auth.uid())
 *   - Otherwise               → anon-key write (user_token column, dev mode)
 *
 * @param {object} entry      { ts, type, summary, result, source, auto, agent, ... }
 * @param {string} userToken  GitHub identity (used by the anon-mode fallback)
 * @param {string} projectId  Per-project label
 */
export async function pushEntry(entry, userToken, projectId) {
  try {
    await refreshSessionIfNeeded();

    const jwt = getSupabaseAccessToken();
    const isAuth = Boolean(jwt);

    const row = {
      project_id:  projectId,
      ts:          entry.ts,
      type:        entry.type    || "note",
      summary:     entry.summary,
      result:      entry.result  || null,
      source:      entry.source  || null,
      auto:        entry.auto    || false,
      agent:       entry.agent   || null,
      // Anon-mode rows include user_token; authenticated rows let the database
      // populate user_id from auth.uid() via the column default.
      ...(isAuth ? {} : { user_token: userToken }),
    };

    await httpsRequest(
      "POST",
      `${SUPABASE_URL}/rest/v1/entries`,
      row,
      {
        "Authorization": `Bearer ${isAuth ? jwt : SUPABASE_ANON_KEY}`,
        "apikey":        SUPABASE_ANON_KEY,
        "Prefer":        "return=minimal",
      }
    );
  } catch {
    // Silently swallow — cloud push is best-effort, never blocks local work
  }
}

// ── User profile / pull (used by login + future sync commands) ───────────────

/** Fetch the current user's profile from Supabase. */
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
 * Pull all entries for this project from Supabase using the authenticated JWT.
 * Falls back to anon read (which only sees rows the policy allows) if not logged in.
 */
export async function pullEntries(projectId) {
  await refreshSessionIfNeeded();
  const jwt = getSupabaseAccessToken();
  const params = new URLSearchParams({
    project_id: `eq.${projectId}`,
    order:      "ts.asc",
    limit:      "10000",
  });
  const res = await httpsRequest(
    "GET",
    `${SUPABASE_URL}/rest/v1/entries?${params.toString()}`,
    null,
    { "Authorization": `Bearer ${jwt || SUPABASE_ANON_KEY}` }
  );
  if (res.status === 200 && Array.isArray(res.body)) return res.body;
  return [];
}

// ── Legacy helpers (kept for the abandoned PKCE flow + future use) ───────────

export async function exchangeCodeForSession(code) {
  const res = await httpsRequest(
    "POST",
    `${SUPABASE_URL}/auth/v1/token?grant_type=pkce`,
    { auth_code: code },
    {}
  );
  return res;
}

export function getOAuthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    provider:    "github",
    redirect_to: redirectUri,
    state,
  });
  return `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;
}
