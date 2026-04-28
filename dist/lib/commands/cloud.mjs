/**
 * infernoflow cloud
 *
 * Sync capability contracts with the infernoflow cloud service.
 * A hosted alternative to `team-sync` (which uses a shared git branch).
 *
 * Sub-commands:
 *   cloud init                 Generate a project token and write inferno/.cloud.json
 *   cloud push                 Upload local contract to cloud
 *   cloud push --memory        Also push session memory (sessions.jsonl) — Pro tier value prop
 *   cloud pull                 Download latest contract from cloud
 *   cloud pull --memory        Also pull session memory — restores inferno/sessions.jsonl
 *   cloud memory push          Push session memory only
 *   cloud memory pull          Pull session memory only
 *   cloud memory status        Compare local vs remote memory entry count
 *   cloud status               Show local vs cloud diff
 *   cloud dashboard            Print hosted dashboard URL
 *
 * Flags:
 *   --token <tok>              Override token from env INFERNOFLOW_TOKEN
 *   --endpoint <url>           Override default endpoint
 *   --dry-run                  Print what would happen without sending
 *   --json                     Machine-readable output
 *   --memory                   Include session memory (sessions.jsonl) in push/pull
 *
 * Usage:
 *   infernoflow cloud init
 *   infernoflow cloud push
 *   infernoflow cloud push --memory
 *   infernoflow cloud pull --memory
 *   infernoflow cloud memory status --json
 */

import * as fs     from "node:fs";
import * as path   from "node:path";
import * as https  from "node:https";
import * as http   from "node:http";
import * as crypto from "node:crypto";
import { header, ok, warn, info, done, bold, cyan, gray, green, red, yellow } from "../ui/output.mjs";

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "https://cloud.infernoflow.dev";
const CLOUD_CONFIG_FILE = ".cloud.json";

function readCloudConfig(infernoDir) {
  const p = path.join(infernoDir, CLOUD_CONFIG_FILE);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writeCloudConfig(infernoDir, config) {
  const p = path.join(infernoDir, CLOUD_CONFIG_FILE);
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + "\n");
}

function getToken(config, args) {
  const idx = args.indexOf("--token");
  if (idx !== -1) return args[idx + 1];
  return process.env.INFERNOFLOW_TOKEN || config?.token || null;
}

function getEndpoint(config, args) {
  const idx = args.indexOf("--endpoint");
  if (idx !== -1) return args[idx + 1];
  return process.env.INFERNOFLOW_ENDPOINT || config?.endpoint || DEFAULT_ENDPOINT;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpsRequest(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib     = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ""),
      method,
      headers: {
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "User-Agent":    "infernoflow-cli",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Contract helpers ──────────────────────────────────────────────────────────

function readContract(infernoDir) {
  const candidates = ["contract.json", "capabilities.json"];
  for (const f of candidates) {
    const p = path.join(infernoDir, f);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    }
  }
  return null;
}

function contractHash(contract) {
  return crypto.createHash("sha256").update(JSON.stringify(contract)).digest("hex").slice(0, 12);
}

// ── Session memory helpers ────────────────────────────────────────────────────

const SESSIONS_FILE = "sessions.jsonl";

function readMemory(infernoDir) {
  const p = path.join(infernoDir, SESSIONS_FILE);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8")
    .split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function writeMemory(infernoDir, entries) {
  const p = path.join(infernoDir, SESSIONS_FILE);
  fs.writeFileSync(p, entries.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

function memoryHash(entries) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(entries.map(e => e.ts + e.summary)))
    .digest("hex").slice(0, 12);
}

/**
 * Merge remote memory with local — union by (ts, summary) deduplication.
 * Keeps all local entries + any remote entries not already present.
 */
function mergeMemory(local, remote) {
  const localKeys = new Set(local.map(e => `${e.ts}|${e.summary}`));
  const merged = [...local];
  for (const e of remote) {
    if (!localKeys.has(`${e.ts}|${e.summary}`)) {
      merged.push(e);
    }
  }
  return merged.sort((a, b) => a.ts.localeCompare(b.ts));
}

// ── Memory push/pull ──────────────────────────────────────────────────────────

async function pushMemory(args, infernoDir, config, quietly = false) {
  const jsonMode = args.includes("--json");
  const dryRun   = args.includes("--dry-run");
  const token    = getToken(config, args);
  const endpoint = getEndpoint(config, args);
  const projectId = config?.projectId;

  if (!token || !projectId) {
    const msg = "No token/project found. Run: infernoflow cloud init";
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }));
    else if (!quietly) warn(msg);
    return { ok: false };
  }

  const entries = readMemory(infernoDir);
  if (!entries.length) {
    if (!quietly && !jsonMode) info("No session memory to push (inferno/sessions.jsonl is empty).");
    return { ok: true, entries: 0 };
  }

  const hash = memoryHash(entries);

  if (dryRun) {
    if (jsonMode) console.log(JSON.stringify({ ok: true, dryRun: true, entries: entries.length, hash }));
    else if (!quietly) info(`Dry run — would push ${bold(String(entries.length))} memory entries (hash: ${hash})`);
    return { ok: true, dryRun: true };
  }

  try {
    const resp = await httpsRequest(
      "PUT",
      `${endpoint}/api/projects/${projectId}/memory`,
      { entries, hash, pushedAt: new Date().toISOString() },
      token
    );
    const ok_flag = resp.status === 200 || resp.status === 201 || resp.status === 204;
    if (jsonMode) console.log(JSON.stringify({ ok: ok_flag, entries: entries.length, hash }));
    else if (!quietly) {
      if (ok_flag) ok(`Pushed ${bold(String(entries.length))} memory entries`);
      else warn(`Cloud returned ${resp.status}`);
    }
    return { ok: ok_flag, entries: entries.length };
  } catch (err) {
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: err.message }));
    else if (!quietly) warn(`Memory push failed: ${err.message}`);
    return { ok: false };
  }
}

async function pullMemory(args, infernoDir, config, quietly = false) {
  const jsonMode = args.includes("--json");
  const dryRun   = args.includes("--dry-run");
  const token    = getToken(config, args);
  const endpoint = getEndpoint(config, args);
  const projectId = config?.projectId;
  const forceOverwrite = args.includes("--force") || args.includes("-f");

  if (!token || !projectId) {
    const msg = "No token/project found. Run: infernoflow cloud init";
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }));
    else if (!quietly) warn(msg);
    return { ok: false };
  }

  try {
    const resp = await httpsRequest(
      "GET",
      `${endpoint}/api/projects/${projectId}/memory`,
      null,
      token
    );

    if (resp.status !== 200) {
      const errMsg = `Cloud returned ${resp.status}`;
      if (jsonMode) console.log(JSON.stringify({ ok: false, error: errMsg }));
      else if (!quietly) warn(errMsg);
      return { ok: false };
    }

    const remote = resp.body?.entries;
    if (!remote || !remote.length) {
      if (!quietly && !jsonMode) info("No session memory in cloud yet. Push first.");
      return { ok: true, entries: 0 };
    }

    const local   = readMemory(infernoDir);
    const merged  = forceOverwrite ? remote : mergeMemory(local, remote);
    const newCount = merged.length - local.length;

    if (dryRun) {
      if (jsonMode) console.log(JSON.stringify({ ok: true, dryRun: true, remote: remote.length, local: local.length, merged: merged.length }));
      else if (!quietly) info(`Dry run — would merge ${bold(String(remote.length))} remote + ${bold(String(local.length))} local = ${bold(String(merged.length))} entries`);
      return { ok: true, dryRun: true };
    }

    writeMemory(infernoDir, merged);

    if (jsonMode) console.log(JSON.stringify({ ok: true, remote: remote.length, local: local.length, merged: merged.length, newEntries: newCount }));
    else if (!quietly) ok(`Merged ${bold(String(remote.length))} remote entries → ${bold(String(merged.length))} total (${newCount} new)`);
    return { ok: true, entries: merged.length };
  } catch (err) {
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: err.message }));
    else if (!quietly) warn(`Memory pull failed: ${err.message}`);
    return { ok: false };
  }
}

async function subcmdMemory(args, cwd, infernoDir) {
  const jsonMode = args.includes("--json");
  const config   = readCloudConfig(infernoDir);
  const token    = getToken(config, args);
  const endpoint = getEndpoint(config, args);

  const sub2 = args[0];
  const sub2Args = args.slice(1);

  if (sub2 === "push") {
    if (!jsonMode) header("Pushing session memory to cloud");
    return pushMemory(sub2Args, infernoDir, config);
  }

  if (sub2 === "pull") {
    if (!jsonMode) header("Pulling session memory from cloud");
    return pullMemory(sub2Args, infernoDir, config);
  }

  if (sub2 === "status" || !sub2) {
    const local = readMemory(infernoDir);
    const projectId = config?.projectId;

    if (!config || !token) {
      if (jsonMode) console.log(JSON.stringify({ ok: false, error: "Not initialised. Run: infernoflow cloud init" }));
      else warn("Cloud not configured. Run: infernoflow cloud init");
      return;
    }

    let remoteCount = null;
    let remoteHash  = null;
    let reachable   = false;

    try {
      const resp = await httpsRequest("GET", `${endpoint}/api/projects/${projectId}/memory`, null, token);
      if (resp.status === 200 && resp.body?.entries) {
        reachable   = true;
        remoteCount = resp.body.entries.length;
        remoteHash  = memoryHash(resp.body.entries);
      }
    } catch {}

    const localHash = local.length ? memoryHash(local) : null;

    if (jsonMode) {
      console.log(JSON.stringify({
        ok: true,
        local:  { entries: local.length, hash: localHash },
        remote: reachable ? { entries: remoteCount, hash: remoteHash } : null,
        reachable,
        inSync: localHash === remoteHash,
      }));
      return;
    }

    console.log();
    console.log(`  ${bold("infernoflow cloud memory status")}`);
    console.log();
    console.log(`  Local:  ${bold(String(local.length))} entries  ${gray("(hash: " + (localHash || "none") + ")")}`);
    if (!reachable) {
      console.log(`  Cloud:  ${yellow("unreachable")}`);
    } else {
      console.log(`  Cloud:  ${bold(String(remoteCount))} entries  ${gray("(hash: " + (remoteHash || "none") + ")")}`);
      if (localHash === remoteHash) console.log(`\n  ${green("✔")}  Memory in sync`);
      else console.log(`\n  ${yellow("⚠")}  Out of sync — run ${cyan("infernoflow cloud memory push")} or ${cyan("infernoflow cloud memory pull")}`);
    }
    console.log();
    return;
  }

  console.log();
  console.log(`  ${bold("infernoflow cloud memory")} — session memory sync`);
  console.log();
  console.log(`  ${cyan("infernoflow cloud memory push")}    Upload sessions.jsonl to cloud`);
  console.log(`  ${cyan("infernoflow cloud memory pull")}    Download + merge remote memory`);
  console.log(`  ${cyan("infernoflow cloud memory status")}  Compare local vs remote`);
  console.log();
}

// ── Sub-commands ──────────────────────────────────────────────────────────────

async function subcmdInit(args, cwd, infernoDir) {
  const jsonMode = args.includes("--json");
  const endpoint = getEndpoint(null, args);
  const dryRun   = args.includes("--dry-run");

  // Check for existing config
  const existing = readCloudConfig(infernoDir);
  if (existing && !args.includes("--force") && !args.includes("-f")) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: "Already initialised. Use --force to overwrite.", config: existing }));
    } else {
      warn("Cloud already configured for this project.");
      console.log(`  Token:    ${gray(existing.token)}`);
      console.log(`  Endpoint: ${gray(existing.endpoint)}`);
      console.log(`  Project:  ${gray(existing.projectId)}`);
      console.log();
      info("Use --force to generate a new token.");
    }
    return;
  }

  // Generate a project ID and token
  const projectId = crypto.randomBytes(8).toString("hex");
  const token     = crypto.randomBytes(24).toString("base64url");

  const config = {
    projectId,
    token,
    endpoint,
    createdAt: new Date().toISOString(),
  };

  if (dryRun) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, dryRun: true, config }));
    } else {
      info("Dry run — would write inferno/.cloud.json:");
      console.log("  " + JSON.stringify(config, null, 2).split("\n").join("\n  "));
    }
    return;
  }

  if (!jsonMode) header("Initialising infernoflow cloud");

  // Register project with cloud endpoint (best-effort)
  try {
    const resp = await httpsRequest("POST", `${endpoint}/api/projects`, { projectId }, null);
    if (resp.status === 200 || resp.status === 201) {
      if (!jsonMode) ok("Project registered on cloud");
    }
  } catch {
    if (!jsonMode) info("Cloud endpoint unreachable — saved config locally (will connect on first push)");
  }

  writeCloudConfig(infernoDir, config);

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, projectId, endpoint }));
  } else {
    done("Cloud configured!");
    console.log();
    console.log(`  Project ID: ${cyan(projectId)}`);
    console.log(`  Endpoint:   ${gray(endpoint)}`);
    console.log(`  Token:      ${gray(token.slice(0, 8) + "…")} (stored in inferno/.cloud.json)`);
    console.log();
    console.log(`  ${gray("Share the dashboard:")} ${cyan(`${endpoint}/p/${projectId}`)}`);
    console.log();
    console.log(`  ${yellow("⚠")}  Add inferno/.cloud.json to .gitignore to protect your token!`);
    console.log(`     ${gray("echo 'inferno/.cloud.json' >> .gitignore")}`);
    console.log();
  }
}

async function subcmdPush(args, cwd, infernoDir) {
  const jsonMode = args.includes("--json");
  const dryRun   = args.includes("--dry-run");
  const config   = readCloudConfig(infernoDir);
  const token    = getToken(config, args);
  const endpoint = getEndpoint(config, args);

  if (!token) {
    const msg = "No token found. Run: infernoflow cloud init";
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: msg })); } else { warn(msg); }
    process.exit(1);
  }

  const contract = readContract(infernoDir);
  if (!contract) {
    const msg = "No contract.json found. Run: infernoflow init";
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: msg })); } else { warn(msg); }
    process.exit(1);
  }

  const projectId = config?.projectId || "unknown";
  const hash      = contractHash(contract);
  const caps      = (contract.capabilities || []).length;

  if (dryRun) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, dryRun: true, projectId, hash, capabilities: caps }));
    } else {
      info(`Dry run — would push ${bold(String(caps))} capabilities (hash: ${hash}) to ${endpoint}`);
    }
    return;
  }

  if (!jsonMode) header("Pushing contract to cloud");

  try {
    const resp = await httpsRequest(
      "PUT",
      `${endpoint}/api/projects/${projectId}/contract`,
      { contract, hash, pushedAt: new Date().toISOString() },
      token
    );

    if (resp.status === 200 || resp.status === 201 || resp.status === 204) {
      if (jsonMode) {
        console.log(JSON.stringify({ ok: true, projectId, hash, capabilities: caps }));
      } else {
        done(`Pushed ${bold(String(caps))} capabilities`);
        console.log(`  ${gray("Dashboard:")} ${cyan(`${endpoint}/p/${projectId}`)}`);
        console.log();
      }

      // Also push session memory if --memory flag set
      if (args.includes("--memory")) {
        if (!jsonMode) info("Pushing session memory...");
        await pushMemory(args, infernoDir, config, jsonMode);
        if (!jsonMode) ok("Session memory pushed");
      }
    } else {
      const errMsg = `Cloud returned ${resp.status}`;
      if (jsonMode) { console.log(JSON.stringify({ ok: false, error: errMsg, status: resp.status })); }
      else { warn(errMsg); }
      process.exit(1);
    }
  } catch (err) {
    // Cloud unreachable — save a pending push marker
    const pendingPath = path.join(infernoDir, ".cloud-pending.json");
    fs.writeFileSync(pendingPath, JSON.stringify({ hash, pendingAt: new Date().toISOString() }));

    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: err.message, pending: true }));
    } else {
      warn("Cloud unreachable — push queued locally.");
      info("Changes will sync automatically on next successful connection.");
    }
  }
}

async function subcmdPull(args, cwd, infernoDir) {
  const jsonMode = args.includes("--json");
  const dryRun   = args.includes("--dry-run");
  const config   = readCloudConfig(infernoDir);
  const token    = getToken(config, args);
  const endpoint = getEndpoint(config, args);

  if (!token) {
    const msg = "No token found. Run: infernoflow cloud init";
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: msg })); } else { warn(msg); }
    process.exit(1);
  }

  const projectId = config?.projectId || "unknown";

  if (!jsonMode) header("Pulling contract from cloud");

  try {
    const resp = await httpsRequest(
      "GET",
      `${endpoint}/api/projects/${projectId}/contract`,
      null,
      token
    );

    if (resp.status !== 200) {
      const errMsg = `Cloud returned ${resp.status}`;
      if (jsonMode) { console.log(JSON.stringify({ ok: false, error: errMsg })); }
      else { warn(errMsg); }
      process.exit(1);
    }

    const remote   = resp.body?.contract;
    const localRaw = readContract(infernoDir);

    if (!remote) {
      const msg = "No contract found on cloud. Push first.";
      if (jsonMode) { console.log(JSON.stringify({ ok: false, error: msg })); }
      else { warn(msg); }
      return;
    }

    // Detect conflicts (same capability changed on both sides)
    const localCaps  = (localRaw?.capabilities || []).map(c => typeof c === "string" ? c : c.id);
    const remoteCaps = (remote.capabilities   || []).map(c => typeof c === "string" ? c : c.id);
    const localSet   = new Set(localCaps);
    const remoteSet  = new Set(remoteCaps);
    const onlyLocal  = localCaps.filter(id => !remoteSet.has(id));
    const onlyRemote = remoteCaps.filter(id => !localSet.has(id));

    if (onlyLocal.length > 0 && onlyRemote.length > 0) {
      if (!jsonMode) {
        warn("Diverged contracts detected:");
        onlyLocal.forEach(id => console.log(`  ${red("-")} local-only:  ${id}`));
        onlyRemote.forEach(id => console.log(`  ${green("+")} remote-only: ${id}`));
        console.log();
        warn("Merge manually or use --force to overwrite local with remote.");
      } else {
        console.log(JSON.stringify({
          ok: false,
          conflict: true,
          onlyLocal,
          onlyRemote,
        }));
      }
      if (!args.includes("--force") && !args.includes("-f")) return;
    }

    if (dryRun) {
      if (jsonMode) {
        console.log(JSON.stringify({ ok: true, dryRun: true, capabilities: remoteCaps.length, hash: contractHash(remote) }));
      } else {
        info(`Dry run — would write ${bold(String(remoteCaps.length))} capabilities from cloud`);
      }
      return;
    }

    // Write pulled contract
    const contractPath = path.join(infernoDir, "contract.json");
    fs.writeFileSync(contractPath, JSON.stringify(remote, null, 2) + "\n");

    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, capabilities: remoteCaps.length, hash: contractHash(remote) }));
    } else {
      done(`Pulled ${bold(String(remoteCaps.length))} capabilities from cloud`);
      if (onlyLocal.length) warn(`${onlyLocal.length} local-only capabilities were overwritten.`);
      console.log();
    }

    // Also pull session memory if --memory flag set
    if (args.includes("--memory")) {
      if (!jsonMode) info("Pulling session memory...");
      await pullMemory(args, infernoDir, config, jsonMode);
    }
  } catch (err) {
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: err.message })); }
    else { warn(`Cloud unreachable: ${err.message}`); }
    process.exit(1);
  }
}

async function subcmdStatus(args, cwd, infernoDir) {
  const jsonMode = args.includes("--json");
  const config   = readCloudConfig(infernoDir);
  const token    = getToken(config, args);
  const endpoint = getEndpoint(config, args);

  if (!config) {
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: "Not initialised. Run: infernoflow cloud init" })); }
    else { warn("Cloud not configured. Run: infernoflow cloud init"); }
    return;
  }

  const projectId  = config.projectId;
  const localContract = readContract(infernoDir);
  const localHash  = localContract ? contractHash(localContract) : null;
  const localCaps  = (localContract?.capabilities || []).length;

  if (!jsonMode) header("Cloud status");

  let remoteHash = null;
  let remoteCaps = 0;
  let reachable  = false;

  try {
    const resp = await httpsRequest(
      "GET",
      `${endpoint}/api/projects/${projectId}/contract`,
      null,
      token
    );
    if (resp.status === 200 && resp.body?.contract) {
      reachable  = true;
      remoteHash = contractHash(resp.body.contract);
      remoteCaps = (resp.body.contract?.capabilities || []).length;
    }
  } catch {}

  const inSync = localHash === remoteHash;
  const pending = fs.existsSync(path.join(infernoDir, ".cloud-pending.json"));

  if (jsonMode) {
    console.log(JSON.stringify({
      ok: true,
      projectId,
      endpoint,
      reachable,
      inSync,
      pending,
      local:  { hash: localHash, capabilities: localCaps },
      remote: reachable ? { hash: remoteHash, capabilities: remoteCaps } : null,
    }));
    return;
  }

  console.log(`  Project:   ${cyan(projectId)}`);
  console.log(`  Endpoint:  ${gray(endpoint)}`);
  console.log(`  Dashboard: ${cyan(`${endpoint}/p/${projectId}`)}`);
  console.log();
  console.log(`  Local:     ${bold(String(localCaps))} capabilities  ${gray("(hash: " + (localHash || "none") + ")")}`);

  if (!reachable) {
    console.log(`  Cloud:     ${yellow("unreachable")}`);
  } else {
    console.log(`  Cloud:     ${bold(String(remoteCaps))} capabilities  ${gray("(hash: " + (remoteHash || "none") + ")")}`);
    console.log();
    if (inSync) {
      console.log(`  ${green("✔")}  In sync with cloud`);
    } else {
      console.log(`  ${yellow("⚠")}  Out of sync — run ${cyan("infernoflow cloud push")} or ${cyan("infernoflow cloud pull")}`);
    }
  }

  if (pending) {
    console.log(`  ${yellow("⚠")}  Pending push queued (cloud was unreachable last time)`);
  }

  console.log();
}

async function subcmdDashboard(args, cwd, infernoDir) {
  const config    = readCloudConfig(infernoDir);
  const endpoint  = getEndpoint(config, args);
  const projectId = config?.projectId;
  const jsonMode  = args.includes("--json");

  if (!projectId) {
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: "Run: infernoflow cloud init first" })); }
    else { warn("Not configured. Run: infernoflow cloud init first."); }
    return;
  }

  const url = `${endpoint}/p/${projectId}`;

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, url }));
    return;
  }

  console.log();
  console.log(`  ${bold("🔥 infernoflow cloud dashboard")}`);
  console.log();
  console.log(`  ${cyan(url)}`);
  console.log();
  console.log(`  ${gray("Share this URL with your whole team.")}`);
  console.log();

  // Try to open in browser
  try {
    const { execSync } = await import("node:child_process");
    const cmd = process.platform === "win32" ? `start "" "${url}"` :
                process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    execSync(cmd, { stdio: "ignore" });
  } catch {}
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cloudCommand(rawArgs) {
  const args       = rawArgs.slice(1);
  const subcmd     = args[0];
  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  if (!fs.existsSync(infernoDir)) {
    const msg = "inferno/ directory not found. Run: infernoflow init";
    if (args.includes("--json")) { console.log(JSON.stringify({ ok: false, error: msg })); }
    else { warn(msg); }
    process.exit(1);
  }

  const subArgs = args.slice(1);

  switch (subcmd) {
    case "init":
      return subcmdInit(subArgs, cwd, infernoDir);
    case "push":
      return subcmdPush(subArgs, cwd, infernoDir);
    case "pull":
      return subcmdPull(subArgs, cwd, infernoDir);
    case "status":
      return subcmdStatus(subArgs, cwd, infernoDir);
    case "dashboard":
      return subcmdDashboard(subArgs, cwd, infernoDir);
    case "memory":
      return subcmdMemory(subArgs, cwd, infernoDir);
    default: {
      const jsonMode = args.includes("--json");
      const msg = `Unknown cloud sub-command: ${subcmd || "(none)"}. Use: init | push | pull | memory | status | dashboard`;
      if (jsonMode) { console.log(JSON.stringify({ ok: false, error: msg })); }
      else {
        console.log();
        console.log(`  ${bold("infernoflow cloud")} — hosted contract + memory sync`);
        console.log();
        console.log(`  ${cyan("infernoflow cloud init")}               Set up cloud sync for this project`);
        console.log(`  ${cyan("infernoflow cloud push")}              Upload local contract to cloud`);
        console.log(`  ${cyan("infernoflow cloud push --memory")}     Also push sessions.jsonl`);
        console.log(`  ${cyan("infernoflow cloud pull")}              Download latest contract from cloud`);
        console.log(`  ${cyan("infernoflow cloud pull --memory")}     Also pull + merge session memory`);
        console.log(`  ${cyan("infernoflow cloud memory push/pull")}  Session memory only`);
        console.log(`  ${cyan("infernoflow cloud status")}            Compare local vs cloud`);
        console.log(`  ${cyan("infernoflow cloud dashboard")}         Open hosted dashboard in browser`);
        console.log();
      }
    }
  }
}
