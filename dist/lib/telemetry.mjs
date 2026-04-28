/**
 * infernoflow telemetry
 *
 * Opt-in, fire-and-forget usage analytics.
 *
 * - Stored in ~/.infernoflow/telemetry.json
 * - Never enabled without explicit consent
 * - Never blocks the CLI — all sends are async / best-effort
 * - Never sends code, file contents, capability names, or personal data
 *   Only sends: command name, infernoflow version, Node version, OS platform
 *
 * Consent is requested lazily on the first interactive infernoflow run
 * after install (if no consent decision is stored).
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import * as os   from "node:os";
import * as https from "node:https";

const CONFIG_DIR    = path.join(os.homedir(), ".infernoflow");
const TELEMETRY_FILE = path.join(CONFIG_DIR, "telemetry.json");
const EVENTS_FILE    = path.join(CONFIG_DIR, "events.jsonl");

const ENDPOINT = "https://telemetry.infernoflow.dev/v1/event"; // placeholder

// ── Config helpers ────────────────────────────────────────────────────────────

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(TELEMETRY_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeConfig(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(data, null, 2), "utf8");
}

/** Returns true if the user has opted in */
export function isTelemetryEnabled() {
  const cfg = readConfig();
  return cfg?.enabled === true;
}

/** Returns true if the user has made a consent decision (either way) */
export function hasConsentDecision() {
  const cfg = readConfig();
  return cfg !== null && typeof cfg.enabled === "boolean";
}

// ── Consent prompt ────────────────────────────────────────────────────────────

/**
 * Silently skip if consent already given, or if running non-interactively.
 * Call this once at the start of each interactive CLI run.
 */
export async function ensureTelemetryConsent() {
  if (hasConsentDecision()) return;
  if (!process.stdin.isTTY) return;

  // Only ask after 3+ runs (let the user experience it first)
  const cfg = readConfig() || {};
  const runs = (cfg.runs || 0) + 1;
  writeConfig({ ...cfg, runs, enabled: false }); // default off until explicit consent

  if (runs < 3) return;

  // Show one-time prompt
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const answer = await new Promise(resolve => {
    process.stdout.write(
      "\n  📡 Help improve infernoflow?\n" +
      "  Share anonymous usage data (command names only — no code, no content).\n" +
      "  Type 'y' to opt in, any other key to decline. You can change this later with: infernoflow telemetry on/off\n" +
      "  → "
    );
    rl.question("", resolve);
  });
  rl.close();

  const enabled = answer.trim().toLowerCase() === "y";
  writeConfig({ enabled, runs, decidedAt: new Date().toISOString() });

  if (enabled) {
    process.stdout.write("  ✔ Telemetry enabled — thank you! (infernoflow telemetry off to disable)\n\n");
  } else {
    process.stdout.write("  ✔ Got it — telemetry off. (infernoflow telemetry on to enable later)\n\n");
  }
}

// ── Event tracking ────────────────────────────────────────────────────────────

/** Get current package version */
function getVersion() {
  try {
    const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  } catch {
    return "unknown";
  }
}

/**
 * Track a command invocation. Fire-and-forget — never throws, never blocks.
 * @param {string} command  The command name (e.g. "log", "switch", "recap")
 */
export function trackEvent(command) {
  if (!isTelemetryEnabled()) return;

  const event = {
    ts:      new Date().toISOString(),
    command,
    version: getVersion(),
    node:    process.version,
    os:      process.platform,
  };

  // Always append to local event log first
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + "\n", "utf8");
  } catch {}

  // Fire-and-forget HTTP POST (best effort — no await)
  try {
    const body = JSON.stringify(event);
    const url  = new URL(ENDPOINT);
    const req  = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout:  3000,
    });
    req.on("error", () => {}); // silently ignore all errors
    req.write(body);
    req.end();
  } catch {}
}

// ── CLI subcommand ────────────────────────────────────────────────────────────

export async function telemetryCommand(args) {
  const { bold, cyan, gray, green, yellow, red } = await import("./ui/output.mjs");
  const sub = args[0];

  if (sub === "on") {
    const cfg = readConfig() || {};
    writeConfig({ ...cfg, enabled: true, decidedAt: new Date().toISOString() });
    console.log(green("\n  ✔ Telemetry enabled — thank you for helping improve infernoflow!\n"));
    return;
  }

  if (sub === "off") {
    const cfg = readConfig() || {};
    writeConfig({ ...cfg, enabled: false, decidedAt: new Date().toISOString() });
    console.log(green("\n  ✔ Telemetry disabled.\n"));
    return;
  }

  if (sub === "status" || !sub) {
    const cfg = readConfig();
    const enabled = cfg?.enabled === true;
    const decided = cfg?.decidedAt ? new Date(cfg.decidedAt).toLocaleDateString() : "never";

    // Count local events
    let eventCount = 0;
    try {
      const lines = fs.readFileSync(EVENTS_FILE, "utf8").split("\n").filter(Boolean);
      eventCount = lines.length;
    } catch {}

    console.log("\n  " + bold("🔥 infernoflow telemetry status") + "\n");
    console.log("  Telemetry     " + (enabled ? green("enabled") : yellow("disabled")));
    console.log("  Decided       " + gray(decided));
    console.log("  Events logged " + gray(eventCount + " (local only until enabled)"));
    console.log("  Data sent     " + gray("command name, infernoflow version, Node version, OS platform"));
    console.log("  Data never    " + gray("code, file names, capability names, email, personal data"));
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
