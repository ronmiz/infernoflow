/**
 * infernoflow watch
 *
 * File-system watcher that runs `infernoflow suggest` automatically whenever
 * source files are saved. Zero manual steps — just code, save, and the
 * contract stays in sync.
 *
 * Usage:
 *   infernoflow watch                  Watch src/ (or auto-detected root)
 *   infernoflow watch src lib          Watch specific directories
 *   infernoflow watch --interval 5     Debounce interval in seconds (default: 3)
 *   infernoflow watch --dry-run        Print what would run, don't actually run
 *   infernoflow watch --silent         No output (git-hook friendly)
 *
 * What it does on each save:
 *   1. Debounce (3 s default) — batches rapid multi-file saves
 *   2. Diff changed files against capability-map.json
 *   3. If relevant capabilities may be affected → run suggest
 *   4. Run check silently — log issues to inferno/WATCH.log
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";
import { ok, warn, info, bold, cyan, gray, green, yellow } from "../ui/output.mjs";

// ── Source file detection ─────────────────────────────────────────────────────

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".cs", ".rb", ".swift"]);
const SKIP_DIRS   = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".angular", "vendor", "coverage", "__pycache__"]);

function defaultWatchDirs(cwd) {
  const candidates = ["src", "lib", "app", "pages", "components", "server", "api"];
  const found = candidates.filter(d => fs.existsSync(path.join(cwd, d)));
  return found.length ? found.map(d => path.join(cwd, d)) : [cwd];
}

function isSourceFile(filePath) {
  return SOURCE_EXTS.has(path.extname(filePath).toLowerCase());
}

// ── Capability relevance check ────────────────────────────────────────────────

function capabilityRelevance(changedFiles, infernoDir) {
  const mapPath = path.join(infernoDir, "capability-map.json");
  if (!fs.existsSync(mapPath)) return { relevant: true, reason: "no cap-map — suggesting broadly" };

  let capMap;
  try { capMap = JSON.parse(fs.readFileSync(mapPath, "utf8")); } catch { return { relevant: true, reason: "cap-map unreadable" }; }

  const hits = [];
  for (const file of changedFiles) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    for (const [prefix, capIds] of Object.entries(capMap)) {
      if (rel.startsWith(prefix.replace(/\\/g, "/"))) {
        hits.push(...capIds);
      }
    }
  }

  if (hits.length > 0) return { relevant: true, reason: `touches: ${[...new Set(hits)].slice(0,3).join(", ")}` };
  return { relevant: false, reason: "no mapped capabilities affected" };
}

// ── Run suggest + check ───────────────────────────────────────────────────────

function runSuggest(changedFiles, cwd, infernoDir, dryRun, silent) {
  const names = changedFiles.map(f => path.basename(f, path.extname(f))).slice(0, 3).join(", ");
  const desc  = `code changes in ${names}`;

  if (!silent) {
    process.stdout.write(`  ${yellow("⟳")}  suggesting from ${bold(String(changedFiles.length))} changed file${changedFiles.length !== 1 ? "s" : ""}… `);
  }

  if (dryRun) {
    if (!silent) console.log(gray("(dry run)"));
    return;
  }

  try {
    spawnSync(process.execPath, [
      path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), "bin", "infernoflow.mjs"),
      "suggest", desc, "--json"
    ], { cwd, encoding: "utf8", timeout: 30_000, stdio: "ignore" });

    if (!silent) console.log(green("done"));
  } catch {
    if (!silent) console.log(gray("skipped (no changes)"));
  }

  // Silent check — write issues to WATCH.log
  try {
    const result = spawnSync(process.execPath, [
      path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), "bin", "infernoflow.mjs"),
      "check", "--json"
    ], { cwd, encoding: "utf8", timeout: 15_000 });

    const out = result.stdout?.trim();
    if (out) {
      const data = JSON.parse(out);
      if (data.status === "error" || data.status === "warning") {
        fs.writeFileSync(path.join(infernoDir, "WATCH.log"), out + "\n");
        if (!silent) warn(`Contract issues detected — see inferno/WATCH.log`);
      } else {
        const logPath = path.join(infernoDir, "WATCH.log");
        if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
      }
    }
  } catch {}
}

// ── Watcher ───────────────────────────────────────────────────────────────────

export async function watchCommand(rawArgs) {
  const args       = rawArgs.slice(1);
  const dryRun     = args.includes("--dry-run");
  const silent     = args.includes("--silent");
  const intervalIdx = args.indexOf("--interval");
  const debounceMs = ((intervalIdx !== -1 ? parseFloat(args[intervalIdx + 1]) : 3) || 3) * 1000;
  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  if (!fs.existsSync(infernoDir)) {
    warn("inferno/ not found. Run: infernoflow init");
    process.exit(1);
  }

  // Collect directories to watch
  const dirArgs  = args.filter(a => !a.startsWith("-") && a !== String(args[intervalIdx + 1]));
  const watchDirs = dirArgs.length
    ? dirArgs.map(d => path.resolve(cwd, d))
    : defaultWatchDirs(cwd);

  const validDirs = watchDirs.filter(d => fs.existsSync(d));
  if (!validDirs.length) {
    warn("No valid directories to watch.");
    process.exit(1);
  }

  if (!silent) {
    console.log();
    console.log(`  ${bold("🔥 infernoflow watch")}  ${gray("(Ctrl+C to stop)")}`);
    console.log();
    validDirs.forEach(d => console.log(`  ${cyan("watching")} ${gray(path.relative(cwd, d) || ".")}`));
    console.log(`  ${gray(`debounce: ${debounceMs / 1000}s`)}`);
    console.log();
  }

  let debounceTimer = null;
  const pendingFiles = new Set();

  const handleChange = (filePath) => {
    if (!isSourceFile(filePath)) return;
    pendingFiles.add(filePath);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changed = Array.from(pendingFiles);
      pendingFiles.clear();

      if (!silent) {
        const names = changed.map(f => path.relative(cwd, f)).slice(0, 3).join(", ");
        process.stdout.write(`\n  ${gray(new Date().toLocaleTimeString())}  ${bold(names)}${changed.length > 3 ? ` +${changed.length - 3} more` : ""}  `);
      }

      const { relevant, reason } = capabilityRelevance(changed, infernoDir);
      if (!relevant) {
        if (!silent) console.log(gray(`skip (${reason})`));
        return;
      }

      runSuggest(changed, cwd, infernoDir, dryRun, silent);
    }, debounceMs);
  };

  // Start watchers on each directory
  const watchers = [];
  for (const dir of validDirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
        if (filename) handleChange(path.join(dir, filename));
      });
      watchers.push(watcher);
    } catch (err) {
      if (!silent) warn(`Cannot watch ${dir}: ${err.message}`);
    }
  }

  if (!watchers.length) {
    warn("No directories could be watched.");
    process.exit(1);
  }

  // Keep alive
  process.on("SIGINT", () => {
    watchers.forEach(w => w.close());
    if (!silent) { console.log("\n\n  Stopped."); console.log(); }
    process.exit(0);
  });

  // Block forever
  await new Promise(() => {});
}
