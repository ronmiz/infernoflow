/**
 * infernoflow watch
 *
 * File-system watcher that turns infernoflow into infrastructure: code, save,
 * and the contract stays in sync. Layered auto-capture on top — surfaces
 * "log this?" prompts when it spots patterns that usually indicate gotchas.
 *
 * Usage:
 *   infernoflow watch                  Watch src/ (or auto-detected root)
 *   infernoflow watch src lib          Watch specific directories
 *   infernoflow watch --interval 5     Debounce interval in seconds (default: 3)
 *   infernoflow watch --dry-run        Print what would run, don't actually run
 *   infernoflow watch --silent         No output (git-hook friendly)
 *   infernoflow watch --no-tips        Don't print "log this?" prompts
 *
 * Per save:
 *   1. Debounce (3 s default) — batches rapid multi-file saves
 *   2. Diff changed files against capability-map.json
 *   3. If relevant capabilities may be affected → run suggest
 *   4. Run check silently — log issues to inferno/WATCH.log
 *
 * Heuristic prompts (suppressed by --silent or --no-tips):
 *   • Same file edited 5+ times in a session → "Stuck? Log what's tripping you up."
 *   • package.json / requirements.txt / Cargo.toml / go.mod / etc. changed → "Dependency change — log the decision?"
 *   • Test file deleted → "Removed test — was it failing? Log why."
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
  const candidates = ["src", "lib", "app", "pages", "components", "server", "api", "tests", "test", "__tests__", "spec"];
  const found = candidates.filter(d => fs.existsSync(path.join(cwd, d)));
  return found.length ? found.map(d => path.join(cwd, d)) : [cwd];
}

function isSourceFile(filePath) {
  return SOURCE_EXTS.has(path.extname(filePath).toLowerCase());
}

// ── Heuristic prompts (Plan Part 4 Level 2) ───────────────────────────────────

const DEPENDENCY_FILES = new Set([
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "requirements.txt", "Pipfile", "Pipfile.lock", "pyproject.toml", "poetry.lock",
  "Cargo.toml", "Cargo.lock", "go.mod", "go.sum",
  "Gemfile", "Gemfile.lock", "composer.json", "composer.lock",
]);

const TEST_FILE_RE = /(?:^|[\\/])(?:test|tests|spec|__tests__)[\\/].+\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rb|java|cs)$|\.(?:test|spec)\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rb|java|cs)$/i;

function isDependencyFile(filePath) {
  return DEPENDENCY_FILES.has(path.basename(filePath));
}

function isTestFile(filePath) {
  return TEST_FILE_RE.test(filePath);
}

function dimTip(msg, hint) {
  return `\n  ${yellow("⚠")}  ${msg}\n  ${gray("→")}  ${cyan(hint)}`;
}

// Per-session edit counter — keyed by absolute path. Module-level so a single
// `infernoflow watch` invocation accumulates counts across debounce batches.
const editCounts = new Map();
const lastEditAt = new Map();              // path -> timestamp, for per-file debounce
const EDIT_COUNT_DEBOUNCE_MS = 250;        // fs.watch fires multiple events per save
const EDIT_COUNT_THRESHOLDS = [5, 12, 25]; // prompt at each threshold once

function bumpEditCount(filePath) {
  // Per-file debounce — ignore rapid duplicate events from the same save.
  // Return null when skipped so the caller doesn't re-emit threshold tips.
  const now = Date.now();
  const last = lastEditAt.get(filePath) || 0;
  if (now - last < EDIT_COUNT_DEBOUNCE_MS) return null;
  lastEditAt.set(filePath, now);

  const n = (editCounts.get(filePath) || 0) + 1;
  editCounts.set(filePath, n);
  return n;
}

function maybeStuckTip(file, count, cwd) {
  // Prompt at thresholds, only once each (count === threshold value)
  if (!EDIT_COUNT_THRESHOLDS.includes(count)) return null;
  const rel = path.relative(cwd, file);
  return dimTip(
    `${bold(rel)} edited ${count}× this session — stuck on something?`,
    `infernoflow log "<what's tripping you up>" --type gotcha`
  );
}

function dependencyTip(file, cwd) {
  const rel = path.relative(cwd, file);
  return dimTip(
    `dependency manifest changed: ${bold(rel)}`,
    `infernoflow log "<switched from X to Y because Z>" --type decision`
  );
}

function testRemovedTip(file, cwd) {
  const rel = path.relative(cwd, file);
  return dimTip(
    `test file removed: ${bold(rel)} — was it failing?`,
    `infernoflow log "<why the test was removed>" --type attempt --result failed`
  );
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
  const noTips     = args.includes("--no-tips");
  const showTips   = !silent && !noTips;
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

  // Tracks files we observed via 'rename' (fs.watch) so we can detect deletions
  const seenFiles = new Set();
  // Buffer of tips to print after the current batch resolves
  const pendingTips = [];

  const handleChange = (eventType, filePath) => {
    // Dependency manifest changes — surface a decision-log tip immediately.
    // We don't add them to pendingFiles (suggest doesn't care about lockfiles),
    // but we do emit a one-shot tip per observation.
    if (showTips && isDependencyFile(filePath) && fs.existsSync(filePath)) {
      const key = "dep:" + filePath;
      const now = Date.now();
      if (now - (lastEditAt.get(key) || 0) >= EDIT_COUNT_DEBOUNCE_MS) {
        lastEditAt.set(key, now);
        pendingTips.push(dependencyTip(filePath, cwd));
      }
    }

    // Test-file removal — fs.watch fires 'rename' for both create and delete.
    // We treat a rename event for a now-missing test path as a deletion. There
    // is a small false-positive risk on file *renames* (the old path also fires
    // a rename event and won't exist anymore), but that's an acceptable cost
    // for the heuristic — and a renamed test is itself worth a log.
    if (showTips && isTestFile(filePath)) {
      if (eventType === "rename" && !fs.existsSync(filePath)) {
        const key = "del:" + filePath;
        const now = Date.now();
        if (now - (lastEditAt.get(key) || 0) >= EDIT_COUNT_DEBOUNCE_MS) {
          lastEditAt.set(key, now);
          pendingTips.push(testRemovedTip(filePath, cwd));
        }
      } else if (fs.existsSync(filePath)) {
        seenFiles.add(filePath);
      }
    }

    if (!isSourceFile(filePath)) {
      // Still drain any pending tips so dependency/test prompts show up
      if (pendingTips.length && !silent) {
        for (const tip of pendingTips.splice(0)) console.log(tip);
      }
      return;
    }

    pendingFiles.add(filePath);

    // Edit-count heuristic — prompt at 5, 12, 25 edits per file per session.
    if (showTips) {
      const count = bumpEditCount(filePath);
      if (count !== null) {
        const tip = maybeStuckTip(filePath, count, cwd);
        if (tip) pendingTips.push(tip);
      }
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changed = Array.from(pendingFiles);
      pendingFiles.clear();

      if (!silent) {
        const names = changed.map(f => path.relative(cwd, f)).slice(0, 3).join(", ");
        process.stdout.write(`\n  ${gray(new Date().toLocaleTimeString())}  ${bold(names)}${changed.length > 3 ? ` +${changed.length - 3} more` : ""}  `);
      }

      const { relevant, reason } = capabilityRelevance(changed, infernoDir);
      if (relevant) {
        runSuggest(changed, cwd, infernoDir, dryRun, silent);
      } else if (!silent) {
        console.log(gray(`skip (${reason})`));
      }

      // Drain any tips queued during this batch
      if (pendingTips.length && !silent) {
        for (const tip of pendingTips.splice(0)) console.log(tip);
      }
    }, debounceMs);
  };

  // Start watchers on each directory
  const watchers = [];
  for (const dir of validDirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
        if (filename) handleChange(event, path.join(dir, filename));
      });
      watchers.push(watcher);
    } catch (err) {
      if (!silent) warn(`Cannot watch ${dir}: ${err.message}`);
    }
  }

  // Also watch the project root non-recursively so we catch dependency
  // manifests (package.json, Cargo.toml, etc.) regardless of which subdir
  // the user picked. This watcher only emits root-level events — perfect.
  try {
    const rootWatcher = fs.watch(cwd, { recursive: false }, (event, filename) => {
      if (filename) handleChange(event, path.join(cwd, filename));
    });
    watchers.push(rootWatcher);
  } catch { /* OS may refuse — non-fatal */ }

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
