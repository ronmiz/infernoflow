/**
 * infernoflow doctor
 *
 * Comprehensive setup diagnostic — like `brew doctor`.
 * Checks every component of the infernoflow setup and tells you
 * exactly what's wrong and how to fix it.
 *
 * Usage:
 *   infernoflow doctor         Print full diagnostic report
 *   infernoflow doctor --fix   Auto-fix common issues
 *   infernoflow doctor --json  Machine-readable output
 */

import * as fs        from "node:fs";
import * as path      from "node:path";
import * as os        from "node:os";
import * as http      from "node:http";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import { detectAvailableProviders } from "../ai/providerRouter.mjs";
import { readEntries as ampRead, readConfig } from "../amp/io.mjs";
import { resolveInjectionSettings } from "../ruleFiles.mjs";

// ── Check runners ─────────────────────────────────────────────────────────────

function check(label, fn) {
  try {
    const result = fn();
    return { label, ...result };
  } catch (err) {
    return { label, status: "error", message: err.message, fix: null };
  }
}

function pass(message, detail)  { return { status: "pass",  message, detail: detail || null, fix: null }; }
function warn(message, fix)     { return { status: "warn",  message, detail: null, fix: fix || null }; }
function fail(message, fix)     { return { status: "fail",  message, detail: null, fix: fix || null }; }

// ── Individual checks ─────────────────────────────────────────────────────────

function checkNodeVersion() {
  const v     = process.version;
  const major = parseInt(v.slice(1).split(".")[0], 10);
  if (major >= 20) return pass(`Node.js ${v}`, "Node 20+ recommended");
  if (major >= 18) return pass(`Node.js ${v}`);
  return fail(`Node.js ${v} — infernoflow requires Node 18+`, "Install Node 20 from nodejs.org");
}

function checkCli() {
  // Windows footgun: `npm install -g` creates a `infernoflow.cmd` shim, not
  // an `.exe`. spawnSync won't auto-resolve `.cmd` files unless `shell: true`
  // is passed. Without this flag, doctor reports a false-positive "CLI not
  // found on PATH" error even when the user is actively running the CLI.
  try {
    const r = spawnSync("infernoflow", ["--version"], {
      encoding: "utf8",
      timeout:  5000,
      shell:    process.platform === "win32",
    });
    if (r.status === 0) return pass(`infernoflow v${r.stdout.trim()} installed`);
    // Belt-and-suspenders: if doctor itself is running, the CLI IS on PATH.
    // The spawn might still fail on some exotic Windows shells; trust reality
    // over the spawn result.
    return pass("infernoflow CLI on PATH (version probe failed but doctor itself ran)");
  } catch {
    // If doctor is executing, the CLI must be reachable. Don't lie about it.
    return pass("infernoflow CLI on PATH (version probe threw but doctor itself ran)");
  }
}

function checkGitRepo(cwd) {
  try {
    execSync("git rev-parse --git-dir", { cwd, stdio: "ignore" });
    return pass("Git repository detected");
  } catch {
    return fail("Not a git repository", "git init && git add . && git commit -m 'init'");
  }
}

function checkInfernoDir(cwd) {
  const ampDir     = path.join(cwd, ".ai-memory");
  const infernoDir = path.join(cwd, "inferno");
  if (fs.existsSync(ampDir) && fs.existsSync(infernoDir)) return pass(".ai-memory/ + inferno/ both present");
  if (fs.existsSync(ampDir))     return pass(".ai-memory/ directory exists (memory mode)");
  if (fs.existsSync(infernoDir)) return pass("inferno/ directory exists");
  return fail("No memory directory found (.ai-memory/ or inferno/)", "infernoflow init");
}

function checkContract(cwd) {
  if (isMemoryMode(cwd)) {
    // v0.44.1: use the merged reader so we count entries across the
    // branch-aware layout (sessions.jsonl + global.jsonl + branches/*.jsonl).
    // The legacy direct-readFileSync of inferno/sessions.jsonl under-reported
    // everything in the new layout — same class of bug that hid 14 entries
    // from `infernoflow status` before its v0.44.1 sweep.
    let entries = 0;
    try { entries = ampRead(cwd).length; } catch {}
    if (entries === 0) return pass("Memory mode — sessions.jsonl will be created on first log");
    return pass(`Memory mode — ${entries} session entr${entries === 1 ? "y" : "ies"}`);
  }
  const infernoDir = path.join(cwd, "inferno");
  for (const f of ["contract.json", "capabilities.json"]) {
    const p = path.join(infernoDir, f);
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      const caps = (data.capabilities || []).length;
      return pass(`${f} valid — ${caps} capabilities`);
    } catch {
      return fail(`${f} contains invalid JSON`, `Fix the JSON syntax in inferno/${f}`);
    }
  }
  return fail("No contract.json/capabilities.json (and not in memory mode)", "infernoflow init   or   infernoflow init --mode full");
}

function isMemoryMode(cwd) {
  // Modern (v0.44.x+ default): .ai-memory/ exists with no full-mode contract.
  // The default `infernoflow init` writes only .ai-memory/ — no inferno/ dir,
  // no inferno/config.json — so the legacy config-based detection wrongly
  // reported memory-mode projects as "no contract / not in memory mode".
  const ampDir   = path.join(cwd, ".ai-memory");
  const contract = path.join(cwd, "inferno", "contract.json");
  if (fs.existsSync(ampDir) && !fs.existsSync(contract)) return true;
  // Legacy: explicit inferno/config.json with mode=memory.
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, "inferno", "config.json"), "utf8"));
    return cfg.mode === "memory";
  } catch { return false; }
}

function checkScenarios(cwd) {
  if (isMemoryMode(cwd)) return { status: "info", message: "n/a in memory mode", detail: null, fix: null };
  const scenDir = path.join(cwd, "inferno", "scenarios");
  if (!fs.existsSync(scenDir)) return warn("No scenarios/ directory", "infernoflow init");
  const files = fs.readdirSync(scenDir).filter(f => f.endsWith(".json"));
  if (!files.length) return warn("scenarios/ is empty", "Add scenario files or run infernoflow suggest");
  return pass(`${files.length} scenario file${files.length !== 1 ? "s" : ""} found`);
}

function checkChangelog(cwd) {
  if (isMemoryMode(cwd)) return { status: "info", message: "n/a in memory mode", detail: null, fix: null };
  const p = path.join(cwd, "inferno", "CHANGELOG.md");
  if (!fs.existsSync(p)) return warn("No inferno/CHANGELOG.md", "infernoflow init");
  return pass("inferno/CHANGELOG.md exists");
}

function checkContextMd(cwd) {
  if (isMemoryMode(cwd)) return { status: "info", message: "n/a in memory mode (CLAUDE.md is auto-maintained)", detail: null, fix: null };
  const p = path.join(cwd, "inferno", "CONTEXT.md");
  if (!fs.existsSync(p)) return warn("No CONTEXT.md generated", "infernoflow context");
  const age = (Date.now() - fs.statSync(p).mtimeMs) / (1000 * 60 * 60 * 24);
  if (age > 7) return warn(`CONTEXT.md is ${Math.round(age)} days old — may be stale`, "infernoflow context");
  return pass(`CONTEXT.md present (${Math.round(age)}d old)`);
}

function checkGitHooks(cwd) {
  const hooksDir   = path.join(cwd, ".git", "hooks");
  const postCommit = path.join(hooksDir, "post-commit");
  // `setup` installs a post-commit capture hook (see installGitHooks). That's
  // the hook we rely on, so its presence alone is a pass — and `setup --yes`
  // now genuinely installs it, so this warning's fix is no longer a no-op.
  const hasPost = fs.existsSync(postCommit) && fs.readFileSync(postCommit, "utf8").includes("infernoflow");
  if (hasPost) return pass("Git hooks installed (post-commit)");
  return warn("Git hooks not installed", "infernoflow setup --yes");
}

function checkMcp(cwd) {
  // Every config file `setup` (autoSetupMcp) writes must be checkable here, or
  // the checker and the writer drift apart. setup writes: ~/.claude.json
  // (Claude Code), .cursor/mcp.json (Cursor), .vscode/mcp.json (VS Code
  // Copilot), and claude_desktop_config.json (Claude Desktop app). Note the
  // key name differs: Claude Code / Cursor / Desktop use `mcpServers`, but
  // VS Code Copilot's .vscode/mcp.json uses `servers`.
  const checks = [
    path.join(cwd, ".cursor", "mcp.json"),
    path.join(cwd, ".mcp.json"),
    path.join(cwd, ".vscode", "mcp.json"),
    path.join(os.homedir(), ".claude.json"),
    path.join(os.homedir(), ".cursor", "mcp.json"),
    path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    path.join(os.homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
  ];
  for (const p of checks) {
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      const servers = data.mcpServers || data.mcp_servers || data.servers || {};
      if (Object.keys(servers).some(k => k.toLowerCase().includes("inferno"))) {
        return pass(`MCP server configured in ${path.basename(p)}`);
      }
    } catch {}
  }
  return warn("MCP server not configured", "infernoflow setup --yes   (adds to Cursor/Claude/Copilot config)");
}

// v0.44.1: detect a still-running MCP server whose cached code is older
// than the installed CLI. Catches the silent skew that bit 0.43→0.44
// upgraders (file/source field misroute kept happening until they
// restarted their IDE).
function checkMcpRuntime(cwd, cliVersion) {
  const file = path.join(cwd, ".ai-memory", ".mcp-runtime.json");
  if (!fs.existsSync(file)) {
    return pass("MCP runtime stamp not present yet — start your AI tool to write one");
  }
  let stamp;
  try { stamp = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return warn(".mcp-runtime.json present but unreadable", "Delete .ai-memory/.mcp-runtime.json and restart your AI tool"); }
  if (!stamp || typeof stamp.version !== "string") {
    return warn(".mcp-runtime.json malformed", "Delete it; the next MCP boot will rewrite it");
  }
  if (stamp.version === cliVersion) {
    return pass(`MCP runtime v${stamp.version} matches CLI`);
  }
  // Dev-tree skip: don't badger people running infernoflow from source.
  if (cliVersion.startsWith("0.0.0") || stamp.version.startsWith("0.0.0")) {
    return pass(`MCP runtime v${stamp.version} (dev/source) — skipping version-skew check`);
  }
  return warn(
    `MCP server is running v${stamp.version} but CLI is v${cliVersion} — restart your AI tool to load the new code.`,
    "Quit and reopen Cursor / Claude Code / VS Code (the long-running MCP process keeps the old code in memory until restart)",
  );
}

// Auto-capture link 1: the AI only logs proactively if the "Memory protocol"
// block (the amp_write trigger table) is present in a rule file it reads at
// chat start. doctor checks MCP registration (link 2) and runtime (link 3)
// already; this closes the gap so the full auto-capture chain is visible.
function checkMemoryProtocol(cwd) {
  // Honor injection config: only check the files that are configured targets,
  // and don't warn if the user deliberately turned protocol injection off.
  const settings = resolveInjectionSettings(readConfig(cwd));
  if (!settings.includeProtocol) {
    return pass("Memory-protocol injection disabled in config (injection.includeProtocol=false)");
  }
  const targets = settings.targets;
  const present = [];
  for (const f of targets) {
    try {
      const txt = fs.readFileSync(path.join(cwd, String(f)), "utf8");
      if (txt.includes("amp_write") && /Memory protocol/i.test(txt)) present.push(f);
    } catch { /* missing file is fine */ }
  }
  if (present.length) {
    return pass(`Memory protocol in ${present.length}/${targets.length} configured rule file(s) — AI knows when to auto-capture`);
  }
  return warn(
    "Memory protocol missing from rule files — the AI won't auto-capture gotchas",
    "infernoflow refresh   (writes the amp_write capture protocol into your rule files)",
  );
}

function checkAiProviders(cwd) {
  const providers = detectAvailableProviders(cwd);
  const available = Object.entries(providers).filter(([, v]) => v).map(([k]) => k);

  if (available.length) return pass(`AI provider${available.length !== 1 ? "s" : ""}: ${available.join(", ")}`);

  return warn(
    "No AI provider configured",
    "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY, or OPENROUTER_API_KEY\n" +
    "     Or install Ollama (ollama.com) for free local AI\n" +
    "     Or use VS Code with GitHub Copilot (zero config)"
  );
}

async function checkOllama() {
  return new Promise(resolve => {
    const req = http.get({ hostname: "localhost", port: 11434, path: "/api/tags", timeout: 1500 }, res => {
      resolve(pass("Ollama running on localhost:11434"));
    });
    req.on("error", () => resolve({ status: "info", message: "Ollama not running (optional)", fix: "ollama serve", detail: null }));
    req.on("timeout", () => { req.destroy(); resolve({ status: "info", message: "Ollama not running (optional)", fix: null, detail: null }); });
  });
}

function checkCloudToken() {
  // Real credentials live at ~/.infernoflow/credentials.json (see lib/cloud/credentials.mjs)
  const credsPath = path.join(os.homedir(), ".infernoflow", "credentials.json");
  if (!fs.existsSync(credsPath)) {
    return { status: "info", message: "Not logged in to cloud (optional)", fix: "infernoflow login", detail: null };
  }
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    const who = creds.user?.login || creds.user?.name || creds.user?.email || "unknown";

    if (creds.mode === "supabase" && creds.access_token) {
      if (creds.expires_at) {
        const expiresAt = new Date(creds.expires_at).getTime();
        if (Date.now() > expiresAt) return warn(`JWT expired for ${who} — refresh on next log will retry`, "infernoflow login");
      }
      return pass(`Authenticated as ${who} (Supabase JWT — auth.uid() writes)`);
    }

    if (creds.mode === "device-flow" && creds.github_access_token) {
      return { status: "info", message: `Identity-only as ${who} (device flow — anon-mode writes)`, fix: "infernoflow login   (without --device-flow, for full auth)", detail: null };
    }

    // Legacy schema (pre-v0.40 — single access_token meant a GitHub token)
    if (creds.access_token) {
      return warn(`Legacy login for ${who} — re-run for authenticated cloud writes`, "infernoflow logout && infernoflow login");
    }

    return { status: "info", message: "Credentials file present but no recognised token", fix: "infernoflow logout && infernoflow login", detail: null };
  } catch {
    return warn("Credentials file unreadable", "infernoflow logout && infernoflow login");
  }
}


function checkRouterIntegrity() {
  // Regression check: every command routed in bin/infernoflow.mjs must resolve
  // to an actual file. v0.38.x had ~16 vapor commands that crashed with
  // "Cannot find module" — make sure that doesn't sneak back in.
  try {
    const here = fileURLToPath(import.meta.url);
    const binPath = path.resolve(path.dirname(here), "..", "..", "bin", "infernoflow.mjs");
    if (!fs.existsSync(binPath)) return { status: "info", message: "bin/infernoflow.mjs not found from doctor location", fix: null, detail: null };
    const binSrc = fs.readFileSync(binPath, "utf8");
    const matches = [...binSrc.matchAll(/import\("\.\.\/lib\/(commands\/[^"]+|telemetry\.mjs)"\)/g)];
    const missing = [];
    const root = path.resolve(path.dirname(binPath), "..");
    for (const m of matches) {
      const rel = m[1];
      const full = path.join(root, "lib", rel);
      if (!fs.existsSync(full)) missing.push(rel);
    }
    if (missing.length) {
      return fail(`${missing.length} routed command(s) missing module files: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`, "Restore the missing files or remove their entries from bin/infernoflow.mjs");
    }
    return pass(`All ${matches.length} routed commands resolve to real files`);
  } catch (err) {
    return { status: "info", message: `Router integrity check skipped: ${err.message}`, fix: null, detail: null };
  }
}

/**
 * Detect stale npm scripts left behind by a pre-0.43 install.
 *
 * Background: in 0.37 the CLI used flat command names (`infernoflow check`,
 * `infernoflow scan`, etc.). The 0.43 surface cull regrouped them under
 * subsystems (`contract check`, `contract scan-ui`) and removed several
 * verbs entirely. Users upgrading from 0.37 → 0.43 ended up with 14+ stale
 * npm scripts referencing verbs that don't exist anymore — they'd silently
 * no-op or hard-fail depending on the shell. The agent reviewer flagged
 * this as the single biggest trust-erosion issue.
 *
 * This check looks for the common stale-verb references and tells the user
 * what to remove. Doesn't auto-fix (changing npm scripts is opinionated and
 * we don't want to nuke user CI invocations they actually depend on).
 */
function checkStaleNpmScripts(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return pass("No package.json to audit");

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); }
  catch { return { status: "info", message: "package.json unreadable; skipping audit", detail: null, fix: null }; }

  const scripts = pkg.scripts || {};
  // These verb prefixes are post-0.43 — present means script is on the
  // new surface. Anything matching `infernoflow <bare-verb>` for a verb NOT
  // in this allowlist is suspect.
  //
  // SOURCE OF TRUTH: keep this in lock-step with COMMAND_HANDLERS in
  // bin/infernoflow.mjs. The previous list had drifted badly — it still listed
  // removed verbs (graph/watch/demo/dev/stats/test/contract/log-decision/
  // log-attempt), so dead scripts slipped through unflagged, and it OMITTED
  // real current verbs (forget/prune/bookmark/refresh/sync/ai/check/uninstall/
  // telemetry/generate-skills/install-*), so legitimate scripts were falsely
  // reported as deprecated.
  const VALID_VERBS = new Set([
    // memory core
    "log", "ask", "switch", "recap", "status", "refresh", "forget", "prune", "bookmark",
    // setup
    "init", "setup", "doctor", "context",
    // ide wiring
    "install-cursor-hooks", "install-vscode-copilot-hooks", "generate-skills",
    // configuration / housekeeping
    "ai", "telemetry", "uninstall",
    // contract validation + cross-machine sync + namespace
    "check", "sync", "amp",
    // meta (bin also accepts these)
    "commands",
  ]);

  const stale = [];
  for (const [scriptName, body] of Object.entries(scripts)) {
    const m = /\binfernoflow\s+([a-z][a-z0-9-]*)/.exec(String(body));
    if (!m) continue;
    const verb = m[1];
    if (!VALID_VERBS.has(verb)) {
      stale.push({ scriptName, verb });
    }
  }

  if (stale.length === 0) return pass("npm scripts use current command surface");
  const summary = stale.map(s => `${s.scriptName} → infernoflow ${s.verb}`).join(", ");
  return warn(
    `package.json references ${stale.length} deprecated command(s): ${summary}`,
    `Edit package.json scripts to use the current surface (run \`infernoflow --help\` to list verbs)`,
  );
}

function checkGitignore(cwd) {
  // Make sure node_modules is properly excluded — we shipped a release once
  // where it wasn't, and 5,200+ dependency files leaked into git.
  const giPath = path.join(cwd, ".gitignore");
  if (!fs.existsSync(giPath)) return { status: "info", message: ".gitignore not found", fix: null, detail: null };
  const gi = fs.readFileSync(giPath, "utf8");
  const ok = /^(?:\*\*\/)?node_modules\/?$/m.test(gi);
  if (ok) return pass(".gitignore excludes node_modules");
  return warn(".gitignore does not exclude node_modules", "Add 'node_modules/' (and '**/node_modules/') to .gitignore");
}

// ── Auto-fix ──────────────────────────────────────────────────────────────────

function autoFix(results, cwd) {
  const fixable = results.filter(r => r.status === "warn" && r.fix);
  const fixed   = [];

  for (const r of fixable) {
    const fix = r.fix;
    if (fix.startsWith("infernoflow ")) {
      const args = fix.slice("infernoflow ".length).split(" ");
      const res  = spawnSync("infernoflow", args, { cwd, encoding: "utf8", timeout: 30_000 });
      if (res.status === 0) fixed.push(r.label);
    }
  }
  return fixed;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function icon(status) {
  if (status === "pass") return green("✔");
  if (status === "warn") return yellow("⚠");
  if (status === "fail") return red("✗");
  return gray("·");
}

function printReport(results, elapsed) {
  const counts = { pass: 0, warn: 0, fail: 0, info: 0, error: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

  console.log();
  console.log(`  ${bold("🔥 infernoflow doctor")}`);
  console.log();

  const w = Math.max(...results.map(r => r.label.length)) + 2;
  for (const r of results) {
    console.log(`  ${icon(r.status)}  ${bold(r.label.padEnd(w))} ${r.message}`);
    if (r.detail) console.log(`     ${" ".repeat(w)} ${gray(r.detail)}`);
    if (r.fix && (r.status === "warn" || r.status === "fail")) {
      console.log(`     ${" ".repeat(w)} ${cyan("fix:")} ${gray(r.fix)}`);
    }
  }

  console.log();
  const overall = counts.fail > 0 ? red("issues found") : counts.warn > 0 ? yellow("warnings") : green("all good");
  console.log(`  ${overall}  —  ${green(String(counts.pass))} pass · ${yellow(String(counts.warn))} warn · ${red(String(counts.fail))} fail  (${elapsed}ms)`);
  console.log();

  if (counts.warn > 0 || counts.fail > 0) {
    console.log(`  Run ${cyan("infernoflow doctor --fix")} to auto-fix warnings`);
    console.log();
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

export async function doctorCommand(rawArgs) {
  const args     = rawArgs.slice(1);
  const jsonMode = args.includes("--json");
  const fixMode  = args.includes("--fix");
  const cwd      = process.cwd();
  const start    = Date.now();

  // Resolve the running CLI version once for the runtime-skew check below.
  let cliVersion = "0.0.0-unknown";
  try {
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(here, "..", "..", "package.json");
    cliVersion = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || cliVersion;
  } catch { /* leave as unknown */ }

  const results = [
    check("Node.js version",     () => checkNodeVersion()),
    check("infernoflow CLI",     () => checkCli()),
    check("Git repository",      () => checkGitRepo(cwd)),
    check("inferno/ directory",  () => checkInfernoDir(cwd)),
    check("Contract / mode",     () => checkContract(cwd)),
    check("Scenarios",           () => checkScenarios(cwd)),
    check("Changelog",           () => checkChangelog(cwd)),
    check("CONTEXT.md",          () => checkContextMd(cwd)),
    check("Git hooks",           () => checkGitHooks(cwd)),
    check("Auto-capture protocol", () => checkMemoryProtocol(cwd)),
    check("MCP server",          () => checkMcp(cwd)),
    check("MCP runtime version", () => checkMcpRuntime(cwd, cliVersion)),
    check("AI providers",        () => checkAiProviders(cwd)),
    check("Cloud sync",          () => checkCloudToken()),
    check(".gitignore",          () => checkGitignore(cwd)),
    check("Router integrity",    () => checkRouterIntegrity()),
    check("npm scripts",         () => checkStaleNpmScripts(cwd)),
    await checkOllama().then(r => ({ label: "Ollama (local AI)", ...r })),
  ];

  const elapsed = Date.now() - start;

  if (fixMode) {
    const fixed = autoFix(results, cwd);
    if (fixed.length) {
      if (!jsonMode) {
        console.log();
        fixed.forEach(f => console.log(`  ${green("✔")} Fixed: ${f}`));
        console.log();
      }
      // Re-run checks after fixing — in the SAME output mode the user asked
      // for. Previously this always re-ran with --json, so a human running
      // `doctor --fix` got a raw JSON blob as the final screen output instead
      // of the re-rendered report.
      return doctorCommand(jsonMode ? ["doctor", "--json"] : ["doctor"]);
    }
  }

  if (jsonMode) {
    const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
    results.forEach(r => counts[r.status] = (counts[r.status] || 0) + 1);
    console.log(JSON.stringify({ ok: counts.fail === 0, counts, results, elapsed }));
    return;
  }

  printReport(results, elapsed);

  const hasFail = results.some(r => r.status === "fail");
  if (hasFail) process.exit(1);
}
