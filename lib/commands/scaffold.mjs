/**
 * infernoflow scaffold
 *
 * Generate a new capability — source file skeleton + contract registration
 * + placeholder scenario — pre-wired to the project's detected patterns.
 *
 * Usage:
 *   infernoflow scaffold payment-refund
 *   infernoflow scaffold payment-refund --dir src/payments
 *   infernoflow scaffold payment-refund --lang ts --dry-run
 *   infernoflow scaffold payment-refund --json
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function saveJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

// ── name derivers ─────────────────────────────────────────────────────────────

/** payment-refund → PaymentRefund */
function toPascalCase(id) {
  return id.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

/** payment-refund → paymentRefund */
function toCamelCase(id) {
  const p = toPascalCase(id);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/** payment-refund → "Payment Refund" */
function toTitle(id) {
  return id.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Derive a primary function name from the cap ID.
 * payment-refund → refundPayment, user-auth → authenticateUser
 */
function primaryFnName(id) {
  const parts = id.split(/[-_]/);
  if (parts.length === 1) return toCamelCase(id);

  // Common verb patterns: if second word is a verb-like term, flip order
  const VERBS = ["auth", "login", "logout", "register", "refresh", "validate",
                 "verify", "process", "refund", "charge", "send", "fetch",
                 "create", "update", "delete", "get", "list", "search",
                 "sync", "import", "export", "scan", "check", "notify"];

  const last  = parts[parts.length - 1];
  const first = parts[0];

  // If last part looks like a noun and first part looks verb-like, use as-is
  if (VERBS.includes(first)) {
    // auth-user → authenticateUser style (expand verb)
    const verbExpand = { auth: "authenticate", get: "get", list: "list",
                         send: "send", check: "check", notify: "notify" };
    const verb = verbExpand[first] || first;
    const rest  = parts.slice(1).map((w, i) =>
      i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w
    ).join("");
    return verb + rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  // Default: flip last+first — payment-refund → refundPayment
  if (VERBS.includes(last)) {
    const noun = parts.slice(0, -1).map((w, i) =>
      i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w
    ).join("");
    return last + noun;
  }

  return toCamelCase(id);
}

// ── language detector ─────────────────────────────────────────────────────────

function detectLang(scan, profile, cwd) {
  // 1. From scan source files
  if (scan?.capabilities?.length) {
    const files = scan.capabilities.flatMap(c => c.codeAnalysis?.sourceFiles || []);
    const exts  = files.map(f => path.extname(f));
    if (exts.filter(e => e === ".ts").length > exts.filter(e => e === ".js").length) return "ts";
    if (exts.includes(".py")) return "py";
    if (exts.includes(".go")) return "go";
    if (exts.some(e => e === ".js" || e === ".mjs")) return "js";
  }

  // 2. From profile
  const lang = profile?.language || profile?.lang;
  if (lang) return lang.toLowerCase().replace("javascript", "js").replace("typescript", "ts");

  // 3. From project files
  if (fs.existsSync(path.join(cwd, "tsconfig.json")))  return "ts";
  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) return "py";
  if (fs.existsSync(path.join(cwd, "go.mod")))         return "go";

  return "js";
}

function detectSrcDir(scan, cwd) {
  if (!scan?.capabilities?.length) return null;
  const files = scan.capabilities.flatMap(c => c.codeAnalysis?.sourceFiles || []);
  if (!files.length) return null;

  // Count dir prefixes
  const dirCount = {};
  for (const f of files) {
    const dir = path.dirname(f).split("/")[0];
    dirCount[dir] = (dirCount[dir] || 0) + 1;
  }
  const top = Object.entries(dirCount).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

function detectServices(scan) {
  if (!scan?.capabilities?.length) return [];
  const all = scan.capabilities.flatMap(c => c.codeAnalysis?.services || []);
  return [...new Set(all)];
}

// ── code generators ───────────────────────────────────────────────────────────

function generateTs(id, name, description, fn, services) {
  const pascal    = toPascalCase(id);
  const errorName = `${pascal}Error`;
  const imports   = buildImports("ts", services);

  return `/**
 * ${name}
 *
 * ${description}
 *
 * @capability ${id}
 * @stability  experimental
 */
${imports}

// ── errors ────────────────────────────────────────────────────────────────────

export class ${errorName} extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "${errorName}";
  }
}

// ── types ─────────────────────────────────────────────────────────────────────

export interface ${pascal}Input {
  // TODO: define input fields
}

export interface ${pascal}Result {
  // TODO: define result fields
  success: boolean;
}

// ── implementation ────────────────────────────────────────────────────────────

/**
 * ${fn} — primary entry point for ${name}.
 * TODO: implement this function.
 */
export async function ${fn}(input: ${pascal}Input): Promise<${pascal}Result> {
  // TODO: implement
  throw new ${errorName}("Not implemented yet");
}
`;
}

function generateJs(id, name, description, fn, services) {
  const pascal    = toPascalCase(id);
  const errorName = `${pascal}Error`;
  const imports   = buildImports("js", services);

  return `/**
 * ${name}
 *
 * ${description}
 *
 * @capability ${id}
 * @stability  experimental
 */
${imports}

// ── errors ────────────────────────────────────────────────────────────────────

export class ${errorName} extends Error {
  constructor(message, code) {
    super(message);
    this.name  = "${errorName}";
    this.code  = code;
  }
}

// ── implementation ────────────────────────────────────────────────────────────

/**
 * ${fn} — primary entry point for ${name}.
 * TODO: implement this function.
 *
 * @param {object} input
 * @returns {Promise<object>}
 */
export async function ${fn}(input = {}) {
  // TODO: implement
  throw new ${errorName}("Not implemented yet");
}
`;
}

function generatePy(id, name, description, fn) {
  const cls = toPascalCase(id);

  return `"""
${name}

${description}

capability: ${id}
stability:  experimental
"""

from typing import Any


class ${cls}Error(Exception):
    """Raised when ${name} operations fail."""
    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.code = code


async def ${fn.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')}(input: dict[str, Any]) -> dict[str, Any]:
    """Primary entry point for ${name}.

    TODO: implement this function.
    """
    raise ${cls}Error("Not implemented yet")
`;
}

function generateGo(id, name, description, fn) {
  const pkg = id.split("-")[0];

  return `// Package ${pkg} implements ${name}.
//
// ${description}
//
// capability: ${id}
// stability:  experimental
package ${pkg}

import "errors"

// Err${toPascalCase(id)} is returned when ${name} operations fail.
var Err${toPascalCase(id)} = errors.New("${id}: operation failed")

// ${toPascalCase(fn)} is the primary entry point for ${name}.
// TODO: implement this function.
func ${toPascalCase(fn)}(input map[string]any) (map[string]any, error) {
\treturn nil, Err${toPascalCase(id)}
}
`;
}

function buildImports(lang, services) {
  if (!services.length) return "";
  const lines = [];
  if (lang === "ts" || lang === "js") {
    // Suggest common client imports for detected services
    const serviceImports = {
      stripe:    `// import Stripe from 'stripe';`,
      postgres:  `// import { Pool } from 'pg';`,
      mysql:     `// import mysql from 'mysql2/promise';`,
      redis:     `// import { createClient } from 'redis';`,
      s3:        `// import { S3Client } from '@aws-sdk/client-s3';`,
      sendgrid:  `// import sgMail from '@sendgrid/mail';`,
      twilio:    `// import twilio from 'twilio';`,
      openai:    `// import OpenAI from 'openai';`,
    };
    for (const svc of services) {
      const imp = serviceImports[svc.toLowerCase()];
      if (imp) lines.push(imp);
    }
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

// ── scenario generator ────────────────────────────────────────────────────────

function generateScenario(id, name, fn) {
  return {
    scenarioId:          `${id}-happy-path`,
    description:         `Happy path for ${name}`,
    capabilitiesCovered: [id],
    createdAt:           new Date().toISOString(),
    steps: [
      { step: 1, action: `Call ${fn} with valid input`, expected: "Returns success result" },
      { step: 2, action: `Call ${fn} with invalid input`, expected: "Throws appropriate error" },
    ],
  };
}

// ── printer ───────────────────────────────────────────────────────────────────

function printResult({ id, filePath, scenarioPath, lang, fn, dryRun }) {
  console.log();
  console.log(bold(`  🌊 ${green(id)}`));
  console.log(gray("     stability: experimental — free to evolve"));
  console.log();
  console.log(gray("  Generated:"));
  console.log(`    ${green("+")}  ${cyan(filePath)}   ${gray(`(${lang} source skeleton)`)}`);
  console.log(`    ${green("+")}  ${cyan("inferno/capabilities.json")}   ${gray("(capability registered)")}`);
  console.log(`    ${green("+")}  ${cyan(scenarioPath)}   ${gray("(placeholder scenario)")}`);
  console.log();
  if (dryRun) {
    console.log(yellow("  [dry-run] — no files were written"));
  } else {
    console.log(gray("  Next steps:"));
    console.log(gray(`    1. Implement ${fn}() in ${filePath}`));
    console.log(gray(`    2. Run: infernoflow scan    — to extract call graph`));
    console.log(gray(`    3. Run: infernoflow graph   — to see dependencies`));
    console.log(gray(`    4. Run: infernoflow check   — to validate contract`));
  }
  console.log();
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function scaffoldCommand(rawArgs) {
  const args    = (rawArgs || []).slice(1);
  const dryRun  = args.includes("--dry-run");
  const jsonMode = args.includes("--json");

  const langIdx = args.indexOf("--lang");
  const langArg = langIdx !== -1 ? args[langIdx + 1] : null;

  const dirIdx  = args.indexOf("--dir");
  const dirArg  = dirIdx !== -1 ? args[dirIdx + 1] : null;

  const descIdx = args.indexOf("--description");
  const descArg = descIdx !== -1 ? args[descIdx + 1] : null;

  // Cap ID: first non-flag arg (skip values after --lang, --dir, --description)
  const skipIdxs = new Set([langIdx + 1, dirIdx + 1, descIdx + 1].filter(i => i > 0));
  const capId = args.find((a, i) => !a.startsWith("--") && !skipIdxs.has(i));

  if (!capId) {
    console.error(red("✗ Usage: infernoflow scaffold <capability-id> [--dir <src>] [--lang ts|js|py|go] [--dry-run] [--json]"));
    console.error(gray("  Example: infernoflow scaffold payment-refund"));
    process.exit(1);
  }

  // Validate cap ID format
  if (!/^[a-z][a-z0-9-]*$/.test(capId)) {
    console.error(red(`✗ Invalid capability ID: "${capId}"`));
    console.error(gray("  Use lowercase kebab-case: payment-refund, user-auth, etc."));
    process.exit(1);
  }

  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  // Load context
  const capsPath = path.join(infernoDir, "capabilities.json");
  if (!fs.existsSync(capsPath)) {
    console.error(red("✗ inferno/capabilities.json not found — run `infernoflow init` first."));
    process.exit(1);
  }

  let allCaps = [];
  const rawCaps = loadJson(capsPath);
  if (rawCaps) allCaps = Array.isArray(rawCaps) ? rawCaps : (rawCaps.capabilities || []);

  // Check duplicate
  if (allCaps.some(c => c.id === capId)) {
    console.error(red(`✗ Capability "${capId}" already exists in capabilities.json`));
    console.error(gray("  Use a different ID, or run: infernoflow why " + capId));
    process.exit(1);
  }

  const scan    = loadJson(path.join(infernoDir, "scan.json"));
  const profile = loadJson(path.join(infernoDir, "developer-profile.json"));

  // Detect language
  const lang = langArg || detectLang(scan, profile, cwd);

  // Detect output directory
  const srcDir = dirArg || detectSrcDir(scan, cwd) || "src";
  const ext    = { ts: ".ts", js: ".js", py: ".py", go: ".go" }[lang] || ".js";

  // Derive names
  const name        = toTitle(capId);
  const description = descArg || `TODO: describe ${name}`;
  const fn          = primaryFnName(capId);
  const services    = detectServices(scan);

  // Generate code
  let code;
  if (lang === "ts") code = generateTs(capId, name, description, fn, services);
  else if (lang === "py") code = generatePy(capId, name, description, fn);
  else if (lang === "go") code = generateGo(capId, name, description, fn);
  else code = generateJs(capId, name, description, fn, services);

  // File path: srcDir/capId (replace dashes with nothing) + ext
  // e.g. payment-refund → src/paymentRefund.ts
  const fileName   = toCamelCase(capId) + ext;
  const filePath   = path.join(srcDir, fileName);
  const absFile    = path.join(cwd, filePath);

  // Scenario path
  const scenarioPath = path.join("inferno", "scenarios", `${capId}.json`);
  const absScenario  = path.join(cwd, scenarioPath);
  const scenario     = generateScenario(capId, name, fn);

  // New capability entry
  const newCap = {
    id:          capId,
    name,
    description,
    stability:   "experimental",
    since:       new Date().toISOString().slice(0, 10),
  };

  if (jsonMode) {
    const out = {
      capId,
      name,
      stability:    "experimental",
      lang,
      filePath,
      scenarioPath,
      primaryFn:   fn,
      dryRun,
      code,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(gray(`\n  infernoflow scaffold  →  ${bold(capId)}`));
  console.log(gray("  ──────────────────────────────────────────────────────────────"));

  if (!dryRun) {
    // Create source directory if needed
    const absDir = path.dirname(absFile);
    if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });

    // Write source file
    if (fs.existsSync(absFile)) {
      console.error(red(`  ✗ File already exists: ${filePath}`));
      console.error(gray("    Delete it first or choose a different --dir"));
      process.exit(1);
    }
    fs.writeFileSync(absFile, code, "utf8");

    // Register capability
    allCaps.push(newCap);
    saveJson(capsPath, allCaps);

    // Write scenario
    const scenDir = path.join(cwd, "inferno", "scenarios");
    if (!fs.existsSync(scenDir)) fs.mkdirSync(scenDir, { recursive: true });
    if (!fs.existsSync(absScenario)) {
      saveJson(absScenario, scenario);
    }
  }

  // Show code preview
  const previewLines = code.split("\n").slice(0, 12).map(l => "    " + l).join("\n");
  console.log(gray("\n  Preview:"));
  console.log(gray(previewLines));
  console.log(gray("    ..."));

  printResult({ id: capId, filePath, scenarioPath, lang, fn, dryRun });
}
