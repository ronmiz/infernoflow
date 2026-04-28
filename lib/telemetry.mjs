/**
 * infernoflow telemetry
 *
 * Opt-in, fire-and-forget usage analytics.
 *
 * What we collect (nothing else):
 *   ✅ command name (e.g. "log", "switch")
 *   ✅ anonymous install UUID (random, never linked to identity)
 *   ✅ infernoflow version
 *   ✅ Node version + OS platform
 *   ✅ timezone (geography estimation only)
 *   ✅ project type (frontend/backend/unknown — inferred from package.json)
 *   ✅ IDE (from env variables)
 *   ❌ no code, no file names, no personal data, no IP stored
 *
 * Backend: PostHog free tier (50K events/mo free, EU-hosted available)
 * Config:  ~/.infernoflow/telemetry.json
 * Events:  ~/.infernoflow/events.jsonl  (local mirror)
 *
 * Consent is requested lazily after 3 interactive runs.
 */

import * as fs    from "node:fs";
import * as path  from "node:path";
import * as os    from "node:os";
import * as https from "node:https";
import * as crypto from "node:crypto";

const CONFIG_DIR     = path.join(os.homedir(), ".infernoflow");
const TELEMETRY_FILE = path.join(CONFIG_DIR, "telemetry.json");
const EVENTS_FILE    = path.join(CONFIG_DIR, "events.jsonl");

const POSTHOG_HOST   = "https://eu.i.posthog.com";
const POSTHOG_KEY    = "phc_z6YX7x4zjkuFZigdXTBoFcPTWeGLFAN9NNKVZ5WHQrqk";

// ── Config helpers ────────────────────────────────────────────────────────────

function readConfig() {
  try { return JSON.parse(fs.readFileSync(TELEMETRY_FILE, "utf8")); }
  catch { return null; }
}

function writeConfig(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(data, null, 2), "utf8");
}

/** Generate a random anonymous install UUID — stored once, never changes */
function generateInstallId() {
  // Use crypto.randomUUID if available (Node 15.6+), else fallback
  try { return crypto.randomUUID(); }
  catch { return "ifl_" + crypto.randomBytes(16).toString("hex"); }
}

/** Get or create the persistent anonymous install ID */
function getOrCreateInstallId() {
  const cfg = readConfig() || {};
  if (cfg.installId) return cfg.installId;
  const installId = generateInstallId();
  writeConfig({ ...cfg, installId });
  return installId;
}

export function isTelemetryEnabled() {
  return readConfig()?.enabled === true;
}

export function hasConsentDecision() {
  const cfg = readConfig();
  return cfg !== null && typeof cfg.enabled === "boolean";
}

// ── Context detection ─────────────────────────────────────────────────────────

function detectIde() {
  if (process.env.CURSOR_SESSION)        return "cursor";
  if (process.env.COPILOT_SESSION)       return "copilot";
  if (process.env.CLAUDE_CODE_SESSION)   return "claude-code";
  if (process.env.WINDSURF_SESSION)      return "windsurf";
  if (process.env.TERM_PROGRAM === "vscode") return "vscode";
  return "unknown";
}

function detectProjectType() {
  try {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["next"] || deps["nuxt"] || deps["remix"])       return "fullstack";
    if (deps["react"] || deps["vue"] || deps["svelte"])      return "frontend";
    if (deps["express"] || deps["fastify"] || deps["koa"])   return "backend";
    if (deps["@angular/core"])                               return "frontend";
    return "js";
  } catch {
    return "unknown";
  }
}

function getTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
  catch { return "unknown"; }
}

function getVersion() {
  try {
    const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  } catch { return "unknown"; }
}

// ── Consent prompt ────────────────────────────────────────────────────────────

export async function ensureTelemetryConsent() {
  if (hasConsentDecision()) return;
  if (!process.stdin.isTTY) return;

  // Only ask after 3+ interactive runs — let the user experience it first
  const cfg  = readConfig() || {};
  const runs = (cfg.runs || 0) + 1;
  writeConfig({ ...cfg, runs, enabled: false });

  if (runs < 3) return;

  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const answer = await new Promise(resolve => {
    process.stdout.write(
      "\n  📡 Help improve infernoflow?\n" +
      "  Share anonymous usage data — command names, OS, timezone. No code. No personal data.\n" +
      "  Type 'y' to opt in, anything else to decline.  (infernoflow telemetry off to change later)\n" +
      "  → "
    );
    rl.question("", resolve);
  });
  rl.close();

  const enabled   = answer.trim().toLowerCase() === "y";
  const installId = enabled ? generateInstallId() : null;
  writeConfig({ enabled, installId, runs, decidedAt: new Date().toISOString() });

  process.stdout.write(
    enabled
      ? "  ✔ Telemetry enabled — thank you! (infernoflow telemetry off to disable)\n\n"
      : "  ✔ No problem — telemetry off. (infernoflow telemetry on to enable later)\n\n"
  );
}

// ── Event tracking ────────────────────────────────────────────────────────────

/**
 * Track a command invocation. Fire-and-forget — never throws, never blocks.
 * @param {string} command  e.g. "log", "switch", "recap"
 */
export function trackEvent(command) {
  if (!isTelemetryEnabled()) return;

  const installId = getOrCreateInstallId();

  const event = {
    ts:          new Date().toISOString(),
    command,
    installId,                     // anonymous UUID — links events from same install
    version:     getVersion(),
    node:        process.version,
    os:          process.platform,
    timezone:    getTimezone(),    // geography (continent/country) estimation
    ide:         detectIde(),
    projectType: detectProjectType(),
  };

  // 1. Mirror to local event log
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + "\n", "utf8");
  } catch {}

  // 2. Fire-and-forget to PostHog
  //    PostHog expects: { api_key, event, distinct_id, properties, timestamp }
  _postHog(installId, command, event);
}

function _postHog(distinctId, eventName, props) {
  try {
    const body = JSON.stringify({
      api_key:     POSTHOG_KEY,
      event:       eventName,
      distinct_id: distinctId,
      properties:  {
        command:      props.command,
        version:      props.version,
        node:         props.node,
        os:           props.os,
        timezone:     props.timezone,
        ide:          props.ide,
        projectType:  props.projectType,
        $lib:         "infernoflow-cli",
      },
      timestamp: props.ts,
    });

    const url = new URL(POSTHOG_HOST + "/capture/");
    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 3000,
    });
    req.on("error", () => {});  // never surface telemetry errors
    req.write(body);
    req.end();
  } catch {}
}

// ── CLI subcommand ────────────────────────────────────────────────────────────

export async function telemetryCommand(args) {
  const { bold, cyan, gray, green, yellow, red } = await import("./ui/output.mjs");
  const sub = args[0];

  if (sub === "on") {
    const cfg       = readConfig() || {};
    const installId = cfg.installId || generateInstallId();
    writeConfig({ ...cfg, enabled: true, installId, decidedAt: new Date().toISOString() });
    console.log(green("\n  ✔ Telemetry enabled — thank you for helping improve infernoflow!\n"));
    return;
  }

  if (sub === "off") {
    const cfg = readConfig() || {};
    writeConfig({ ...cfg, enabled: false, decidedAt: new Date().toISOString() });
    console.log(green("\n  ✔ Telemetry disabled. No data will be sent.\n"));
    return;
  }

  if (sub === "status" || !sub) {
    const cfg       = readConfig();
    const enabled   = cfg?.enabled === true;
    const decided   = cfg?.decidedAt ? new Date(cfg.decidedAt).toLocaleDateString() : "never";
    const installId = cfg?.installId ? cfg.installId.slice(0, 12) + "…" : "none yet";

    let eventCount = 0;
    try {
      eventCount = fs.readFileSync(EVENTS_FILE, "utf8").split("\n").filter(Boolean).length;
    } catch {}

    console.log("\n  " + bold("🔥 infernoflow telemetry status") + "\n");
    console.log("  Status        " + (enabled ? green("enabled") : yellow("disabled")));
    console.log("  Install ID    " + gray(installId + "  (anonymous, never linked to identity)"));
    console.log("  Decided       " + gray(decided));
    console.log("  Events stored " + gray(eventCount + " locally  →  " + (enabled ? "also sent to PostHog" : "not sent (disabled)")));
    console.log("  Backend       " + gray("PostHog (EU-hosted, no IP stored)"));
    console.log();
    console.log("  " + bold("What we collect:") + "  " + gray("command, version, Node, OS, timezone, IDE, project type"));
    console.log("  " + bold("What we never collect:") + "  " + gray("code, file names, capability names, email, personal data"));
    console.log();
    console.log(gray("  infernoflow telemetry on   — enable"));
    console.log(gray("  infernoflow telemetry off  — disable"));
    console.log();
    return;
  }

  console.error(red(`\n  ✘ Unknown subcommand: ${sub}`));
  console.log(gray("  Usage: infernoflow telemetry [on | off | status]\n"));
  process.exit(1);
}
