/**
 * infernoflow scan
 *
 * Deep AST-based code analysis. Reads actual function bodies — not just names.
 * Extracts: external calls, DB operations, HTTP calls, auth patterns, error types,
 * external service usage (Stripe, S3, SendGrid, etc.).
 *
 * Enriches capabilities.json with a `codeAnalysis` block on each capability,
 * and saves the full scan report to inferno/scan.json.
 *
 * Usage:
 *   infernoflow scan                   Scan project, enrich capabilities
 *   infernoflow scan --dir src/        Scan specific directory
 *   infernoflow scan --json            Print scan.json to stdout
 *   infernoflow scan --dry-run         Print without writing files
 *   infernoflow scan --capability auth-login   Scan one capability only
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { execSync }      from "node:child_process";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

const require = createRequire(import.meta.url);

// ── TypeScript compiler API (global install) ──────────────────────────────────

const TS_PATHS = [
  "/usr/local/lib/node_modules_global/lib/node_modules/typescript",
  "/usr/lib/node_modules/typescript",
  path.join(process.env.HOME || "", ".npm-global/lib/node_modules/typescript"),
];

function loadTypeScript() {
  for (const p of TS_PATHS) {
    try { return require(path.join(p, "lib/typescript.js")); } catch {}
  }
  try { return require("typescript"); } catch {}
  return null;
}

const ts = loadTypeScript();

// ── external service fingerprints ────────────────────────────────────────────

const SERVICE_PATTERNS = [
  { service: "stripe",    patterns: ["stripe", "Stripe", "createPaymentIntent", "charges.create"] },
  { service: "sendgrid",  patterns: ["sendgrid", "@sendgrid", "sgMail", "sendgrid.send"] },
  { service: "ses",       patterns: ["SES", "ses.sendEmail", "aws-sdk/ses", "nodemailer"] },
  { service: "s3",        patterns: ["S3", "s3.upload", "s3.getObject", "PutObjectCommand", "@aws-sdk/s3"] },
  { service: "redis",     patterns: ["redis", "Redis", "ioredis", "createClient"] },
  { service: "jwt",       patterns: ["jwt", "jsonwebtoken", "sign(", "verify(", "decode("] },
  { service: "bcrypt",    patterns: ["bcrypt", "argon2", "scrypt", "hashSync", "compare("] },
  { service: "prisma",    patterns: ["prisma.", "PrismaClient", "@prisma/client"] },
  { service: "mongoose",  patterns: ["mongoose", ".save()", ".findOne(", ".aggregate("] },
  { service: "postgres",  patterns: ["pg", "Pool(", "Client(", "query(", "postgres("] },
  { service: "mysql",     patterns: ["mysql", "mysql2", "createConnection"] },
  { service: "graphql",   patterns: ["graphql", "gql`", "ApolloServer", "GraphQLSchema"] },
  { service: "firebase",  patterns: ["firebase", "firestore", "initializeApp"] },
  { service: "twilio",    patterns: ["twilio", "Twilio(", "messages.create"] },
  { service: "openai",    patterns: ["openai", "OpenAI(", "createCompletion", "chat.completions"] },
];

function detectServices(text) {
  const found = new Set();
  for (const { service, patterns } of SERVICE_PATTERNS) {
    if (patterns.some(p => text.includes(p))) found.add(service);
  }
  return [...found];
}

// ── DB call patterns ──────────────────────────────────────────────────────────

const DB_PATTERNS = [
  /\.(find|findOne|findMany|findById|findAll)\s*\(/g,
  /\.(create|insert|insertOne|insertMany|save)\s*\(/g,
  /\.(update|updateOne|updateMany|updateById|upsert)\s*\(/g,
  /\.(delete|deleteOne|deleteMany|remove|destroy)\s*\(/g,
  /\.(query|execute|raw)\s*\(/g,
  /\.(aggregate|groupBy|count|sum)\s*\(/g,
  /db\.\w+\s*\(/g,
  /prisma\.\w+\.\w+\s*\(/g,
];

function detectDbCalls(text) {
  const calls = new Set();
  for (const re of DB_PATTERNS) {
    const r = new RegExp(re.source, "g");
    let m;
    while ((m = r.exec(text)) !== null) calls.add(m[0].replace(/\s*\($/, "()"));
  }
  return [...calls].slice(0, 10);
}

// ── HTTP call patterns ────────────────────────────────────────────────────────

const HTTP_PATTERNS = [
  /fetch\s*\(/g,
  /axios\.(get|post|put|patch|delete)\s*\(/g,
  /http\.(get|post|request)\s*\(/g,
  /got\.(get|post|put|delete)\s*\(/g,
  /request\.(get|post|put|delete)\s*\(/g,
  /\$http\.(get|post|put|delete)\s*\(/g,
];

function detectHttpCalls(text) {
  const calls = new Set();
  for (const re of HTTP_PATTERNS) {
    const r = new RegExp(re.source, "g");
    let m;
    while ((m = r.exec(text)) !== null) calls.add(m[0].replace(/\s*\($/, "()"));
  }
  return [...calls].slice(0, 8);
}

// ── TypeScript / JavaScript AST analysis ─────────────────────────────────────

function getNodeName(node) {
  if (!ts) return null;
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

/**
 * Walk all descendants of root using node.forEachChild (instance method).
 * Collects all call expressions and throw statements globally,
 * then assigns them to containing functions by source position range.
 */
function collectAllNodes(root) {
  const calls  = []; // { pos, end, name }
  const throws = []; // { pos, end, name }

  function walk(node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr)) {
        calls.push({ pos: node.pos, end: node.end, name: expr.text + "()" });
      } else if (ts.isPropertyAccessExpression(expr)) {
        calls.push({ pos: node.pos, end: node.end, name: expr.name.text + "()" });
      }
    }
    if (ts.isThrowStatement(node) && node.expression) {
      if (ts.isNewExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        throws.push({ pos: node.pos, end: node.end, name: node.expression.expression.text });
      }
    }
    node.forEachChild?.(walk);
  }
  walk(root);
  return { calls, throws };
}

function callsInRange(allCalls, pos, end) {
  return [...new Set(
    allCalls.filter(c => c.pos >= pos && c.end <= end).map(c => c.name)
  )].slice(0, 20);
}

function throwsInRange(allThrows, pos, end) {
  return [...new Set(
    allThrows.filter(t => t.pos >= pos && t.end <= end).map(t => t.name)
  )];
}

function isFunctionNode(node) {
  if (!ts) return false;
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function getParentVariableName(node) {
  // For arrow functions assigned to const: const foo = () => {}
  if (!ts) return null;
  if (node.parent && ts.isVariableDeclaration(node.parent)) {
    return getNodeName(node.parent);
  }
  if (node.parent && ts.isPropertyAssignment(node.parent)) {
    return getNodeName(node.parent);
  }
  return null;
}

function analyzeJsTs(filePath, code) {
  if (!ts) return null;

  let srcFile;
  try {
    srcFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
  } catch {
    return null;
  }

  // Collect ALL call/throw nodes in one pass from root
  const { calls: allCalls, throws: allThrows } = collectAllNodes(srcFile);

  const functions = [];

  function visit(node) {
    if (isFunctionNode(node)) {
      const name  = getNodeName(node) || getParentVariableName(node) || "<anonymous>";
      const text  = code.slice(node.pos, node.end);
      const calls = callsInRange(allCalls, node.pos, node.end);
      const throws = throwsInRange(allThrows, node.pos, node.end);
      functions.push({
        name,
        calls,
        throws,
        services:  detectServices(text),
        dbCalls:   detectDbCalls(text),
        httpCalls: detectHttpCalls(text),
        loc: srcFile.getLineAndCharacterOfPosition(node.pos).line + 1,
      });
    }
    node.forEachChild?.(visit);
  }

  visit(srcFile);
  return functions;
}

// ── Python AST analysis via child_process ─────────────────────────────────────

const PYTHON_SCRIPT = `
import ast, json, sys

def get_calls(node):
    calls = []
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            if isinstance(n.func, ast.Name):
                calls.append(n.func.id + "()")
            elif isinstance(n.func, ast.Attribute):
                calls.append(n.func.attr + "()")
    return list(set(calls))[:20]

def get_raises(node):
    raises = []
    for n in ast.walk(node):
        if isinstance(n, ast.Raise) and n.exc:
            if isinstance(n.exc, ast.Call) and isinstance(n.exc.func, ast.Name):
                raises.append(n.exc.func.id)
            elif isinstance(n.exc, ast.Name):
                raises.append(n.exc.id)
    return list(set(raises))

try:
    code = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
    tree = ast.parse(code)
    functions = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append({
                "name": node.name,
                "calls": get_calls(node),
                "throws": get_raises(node),
                "loc": node.lineno,
            })
    print(json.dumps(functions))
except Exception as e:
    print(json.dumps([]))
`;

function analyzePython(filePath) {
  try {
    const result = execSync(
      `python3 -c ${JSON.stringify(PYTHON_SCRIPT)} ${JSON.stringify(filePath)}`,
      { timeout: 8000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const fns = JSON.parse(result.trim() || "[]");
    // add service/db/http detection from raw file text
    const code = fs.readFileSync(filePath, "utf8");
    return fns.map(f => ({
      ...f,
      services:  detectServices(code),
      dbCalls:   detectDbCalls(code),
      httpCalls: detectHttpCalls(code),
    }));
  } catch {
    return null;
  }
}

// ── regex fallback (Go, Ruby, Java, other) ────────────────────────────────────

const FUNC_PATTERNS = [
  { re: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/gm,  lang: "go"   },
  { re: /^\s*(?:def|async def)\s+(\w+)\s*\(/gm,          lang: "py"   },
  { re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)?(\w+)\s*\(/gm, lang: "java" },
  { re: /^\s*def\s+(\w+)\s*[\(\|]/gm,                    lang: "rb"   },
];

function analyzeWithRegex(filePath, code) {
  const ext = path.extname(filePath).slice(1);
  const pattern = FUNC_PATTERNS.find(p => p.lang === ext);
  if (!pattern) return null;

  const functions = [];
  const r = new RegExp(pattern.re.source, "gm");
  let m;
  while ((m = r.exec(code)) !== null) {
    // grab up to 60 lines after the match for context
    const start  = m.index;
    const end    = Math.min(start + 2000, code.length);
    const chunk  = code.slice(start, end);
    functions.push({
      name:      m[1],
      calls:     [],
      throws:    [],
      services:  detectServices(chunk),
      dbCalls:   detectDbCalls(chunk),
      httpCalls: detectHttpCalls(chunk),
      loc:       code.slice(0, start).split("\n").length,
    });
  }
  return functions.length > 0 ? functions : null;
}

// ── file walker ───────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "coverage", "__pycache__", ".pytest_cache", "vendor", "tmp", ".turbo",
  "target", ".gradle", "public", "static", "assets",
]);

const SUPPORTED_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rb", ".java",
]);

const TEST_FILE = /\.(test|spec)\.[jt]sx?$|_test\.(go|py|rb)|spec\.(rb|js|ts)$/;

function* walkFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walkFiles(path.join(dir, e.name));
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (SUPPORTED_EXTS.has(ext) && !TEST_FILE.test(e.name)) {
        yield path.join(dir, e.name);
      }
    }
  }
}

// ── per-file analyzer ─────────────────────────────────────────────────────────

function analyzeFile(filePath) {
  let code;
  try { code = fs.readFileSync(filePath, "utf8"); }
  catch { return []; }

  const ext = path.extname(filePath);

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    return analyzeJsTs(filePath, code) || analyzeWithRegex(filePath, code) || [];
  }
  if (ext === ".py") {
    return analyzePython(filePath) || analyzeWithRegex(filePath, code) || [];
  }
  return analyzeWithRegex(filePath, code) || [];
}

// ── capability matcher ────────────────────────────────────────────────────────

function tokenise(str) {
  return str.replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase().split(/[\s_\-/.]+/).filter(t => t.length > 1);
}

function overlap(a, b) {
  const sa = new Set(a), sb = new Set(b);
  let n = 0;
  for (const t of sa) if (sb.has(t)) n++;
  const u = sa.size + sb.size - n;
  return u === 0 ? 0 : n / u;
}

function matchFunctionToCapability(fn, capabilities) {
  const fnTokens = tokenise(fn.name);
  let best = null, bestScore = 0;
  for (const cap of capabilities) {
    const score = Math.max(
      overlap(fnTokens, tokenise(cap.id || "")),
      overlap(fnTokens, tokenise(cap.name || cap.title || "")),
    );
    if (score > bestScore) { bestScore = score; best = cap; }
  }
  return bestScore >= 0.2 ? { cap: best, score: bestScore } : null;
}

// ── merge analysis into capability ────────────────────────────────────────────

function mergeAnalysis(existing = {}, fn, filePath, cwd) {
  const rel = path.relative(cwd, filePath);

  // merge arrays without duplicates
  const merge = (a = [], b = []) => [...new Set([...a, ...b])];

  return {
    functions:    merge(existing.functions,    [fn.name]),
    sourceFiles:  merge(existing.sourceFiles,  [rel]),
    calls:        merge(existing.calls,        fn.calls),
    throws:       merge(existing.throws,       fn.throws),
    services:     merge(existing.services,     fn.services),
    dbCalls:      merge(existing.dbCalls,      fn.dbCalls),
    httpCalls:    merge(existing.httpCalls,    fn.httpCalls),
    scannedAt:    new Date().toISOString(),
  };
}

// ── reporters ─────────────────────────────────────────────────────────────────

function printReport(enriched) {
  console.log();
  console.log(bold("  Scan Results"));
  console.log(gray("  ─────────────────────────────────────────────────────────────────"));

  for (const [capId, analysis] of Object.entries(enriched)) {
    const { codeAnalysis: a } = analysis;
    if (!a) continue;

    console.log();
    console.log(`  ${green("●")} ${bold(capId)}`);
    if (a.sourceFiles?.length)  console.log(gray(`    files:    `) + a.sourceFiles.join(", "));
    if (a.functions?.length)    console.log(gray(`    funcs:    `) + a.functions.join(", "));
    if (a.services?.length)     console.log(gray(`    services: `) + cyan(a.services.join(", ")));
    if (a.dbCalls?.length)      console.log(gray(`    db:       `) + a.dbCalls.slice(0, 4).join(", "));
    if (a.httpCalls?.length)    console.log(gray(`    http:     `) + a.httpCalls.slice(0, 4).join(", "));
    if (a.throws?.length)       console.log(gray(`    throws:   `) + yellow(a.throws.join(", ")));
  }

  console.log();
  console.log(gray("  ─────────────────────────────────────────────────────────────────"));
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function scanCommand(rawArgs) {
  const args       = rawArgs || [];
  const dryRun     = args.includes("--dry-run");
  const jsonMode   = args.includes("--json");
  const dirIdx     = args.indexOf("--dir");
  const extraDirs  = dirIdx !== -1 ? [args[dirIdx + 1]] : [];
  const capFilter  = (() => { const i = args.indexOf("--capability"); return i !== -1 ? args[i + 1] : null; })();

  const cwd        = process.cwd();
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

  if (!Array.isArray(capabilities)) {
    // handle object format { capabilities: [...] }
    if (capabilities.capabilities) capabilities = capabilities.capabilities;
    else { console.error(red("✗ Unexpected capabilities.json format.")); process.exit(1); }
  }

  // Filter by --capability flag
  const targetCaps = capFilter
    ? capabilities.filter(c => c.id === capFilter || (c.name || "").toLowerCase() === capFilter.toLowerCase())
    : capabilities;

  if (targetCaps.length === 0) {
    console.log(yellow(capFilter ? `No capability matched: ${capFilter}` : "No capabilities found."));
    process.exit(0);
  }

  // Walk source files
  const scanDirs = [cwd, ...extraDirs];
  if (!jsonMode) process.stdout.write(gray("  Walking source files…"));
  const files = [];
  for (const dir of scanDirs) {
    for (const f of walkFiles(dir)) files.push(f);
  }
  if (!jsonMode) process.stdout.write(`\r  Found ${files.length} source files.          \n`);

  // Analyze files
  if (!jsonMode) process.stdout.write(gray("  Analyzing…"));
  const allFunctions = []; // { fn, filePath }
  let analyzed = 0;
  for (const filePath of files) {
    const fns = analyzeFile(filePath);
    for (const fn of fns) allFunctions.push({ fn, filePath });
    analyzed++;
    if (!jsonMode && analyzed % 20 === 0) {
      process.stdout.write(`\r  Analyzed ${analyzed}/${files.length} files…`);
    }
  }
  if (!jsonMode) process.stdout.write(`\r  Analyzed ${files.length} files, found ${allFunctions.length} functions.          \n`);

  // Map functions to capabilities
  const enriched = {}; // capId → { ...cap, codeAnalysis: {...} }

  for (const cap of targetCaps) {
    enriched[cap.id] = { ...cap, codeAnalysis: null };
  }

  for (const { fn, filePath } of allFunctions) {
    const match = matchFunctionToCapability(fn, targetCaps);
    if (!match) continue;
    const { cap } = match;
    const existing = enriched[cap.id]?.codeAnalysis || {};
    enriched[cap.id].codeAnalysis = mergeAnalysis(existing, fn, filePath, cwd);
  }

  // Compute stats
  const total   = Object.keys(enriched).length;
  const matched = Object.values(enriched).filter(e => e.codeAnalysis).length;

  if (jsonMode) {
    const out = {
      scannedAt: new Date().toISOString(),
      files:     files.length,
      functions: allFunctions.length,
      capabilities: Object.entries(enriched).map(([id, data]) => ({
        id,
        name:         data.name || data.title,
        codeAnalysis: data.codeAnalysis,
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  printReport(enriched);
  console.log(`  ${green("✔")} Matched ${matched}/${total} capabilities to source functions`);
  console.log();

  if (dryRun) {
    console.log(yellow("  --dry-run: no files written."));
    return;
  }

  // Write scan.json
  const scanData = {
    scannedAt:    new Date().toISOString(),
    files:        files.length,
    functions:    allFunctions.length,
    capabilities: Object.entries(enriched).map(([id, data]) => ({
      id,
      name:         data.name || data.title,
      codeAnalysis: data.codeAnalysis,
    })),
  };
  const scanPath = path.join(infernoDir, "scan.json");
  fs.writeFileSync(scanPath, JSON.stringify(scanData, null, 2));
  console.log(gray(`  Saved → inferno/scan.json`));

  // Enrich capabilities.json
  let changed = 0;
  const updatedCaps = capabilities.map(cap => {
    const analysis = enriched[cap.id]?.codeAnalysis;
    if (!analysis) return cap;
    changed++;
    return { ...cap, codeAnalysis: analysis };
  });

  if (changed > 0) {
    fs.writeFileSync(capsPath, JSON.stringify(updatedCaps, null, 2));
    console.log(gray(`  Updated ${changed} capability entries in capabilities.json`));
  }

  console.log();
  if (!ts) {
    console.log(yellow("  ⚠  TypeScript compiler not found — JS/TS analyzed with regex fallback."));
    console.log(gray(`     For deeper analysis: npm install -g typescript`));
    console.log();
  }
}
