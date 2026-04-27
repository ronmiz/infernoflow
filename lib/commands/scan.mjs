/**
 * infernoflow scan
 *
 * Deep AST-based code analysis. Reads actual function bodies — not just names.
 * Extracts: external calls, DB operations, HTTP calls, auth patterns, error types,
 * external service usage (Stripe, S3, SendGrid, etc.).
 *
 * Sprint 4 additions:
 * - Route discovery (Express / Fastify / Next.js App Router / Next.js Pages API)
 * - HTTP URL extraction — captures actual URL strings, not just call patterns
 * - Capability name inference from route paths (POST /api/users → CreateUser)
 * - Entry point classification (route handlers + exported functions vs helpers)
 * - --suggest flag: shows untracked entry points as capability candidates
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
 *   infernoflow scan --suggest         Show untracked entry points as new capability candidates
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

// ── HTTP call patterns + URL extraction ──────────────────────────────────────

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

/**
 * Extract actual URL strings from HTTP calls.
 * axios.post('/api/users', data) → { method: 'POST', url: '/api/users' }
 * fetch('/api/tasks')            → { method: 'GET',  url: '/api/tasks' }
 */
const HTTP_URL_CALL_RE = /(?:(?:axios|got|request|\$http)\.(get|post|put|patch|delete)\s*\(\s*|fetch\s*\(\s*)['"`]([^'"`\s\)]+)['"`]/g;

function extractHttpCallUrls(text) {
  const calls = [];
  const r = new RegExp(HTTP_URL_CALL_RE.source, "g");
  let m;
  while ((m = r.exec(text)) !== null) {
    const methodLiteral = m[1]; // undefined for fetch
    const url = m[2];
    // Only internal paths (start with / or contain /api/)
    if (!url.startsWith("/") && !url.includes("/api/")) continue;
    const method = methodLiteral ? methodLiteral.toUpperCase() : "GET";
    calls.push({ method, url });
  }
  return calls;
}

// ── Route discovery ───────────────────────────────────────────────────────────

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "all"];

// Express/Koa/Hapi: app.get('/path', fn) or router.post('/path', fn)
const ROUTE_RE = new RegExp(
  `(?:app|router|server|api|routes?)\\.(${HTTP_METHODS.join("|")})\\s*\\(\\s*['"\`]([^'"\`\\s)]+)['"\`]`,
  "g"
);

// Fastify: fastify.route({ method: 'POST', url: '/path' ... })
const FASTIFY_ROUTE_RE = /fastify\.route\s*\(\s*\{[^}]*?method\s*:\s*['"](\w+)['"][^}]*?url\s*:\s*['"]([^'"]+)['"]/gs;

// Express router.route('/path').get(...) chaining
const ROUTE_CHAIN_RE = /(?:app|router)\.route\s*\(\s*['"`]([^'"`\s)]+)['"`]\s*\)\s*\.(get|post|put|patch|delete)/g;

// Next.js App Router: export async function GET(req) in route.ts/route.js
const NEXT_EXPORT_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;

/**
 * Extract route definitions from a source file.
 * Returns: [{ method, path, source, filePath, loc }]
 */
function extractRoutes(filePath, code) {
  const routes = [];
  const isNextAppRouter = /app[/\\].*route\.[jt]sx?$/.test(filePath) ||
                          /app[/\\].*\broute\b.*\.[jt]sx?$/.test(filePath);
  const isNextApiPages  = /pages[/\\]api[/\\]/.test(filePath);

  let m;

  // Express/Koa style
  const rr = new RegExp(ROUTE_RE.source, "g");
  while ((m = rr.exec(code)) !== null) {
    const method = m[1].toUpperCase();
    if (method === "ALL") continue; // skip catch-alls for capability inference
    routes.push({
      method,
      path:   m[2],
      source: "express",
      filePath,
      loc:    code.slice(0, m.index).split("\n").length,
    });
  }

  // Fastify route()
  const fr = new RegExp(FASTIFY_ROUTE_RE.source, "gs");
  while ((m = fr.exec(code)) !== null) {
    routes.push({
      method:   m[1].toUpperCase(),
      path:     m[2],
      source:   "fastify",
      filePath,
      loc:      code.slice(0, m.index).split("\n").length,
    });
  }

  // Express router.route('/path').get(...)
  const cr = new RegExp(ROUTE_CHAIN_RE.source, "g");
  while ((m = cr.exec(code)) !== null) {
    routes.push({
      method:   m[2].toUpperCase(),
      path:     m[1],
      source:   "express-chain",
      filePath,
      loc:      code.slice(0, m.index).split("\n").length,
    });
  }

  // Next.js App Router
  if (isNextAppRouter) {
    const nr = new RegExp(NEXT_EXPORT_RE.source, "g");
    while ((m = nr.exec(code)) !== null) {
      // Infer URL from file path: app/users/[id]/route.ts → /users/:id
      const routePath = filePath
        .replace(/\\/g, "/")
        .replace(/.*\/app\//, "/")
        .replace(/\/route\.[jt]sx?$/, "")
        .replace(/\[([^\]]+)\]/g, ":$1") || "/";
      routes.push({
        method:  m[1].toUpperCase(),
        path:    routePath,
        source:  "next-app",
        filePath,
        loc:     code.slice(0, m.index).split("\n").length,
      });
    }
  }

  // Next.js Pages API (export default handler)
  if (isNextApiPages) {
    const routePath = filePath
      .replace(/\\/g, "/")
      .replace(/.*\/pages\/api\//, "/api/")
      .replace(/\.[jt]sx?$/, "")
      .replace(/\/index$/, "")
      .replace(/\[([^\]]+)\]/g, ":$1");
    routes.push({
      method:  "*",
      path:    routePath || "/api",
      source:  "next-pages",
      filePath,
      loc:     1,
    });
  }

  return routes;
}

// ── Capability name inference from routes ─────────────────────────────────────

/**
 * Derive a human-readable capability name from a route.
 * POST /api/users           → CreateUser
 * GET  /api/users/:id       → GetUser
 * DELETE /api/tasks/:id     → DeleteTask
 * GET  /api/tasks/:id/comments → ListTaskComment
 * PUT  /api/upload          → UpdateUpload
 */
function capNameFromRoute(method, routePath) {
  // Normalise: strip leading /api or /v1 etc.
  const clean = routePath
    .replace(/^\/+/, "")
    .replace(/^api\/v?\d+\//, "")
    .replace(/^api\//, "");

  const parts = clean.split("/").filter(Boolean);
  const resources = parts.filter(p => !p.startsWith(":"));
  const hasId = parts.some(p => p.startsWith(":"));

  const noun   = resources[resources.length - 1] || "Resource";
  const parent = resources.length > 1 ? resources[resources.length - 2] : null;

  const singularize = (s) => {
    if (s.endsWith("ies")) return s.slice(0, -3) + "y";
    if (s.endsWith("ses")) return s.slice(0, -2);
    if (s.endsWith("s") && !s.endsWith("ss")) return s.slice(0, -1);
    return s;
  };
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const toCamel    = (s) => s.split(/[-_]/).map(capitalize).join("");

  const nounCap   = capitalize(toCamel(singularize(noun)));
  const parentCap = parent ? capitalize(toCamel(singularize(parent))) : "";

  const verbMap = {
    GET:     hasId ? "Get"   : "List",
    POST:    hasId ? "Add"   : "Create",
    PUT:               "Update",
    PATCH:             "Update",
    DELETE:            "Delete",
    HEAD:              "Check",
    OPTIONS:           "Options",
    "*":               "Handle",
  };

  const verb = verbMap[method] || "Handle";

  // Nested resource: /tasks/:id/comments → ListTaskComment
  if (parentCap && resources.length > 1) return `${verb}${parentCap}${nounCap}`;
  return `${verb}${nounCap}`;
}

/**
 * Convert a capability name to a kebab-case id.
 * CreateUser → create-user
 */
function nameToId(name) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
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

/**
 * Check whether a node has the `export` modifier.
 */
function isExportedNode(node) {
  if (!ts) return false;
  try {
    const flags = ts.getCombinedModifierFlags(node);
    return !!(flags & ts.ModifierFlags.Export);
  } catch { return false; }
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

      // Check export status: either node itself or parent VariableStatement is exported
      let exported = isExportedNode(node);
      if (!exported && node.parent) {
        // const foo = () => {} inside export const foo = ...
        if (ts.isVariableDeclaration(node.parent) && node.parent.parent) {
          const varList = node.parent.parent;
          if (ts.isVariableDeclarationList(varList) && varList.parent) {
            exported = isExportedNode(varList.parent);
          }
        }
      }

      functions.push({
        name,
        calls,
        throws,
        services:    detectServices(text),
        dbCalls:     detectDbCalls(text),
        httpCalls:   detectHttpCalls(text),
        httpCallUrls: extractHttpCallUrls(text),
        isExported:  exported,
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
      services:     detectServices(code),
      dbCalls:      detectDbCalls(code),
      httpCalls:    detectHttpCalls(code),
      httpCallUrls: extractHttpCallUrls(code),
      isExported:   false,
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
      name:         m[1],
      calls:        [],
      throws:       [],
      services:     detectServices(chunk),
      dbCalls:      detectDbCalls(chunk),
      httpCalls:    detectHttpCalls(chunk),
      httpCallUrls: extractHttpCallUrls(chunk),
      isExported:   false,
      loc:          code.slice(0, start).split("\n").length,
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
  catch { return { functions: [], routes: [] }; }

  const ext = path.extname(filePath);
  let functions = [];

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    functions = analyzeJsTs(filePath, code) || analyzeWithRegex(filePath, code) || [];
  } else if (ext === ".py") {
    functions = analyzePython(filePath) || analyzeWithRegex(filePath, code) || [];
  } else {
    functions = analyzeWithRegex(filePath, code) || [];
  }

  const routes = ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext))
    ? extractRoutes(filePath, code)
    : [];

  return { functions, routes };
}

// ── entry point classification ────────────────────────────────────────────────

/**
 * Mark each function as isEntryPoint / isHelper based on:
 * 1. It's an exported function
 * 2. It's registered as a route handler (function name appears near a route definition)
 * 3. It directly has HTTP/DB calls (leaf service calls are likely entry-adjacent)
 */
function classifyEntryPoints(allFunctions, allRoutes) {
  // Build set of function names used in route registration lines
  // e.g. router.post('/api/x', createUser) — "createUser" is a handler
  const routeHandlerNames = new Set();
  for (const route of allRoutes) {
    if (route.handler) routeHandlerNames.add(route.handler);
  }

  // Build caller graph
  const calledByCount = new Map(); // name → number of callers
  for (const { fn } of allFunctions) {
    for (const callee of fn.calls || []) {
      const name = callee.replace("()", "");
      calledByCount.set(name, (calledByCount.get(name) || 0) + 1);
    }
  }

  return allFunctions.map(({ fn, filePath }) => {
    const isRouteHandler = routeHandlerNames.has(fn.name);
    const isExported     = fn.isExported || false;
    const callerCount    = calledByCount.get(fn.name) || 0;
    const hasServiceCalls = (fn.dbCalls?.length || 0) + (fn.services?.length || 0) +
                            (fn.httpCallUrls?.length || 0) > 0;

    // Entry point: exported OR a known route handler
    // Also treat functions with service calls that are NOT called by anyone as entry-point candidates
    const isEntryPoint = isRouteHandler || isExported ||
                         (hasServiceCalls && callerCount === 0);
    const isHelper     = !isEntryPoint && callerCount > 0;

    return {
      fn: { ...fn, isEntryPoint, isHelper, callerCount },
      filePath,
    };
  });
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
    httpCallUrls: merge(existing.httpCallUrls || [],
                        (fn.httpCallUrls || []).map(c => `${c.method} ${c.url}`)),
    isEntryPoint: fn.isEntryPoint || existing.isEntryPoint || false,
    scannedAt:    new Date().toISOString(),
  };
}

// ── --suggest: show untracked entry points ────────────────────────────────────

function printSuggestions(allFunctions, allRoutes, capabilities, cwd) {
  const existingIds   = new Set(capabilities.map(c => c.id));
  const existingNames = new Set(capabilities.map(c => (c.name || c.title || "").toLowerCase()));

  console.log();
  console.log(bold("  Capability Candidates"));
  console.log(gray("  Untracked entry points discovered in your codebase:"));
  console.log(gray("  ─────────────────────────────────────────────────────────────────"));

  const seen = new Set();
  const candidates = [];

  // Route-based candidates (highest confidence)
  for (const route of allRoutes) {
    const suggestedName = capNameFromRoute(route.method, route.path);
    const suggestedId   = nameToId(suggestedName);
    if (existingIds.has(suggestedId) || existingNames.has(suggestedName.toLowerCase())) continue;
    if (seen.has(suggestedId)) continue;
    seen.add(suggestedId);

    const rel = path.relative(cwd, route.filePath);
    candidates.push({
      id:     suggestedId,
      name:   suggestedName,
      source: `${route.method} ${route.path}`,
      file:   rel,
      confidence: "high",
    });
  }

  // Function-based candidates (entry points with service calls, no matching cap)
  for (const { fn, filePath } of allFunctions) {
    if (!fn.isEntryPoint) continue;
    if (fn.name === "<anonymous>" || fn.name.length < 3) continue;
    const match = matchFunctionToCapability(fn, capabilities);
    if (match && match.score >= 0.35) continue; // already tracked
    const id = nameToId(fn.name);
    if (existingIds.has(id) || seen.has(id)) continue;
    seen.add(id);

    const rel = path.relative(cwd, filePath);
    candidates.push({
      id,
      name:   fn.name,
      source: `function in ${rel}:${fn.loc}`,
      file:   rel,
      confidence: "medium",
    });
  }

  if (!candidates.length) {
    console.log(gray("  All entry points are already tracked as capabilities. ✓"));
    console.log();
    return;
  }

  const high   = candidates.filter(c => c.confidence === "high");
  const medium = candidates.filter(c => c.confidence === "medium");

  if (high.length) {
    console.log();
    console.log(cyan("  ● High confidence (from route definitions):"));
    for (const c of high) {
      console.log(`    ${green(c.id.padEnd(35))} ${gray(c.source)}`);
    }
  }

  if (medium.length) {
    console.log();
    console.log(cyan("  ● Medium confidence (exported / top-level functions):"));
    for (const c of medium.slice(0, 10)) {
      console.log(`    ${yellow(c.id.padEnd(35))} ${gray(c.source)}`);
    }
    if (medium.length > 10) {
      console.log(gray(`    … and ${medium.length - 10} more`));
    }
  }

  console.log();
  console.log(gray("  To add these, run:"));
  for (const c of [...high, ...medium.slice(0, 3)]) {
    console.log(gray(`    infernoflow add "${c.id}" "${c.name}"`));
  }
  console.log();
}

// ── reporters ─────────────────────────────────────────────────────────────────

function printReport(enriched, allRoutes, cwd) {
  console.log();
  console.log(bold("  Scan Results"));
  console.log(gray("  ─────────────────────────────────────────────────────────────────"));

  for (const [capId, analysis] of Object.entries(enriched)) {
    const { codeAnalysis: a } = analysis;
    if (!a) continue;

    console.log();
    const epTag = a.isEntryPoint ? cyan(" [entry]") : "";
    console.log(`  ${green("●")} ${bold(capId)}${epTag}`);
    if (a.sourceFiles?.length)  console.log(gray(`    files:    `) + a.sourceFiles.join(", "));
    if (a.functions?.length)    console.log(gray(`    funcs:    `) + a.functions.join(", "));
    if (a.services?.length)     console.log(gray(`    services: `) + cyan(a.services.join(", ")));
    if (a.dbCalls?.length)      console.log(gray(`    db:       `) + a.dbCalls.slice(0, 4).join(", "));
    if (a.httpCallUrls?.length) console.log(gray(`    calls:    `) + a.httpCallUrls.slice(0, 4).join(", "));
    else if (a.httpCalls?.length) console.log(gray(`    http:     `) + a.httpCalls.slice(0, 4).join(", "));
    if (a.throws?.length)       console.log(gray(`    throws:   `) + yellow(a.throws.join(", ")));
  }

  // Show discovered routes summary
  if (allRoutes.length) {
    console.log();
    console.log(bold("  Discovered Routes"));
    console.log(gray("  ─────────────────────────────────────────────────────────────────"));
    const byFile = new Map();
    for (const r of allRoutes) {
      const rel = path.relative(cwd, r.filePath);
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push(r);
    }
    for (const [file, routes] of byFile) {
      console.log(gray(`\n  ${file}`));
      for (const r of routes) {
        const name = r.method !== "*" ? capNameFromRoute(r.method, r.path) : "";
        const tag  = name ? gray(` → ${name}`) : "";
        console.log(`    ${cyan(r.method.padEnd(7))} ${r.path}${tag}`);
      }
    }
  }

  console.log();
  console.log(gray("  ─────────────────────────────────────────────────────────────────"));
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function scanCommand(rawArgs) {
  const args       = rawArgs || [];
  const dryRun     = args.includes("--dry-run");
  const jsonMode   = args.includes("--json");
  const suggestMode = args.includes("--suggest") || args.includes("-s");
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
  let capsFileIsObject = false;
  let capsFileWrapper = null;
  try { capabilities = JSON.parse(fs.readFileSync(capsPath, "utf8")); }
  catch (e) { console.error(red("✗ Failed to parse capabilities.json: " + e.message)); process.exit(1); }

  if (!Array.isArray(capabilities)) {
    if (capabilities.capabilities) {
      capsFileIsObject = true;
      capsFileWrapper = capabilities;
      capabilities = capabilities.capabilities;
    }
    else { console.error(red("✗ Unexpected capabilities.json format.")); process.exit(1); }
  }

  // Filter by --capability flag
  const targetCaps = capFilter
    ? capabilities.filter(c => c.id === capFilter || (c.name || "").toLowerCase() === capFilter.toLowerCase())
    : capabilities;

  if (targetCaps.length === 0 && !suggestMode) {
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
  const allRoutes    = []; // route definitions discovered
  let analyzed = 0;
  for (const filePath of files) {
    const { functions, routes } = analyzeFile(filePath);
    for (const fn of functions) allFunctions.push({ fn, filePath });
    for (const r of routes)     allRoutes.push(r);
    analyzed++;
    if (!jsonMode && analyzed % 20 === 0) {
      process.stdout.write(`\r  Analyzed ${analyzed}/${files.length} files…`);
    }
  }
  if (!jsonMode) {
    process.stdout.write(
      `\r  Analyzed ${files.length} files · ${allFunctions.length} functions · ${allRoutes.length} routes          \n`
    );
  }

  // Classify entry points
  const classifiedFunctions = classifyEntryPoints(allFunctions, allRoutes);

  // --suggest mode: skip capability matching, just show candidates
  if (suggestMode) {
    printSuggestions(classifiedFunctions, allRoutes, capabilities, cwd);
    return;
  }

  // Map functions to capabilities
  const enriched = {}; // capId → { ...cap, codeAnalysis: {...} }

  for (const cap of targetCaps) {
    enriched[cap.id] = { ...cap, codeAnalysis: null };
  }

  for (const { fn, filePath } of classifiedFunctions) {
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
      scannedAt:  new Date().toISOString(),
      files:      files.length,
      functions:  allFunctions.length,
      routes:     allRoutes,
      capabilities: Object.entries(enriched).map(([id, data]) => ({
        id,
        name:         data.name || data.title,
        codeAnalysis: data.codeAnalysis,
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  printReport(enriched, allRoutes, cwd);
  console.log(`  ${green("✔")} Matched ${matched}/${total} capabilities to source functions`);
  if (allRoutes.length) {
    console.log(`  ${green("✔")} Discovered ${allRoutes.length} route${allRoutes.length !== 1 ? "s" : ""} — run ${cyan("infernoflow scan --suggest")} to see untracked ones`);
  }
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
    routes:       allRoutes,
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
    const toWrite = capsFileIsObject
      ? { ...capsFileWrapper, capabilities: updatedCaps }
      : updatedCaps;
    fs.writeFileSync(capsPath, JSON.stringify(toWrite, null, 2));
    console.log(gray(`  Updated ${changed} capability entries in capabilities.json`));
  }

  console.log();
  if (!ts) {
    console.log(yellow("  ⚠  TypeScript compiler not found — JS/TS analyzed with regex fallback."));
    console.log(gray(`     For deeper analysis: npm install -g typescript`));
    console.log();
  }
}
