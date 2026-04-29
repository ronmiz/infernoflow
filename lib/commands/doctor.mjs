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
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import { detectAvailableProviders } from "../ai/providerRouter.mjs";

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
  try {
    const r = spawnSync("infernoflow", ["--version"], { encoding: "utf8", timeout: 5000 });
    if (r.status === 0) return pass(`infernoflow v${r.stdout.trim()} installed`);
    return fail("infernoflow CLI not found on PATH", "npm install -g infernoflow");
  } catch {
    return fail("infernoflow CLI not found on PATH", "npm install -g infernoflow");
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
  const infernoDir = path.join(cwd, "inferno");
  if (!fs.existsSync(infernoDir)) return fail("inferno/ not found", "infernoflow init");
  return pass("inferno/ directory exists");
}

function checkContract(cwd) {
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
  return fail("No contract.json or capabilities.json", "infernoflow init");
}

function checkScenarios(cwd) {
  const scenDir = path.join(cwd, "inferno", "scenarios");
  if (!fs.existsSync(scenDir)) return warn("No scenarios/ directory", "infernoflow init");
  const files = fs.readdirSync(scenDir).filter(f => f.endsWith(".json"));
  if (!files.length) return warn("scenarios/ is empty", "Add scenario files or run infernoflow suggest");
  return pass(`${files.length} scenario file${files.length !== 1 ? "s" : ""} found`);
}

function checkChangelog(cwd) {
  const p = path.join(cwd, "inferno", "CHANGELOG.md");
  if (!fs.existsSync(p)) return warn("No inferno/CHANGELOG.md", "infernoflow init");
  return pass("inferno/CHANGELOG.md exists");
}

function checkContextMd(cwd) {
  const p = path.join(cwd, "inferno", "CONTEXT.md");
  if (!fs.existsSync(p)) return warn("No CONTEXT.md generated", "infernoflow context");
  const age = (Date.now() - fs.statSync(p).mtimeMs) / (1000 * 60 * 60 * 24);
  if (age > 7) return warn(`CONTEXT.md is ${Math.round(age)} days old — may be stale`, "infernoflow context");
  return pass(`CONTEXT.md present (${Math.round(age)}d old)`);
}

function checkGitHooks(cwd) {
  const hooksDir  = path.join(cwd, ".git", "hooks");
  const postCommit = path.join(hooksDir, "post-commit");
  const prePush    = path.join(hooksDir, "pre-push");
  const hasPost    = fs.existsSync(postCommit) && fs.readFileSync(postCommit, "utf8").includes("infernoflow");
  const hasPre     = fs.existsSync(prePush)    && fs.readFileSync(prePush, "utf8").includes("infernoflow");
  if (hasPost && hasPre) return pass("Git hooks installed (post-commit + pre-push)");
  if (hasPost || hasPre) return warn("Partial git hooks installed", "infernoflow setup --yes");
  return warn("Git hooks not installed", "infernoflow setup --yes");
}

function checkMcp(cwd) {
  // Check for MCP server in cursor config or .mcp.json
  const checks = [
    path.join(cwd, ".cursor", "mcp.json"),
    path.join(cwd, ".mcp.json"),
    path.join(os.homedir(), ".cursor", "mcp.json"),
    path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    path.join(os.homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
  ];
  for (const p of checks) {
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      const servers = data.mcpServers || data.mcp_servers || {};
      if (Object.keys(servers).some(k => k.toLowerCase().includes("inferno"))) {
        return pass(`MCP server configured in ${path.basename(p)}`);
      }
    } catch {}
  }
  return warn("MCP server not configured", "infernoflow setup --yes   (adds to Cursor/Claude config)");
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

function checkCloudToken(cwd) {
  const p = path.join(cwd, "inferno", "integrations.json");
  if (!fs.existsSync(p)) return { status: "info", message: "Cloud sync not configured (optional)", fix: "infernoflow cloud init", detail: null };
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (data.cloud?.token) return pass("Cloud sync configured");
    return { status: "info", message: "Cloud sync not configured (optional)", fix: "infernoflow cloud init", detail: null };
  } catch {
    return { status: "info", message: "Cloud sync not configured (optional)", fix: null, detail: null };
  }
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

  const results = [
    check("Node.js version",   () => checkNodeVersion()),
    check("infernoflow CLI",   () => checkCli()),
    check("Git repository",    () => checkGitRepo(cwd)),
    check("inferno/ directory",() => checkInfernoDir(cwd)),
    check("Contract file",     () => checkContract(cwd)),
    check("Scenarios",         () => checkScenarios(cwd)),
    check("Changelog",         () => checkChangelog(cwd)),
    check("CONTEXT.md",        () => checkContextMd(cwd)),
    check("Git hooks",         () => checkGitHooks(cwd)),
    check("MCP server",        () => checkMcp(cwd)),
    check("AI providers",      () => checkAiProviders(cwd)),
    check("Cloud sync",        () => checkCloudToken(cwd)),
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
      // Re-run checks after fixing
      return doctorCommand(["doctor", "--json"]);
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
