/**
 * infernoflow coverage
 *
 * Maps test files to capabilities via fuzzy name matching.
 * Shows which capabilities have test coverage and which don't.
 *
 * Usage:
 *   infernoflow coverage               Print coverage table
 *   infernoflow coverage --json        Machine-readable output
 *   infernoflow coverage --dir src/    Extra dirs to scan (default: project root)
 *   infernoflow coverage --fail-below 50  Exit 1 if coverage < N%
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ─── test pattern extractors ─────────────────────────────────────────────────

const TEST_PATTERNS = [
  // Jest / Vitest  — it("...", …)  test("...", …)  describe("...", …)
  { regex: /(?:it|test|describe)\s*\(\s*["'`]([^"'`]+)["'`]/g, lang: "js" },
  // Pytest         — def test_something
  { regex: /def\s+(test_[\w_]+)\s*\(/g, lang: "py" },
  // RSpec          — describe/it "..."
  { regex: /(?:describe|it)\s+["']([^"']+)["']/g, lang: "rb" },
  // Go             — func TestXxx(
  { regex: /func\s+(Test\w+)\s*\(/g, lang: "go" },
  // Rust           — #[test] fn xxx
  { regex: /#\[test\]\s*\n\s*(?:async\s+)?fn\s+(\w+)/g, lang: "rs" },
];

const TEST_FILE_GLOBS = [
  /\.(test|spec)\.[jt]sx?$/,   // foo.test.ts
  /__tests__/,                  // __tests__/foo.js
  /\.test\.py$/,                // test_foo.py
  /^test_.*\.py$/,              // test_foo.py (basename)
  /_spec\.rb$/,                 // foo_spec.rb
  /\/spec\//,                   // spec/ directory
  /_test\.go$/,                 // foo_test.go
  /_test\.rs$/,                 // foo_test.rs
];

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next",
  "coverage", ".nyc_output", "__pycache__", ".pytest_cache",
  "vendor", "tmp", ".turbo",
]);

// ─── file walker ─────────────────────────────────────────────────────────────

function* walkFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walkFiles(path.join(dir, e.name));
    } else if (e.isFile()) {
      yield path.join(dir, e.name);
    }
  }
}

function isTestFile(filePath) {
  const basename = path.basename(filePath);
  return TEST_FILE_GLOBS.some(re => re.test(filePath) || re.test(basename));
}

// ─── test name extractor ─────────────────────────────────────────────────────

function extractTestNames(filePath) {
  let src;
  try { src = fs.readFileSync(filePath, "utf8"); }
  catch { return []; }

  const names = new Set();
  for (const { regex } of TEST_PATTERNS) {
    const r = new RegExp(regex.source, regex.flags);
    let m;
    while ((m = r.exec(src)) !== null) {
      names.add(m[1].trim());
    }
  }
  return [...names];
}

// ─── fuzzy matcher ───────────────────────────────────────────────────────────

/**
 * Tokenise a string: split on spaces, hyphens, underscores, camelCase.
 * Returns an array of lowercase tokens.
 */
function tokenise(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2")   // camelCase split
    .toLowerCase()
    .split(/[\s_\-/]+/)
    .filter(Boolean);
}

/**
 * Jaccard-like overlap score between two token sets.
 * Returns a value in [0, 1].
 */
function overlapScore(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  let common = 0;
  for (const t of setA) if (setB.has(t)) common++;
  const union = setA.size + setB.size - common;
  return union === 0 ? 0 : common / union;
}

/**
 * Best match score between a test name and a capability (id + name).
 */
function matchScore(testName, cap) {
  const testTokens = tokenise(testName);
  const idTokens   = tokenise(cap.id   || "");
  const nameTokens = tokenise(cap.name || "");
  return Math.max(
    overlapScore(testTokens, idTokens),
    overlapScore(testTokens, nameTokens),
  );
}

// ─── main scanner ─────────────────────────────────────────────────────────────

function scanTestFiles(dirs) {
  const testFiles = [];
  for (const dir of dirs) {
    for (const f of walkFiles(dir)) {
      if (isTestFile(f)) testFiles.push(f);
    }
  }
  return testFiles;
}

function buildTestIndex(testFiles) {
  // Returns: Map<testName, filePath>
  const index = new Map();
  for (const f of testFiles) {
    for (const name of extractTestNames(f)) {
      if (!index.has(name)) index.set(name, f);
    }
  }
  return index;
}

/** Returns: Map<capId, { matched: [{testName, file, score}], score: number }> */
function mapTestsToCaps(capabilities, testIndex, threshold = 0.25) {
  const result = new Map();

  for (const cap of capabilities) {
    const hits = [];
    for (const [testName, file] of testIndex) {
      const score = matchScore(testName, cap);
      if (score >= threshold) {
        hits.push({ testName, file: path.relative(process.cwd(), file), score });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    result.set(cap.id, { cap, hits });
  }
  return result;
}

// ─── reporters ────────────────────────────────────────────────────────────────

function bar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const colour = pct >= 75 ? green : pct >= 40 ? yellow : red;
  return colour("█".repeat(filled)) + gray("░".repeat(width - filled));
}

function printTable(coverageMap) {
  const covered   = [...coverageMap.values()].filter(v => v.hits.length > 0).length;
  const total     = coverageMap.size;
  const pct       = total === 0 ? 0 : Math.round((covered / total) * 100);

  console.log();
  console.log(bold("  Capability Coverage"));
  console.log(gray("  ─────────────────────────────────────────────────────────────"));
  console.log(
    gray("  ") +
    bold(cyan("Capability".padEnd(32))) +
    bold(cyan("Tests".padEnd(8))) +
    bold(cyan("Top match"))
  );
  console.log(gray("  ─────────────────────────────────────────────────────────────"));

  for (const [, { cap, hits }] of coverageMap) {
    const status  = hits.length > 0 ? green("✔") : red("✗");
    const topName = hits[0] ? gray(`  ${hits[0].testName.slice(0, 42)}`) : "";
    const count   = hits.length === 0 ? red("0") : green(String(hits.length));
    console.log(
      `  ${status} ${cap.id.padEnd(30)} ${count.padEnd(6)} ${topName}`
    );
  }

  console.log(gray("  ─────────────────────────────────────────────────────────────"));
  console.log();
  console.log(`  ${bar(pct)} ${bold(pct + "%")} (${covered}/${total} capabilities covered)`);
  console.log();

  if (total > 0 && covered < total) {
    const uncovered = [...coverageMap.values()]
      .filter(v => v.hits.length === 0)
      .map(v => v.cap.id);
    console.log(yellow(`  ⚠  Uncovered: ${uncovered.join(", ")}`));
    console.log();
  }
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function coverageCommand(rawArgs) {
  const args       = rawArgs || [];
  const jsonMode   = args.includes("--json");
  const dirIdx     = args.indexOf("--dir");
  const extraDirs  = dirIdx !== -1 ? [args[dirIdx + 1]] : [];
  const failIdx    = args.indexOf("--fail-below");
  const failBelow  = failIdx !== -1 ? Number(args[failIdx + 1]) : null;
  const threshold  = (() => {
    const i = args.indexOf("--threshold");
    return i !== -1 ? Number(args[i + 1]) : 0.25;
  })();

  const cwd       = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  // Load capabilities
  const capsPath = path.join(infernoDir, "capabilities.json");
  if (!fs.existsSync(capsPath)) {
    console.error(red("✗ inferno/capabilities.json not found — run `infernoflow init` first."));
    process.exit(1);
  }
  let capabilities;
  try { capabilities = JSON.parse(fs.readFileSync(capsPath, "utf8")); }
  catch (e) { console.error(red("✗ Failed to parse capabilities.json: " + e.message)); process.exit(1); }

  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    console.log(yellow("No capabilities found."));
    process.exit(0);
  }

  // Scan test files
  const scanDirs = [cwd, ...extraDirs];
  if (!jsonMode) process.stdout.write(gray("  Scanning test files…"));
  const testFiles = scanTestFiles(scanDirs);
  if (!jsonMode) process.stdout.write(`\r  Found ${testFiles.length} test file(s).    \n`);

  const testIndex   = buildTestIndex(testFiles);
  const coverageMap = mapTestsToCaps(capabilities, testIndex, threshold);

  const covered = [...coverageMap.values()].filter(v => v.hits.length > 0).length;
  const total   = coverageMap.size;
  const pct     = total === 0 ? 0 : Math.round((covered / total) * 100);

  if (jsonMode) {
    const out = {
      summary: { covered, total, pct, testFiles: testFiles.length },
      capabilities: [...coverageMap.entries()].map(([id, { cap, hits }]) => ({
        id,
        name: cap.name,
        covered: hits.length > 0,
        testCount: hits.length,
        topTests: hits.slice(0, 3).map(h => ({ name: h.testName, file: h.file, score: +h.score.toFixed(3) })),
      })),
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    printTable(coverageMap);
  }

  if (failBelow !== null && pct < failBelow) {
    if (!jsonMode) console.error(red(`✗ Coverage ${pct}% is below threshold ${failBelow}%`));
    process.exit(1);
  }
}
